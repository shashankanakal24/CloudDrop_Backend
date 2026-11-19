import { Injectable, NotFoundException, BadRequestException, Logger, OnModuleInit } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { AwsService, FileRecord } from '../aws/aws.service';
import { AppConfigService } from '../config';
import { CreateUploadDto } from './dto/create-upload.dto';
import { FileStatus, FILE_CONSTANTS } from '../constants';
import { buildS3Key, calculateTtlEpochSeconds, isExpired } from '../utils';

@Injectable()
export class FilesService implements OnModuleInit {
  private readonly logger = new Logger(FilesService.name);
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(
    private readonly awsService: AwsService,
    private readonly appConfigService: AppConfigService,
  ) {}

  /**
   * Lifecycle hook: starts an automatic background sweeper that purges expired files
   * from both S3 and DynamoDB every 10 minutes.
   */
  onModuleInit() {
    // Run sweeper every 10 minutes
    const intervalMs = 10 * 60 * 1000;
    this.cleanupInterval = setInterval(() => {
      this.purgeExpiredFiles().catch((err) => {
        this.logger.error(`Periodic expired file cleanup failed: ${err.message}`);
      });
    }, intervalMs);
    this.logger.log('Automated expired file background sweeper initialized (10m interval)');
  }

  async requestUpload(dto: CreateUploadDto) {
    const fileId = uuidv4();
    const s3Key = buildS3Key(fileId, dto.fileName);
    const ttlSeconds = calculateTtlEpochSeconds(dto.expiryHours || FILE_CONSTANTS.DEFAULT_EXPIRY_HOURS);

    // 1. Generate pre-signed PUT URL (valid for 15 minutes)
    const uploadUrl = await this.awsService.generatePresignedUploadUrl(
      s3Key,
      dto.mimeType,
      FILE_CONSTANTS.PRESIGNED_UPLOAD_EXPIRY_SECONDS,
    );

    // 2. Register metadata record in DynamoDB with PENDING status
    const record: FileRecord = {
      fileId,
      originalName: dto.fileName,
      s3Key,
      mimeType: dto.mimeType,
      sizeBytes: dto.sizeBytes,
      status: FileStatus.PENDING,
      uploadedAt: new Date().toISOString(),
      expiresAt: ttlSeconds,
      downloadCount: 0,
      tags: dto.tags || [],
    };

    await this.awsService.saveFileRecord(record);
    this.logger.log(`Created upload session for file: ${dto.fileName} (${fileId})`);

    return {
      fileId,
      s3Key,
      uploadUrl,
      expiresAt: new Date(ttlSeconds * 1000).toISOString(),
    };
  }

  async uploadDirect(
    file: { originalname: string; mimetype: string; size: number; buffer: Buffer },
    expiryHours?: number,
    baseUrl = 'http://localhost:3000',
  ) {
    const fileId = uuidv4();
    const s3Key = buildS3Key(fileId, file.originalname);
    const hours = expiryHours || FILE_CONSTANTS.DEFAULT_EXPIRY_HOURS;
    const ttlSeconds = calculateTtlEpochSeconds(hours);

    // 1. Upload file buffer directly to S3
    await this.awsService.uploadFileBuffer(s3Key, file.buffer, file.mimetype);

    // 2. Save metadata in DynamoDB with READY status
    const record: FileRecord = {
      fileId,
      originalName: file.originalname,
      s3Key,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      status: FileStatus.READY,
      uploadedAt: new Date().toISOString(),
      expiresAt: ttlSeconds,
      downloadCount: 0,
      tags: ['multipart-upload'],
    };

    await this.awsService.saveFileRecord(record);
    this.logger.log(`Multipart file uploaded directly: ${file.originalname} (${fileId})`);

    // 3. Generate instant pre-signed S3 download URL
    const s3DownloadUrl = await this.awsService.generatePresignedDownloadUrl(
      s3Key,
      file.originalname,
      FILE_CONSTANTS.PRESIGNED_DOWNLOAD_EXPIRY_SECONDS,
      'inline',
    );

    // 4. Construct clean, short shareable media links based on APP_URL
    const rootUrl = (this.appConfigService.appUrl || baseUrl || 'http://localhost:3000').replace(/\/+$/, '');
    const previewUrl = `${rootUrl}/f/${fileId}`;
    const downloadUrl = `${rootUrl}/d/${fileId}`;

    return {
      message: 'File uploaded successfully',
      downloadLink: downloadUrl,
      previewLink: previewUrl,
      fileId,
      originalName: file.originalname,
      sizeBytes: file.size,
      mimeType: file.mimetype,
      status: FileStatus.READY,
      expiryHours: hours,
      expiresAt: new Date(ttlSeconds * 1000).toISOString(),
    };
  }

  async confirmUpload(fileId: string) {
    const record = await this.awsService.getFileRecord(fileId);
    if (!record) {
      throw new NotFoundException(`File record ${fileId} not found`);
    }

    // Mark status as READY once client confirms upload
    await this.awsService.updateFileStatus(fileId, FileStatus.READY);
    return {
      message: 'File upload confirmed successfully',
      fileId,
      status: FileStatus.READY,
    };
  }

  /**
   * Lists active file transfers, automatically filtering out expired files
   * and launching asynchronous background deletion for any expired S3 objects.
   */
  async listFiles() {
    const records = await this.awsService.listFileRecords();
    const activeRecords: FileRecord[] = [];

    for (const record of records) {
      if (isExpired(record.expiresAt)) {
        // Asynchronously delete expired file from S3 and DynamoDB without blocking list response
        this.awsService.deleteFile(record.fileId, record.s3Key).catch((err) => {
          this.logger.warn(`Failed to clean up expired file ${record.fileId}: ${err.message}`);
        });
      } else {
        activeRecords.push(record);
      }
    }

    return activeRecords;
  }

  /**
   * Retrieves file details. If the file has reached its expiry timestamp,
   * it is immediately purged from S3 storage and DynamoDB before returning an error.
   */
  async getFileDetails(fileId: string) {
    const record = await this.awsService.getFileRecord(fileId);
    if (!record) {
      throw new NotFoundException(`File with ID ${fileId} not found`);
    }

    if (isExpired(record.expiresAt)) {
      // Proactively purge from S3 storage and DynamoDB
      await this.awsService.deleteFile(fileId, record.s3Key).catch((err) => {
        this.logger.warn(`Failed to delete expired S3 object on access: ${err.message}`);
      });
      throw new BadRequestException('This file transfer has expired and has been deleted from S3 storage');
    }

    if (record.status === FileStatus.PENDING) {
      throw new BadRequestException('This file upload was never completed or was abandoned.');
    }

    return record;
  }

  async getDownloadUrl(fileId: string, forceDownload = false) {
    const record = await this.getFileDetails(fileId);

    // Increment download counter in DynamoDB
    const newCount = await this.awsService.incrementDownloadCount(fileId);

    const disposition = forceDownload ? 'attachment' : 'inline';

    // Generate pre-signed GET URL (valid for 5 minutes)
    const downloadUrl = await this.awsService.generatePresignedDownloadUrl(
      record.s3Key,
      record.originalName,
      FILE_CONSTANTS.PRESIGNED_DOWNLOAD_EXPIRY_SECONDS,
      disposition,
    );

    const rootUrl = this.appConfigService.appUrl.replace(/\/+$/, '');

    return {
      fileId,
      originalName: record.originalName,
      mimeType: record.mimeType,
      mediaUrl: `${rootUrl}/f/${fileId}`,
      directDownloadUrl: `${rootUrl}/f/${fileId}?download=true`,
      downloadUrl,
      downloadCount: newCount,
      expiresInSeconds: FILE_CONSTANTS.PRESIGNED_DOWNLOAD_EXPIRY_SECONDS,
    };
  }

  async deleteFile(fileId: string) {
    const record = await this.awsService.getFileRecord(fileId);
    if (!record) {
      throw new NotFoundException(`File with ID ${fileId} not found`);
    }

    await this.awsService.deleteFile(fileId, record.s3Key);
    return {
      message: `File ${record.originalName} (${fileId}) deleted successfully`,
    };
  }

  /**
   * Sweeps the entire database, finds any expired records, and permanently deletes
   * the files from S3 and DynamoDB.
   */
  async purgeExpiredFiles(): Promise<{ purgedCount: number; purgedFiles: string[] }> {
    const records = await this.awsService.listFileRecords();
    const purgedFiles: string[] = [];

    for (const record of records) {
      if (isExpired(record.expiresAt)) {
        try {
          await this.awsService.deleteFile(record.fileId, record.s3Key);
          purgedFiles.push(record.fileId);
          this.logger.log(`[Auto-Purge] Expired file ${record.originalName} (${record.fileId}) removed from S3`);
        } catch (err: any) {
          this.logger.warn(`Failed to auto-purge file ${record.fileId}: ${err.message}`);
        }
      }
    }

    return {
      purgedCount: purgedFiles.length,
      purgedFiles,
    };
  }
}
