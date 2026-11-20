import { Injectable, NotFoundException, BadRequestException, Logger, OnModuleInit } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { S3Service } from '../aws/s3.service';
import { DynamoDbService } from '../aws/dynamodb.service';
import { FileRecord } from '../aws/interfaces/file-record.interface';
import { AppConfigService } from '../config';
import { CreateUploadDto } from './dto/create-upload.dto';
import { FileStatus, FILE_CONSTANTS, REGEX_PATTERNS } from '../constants';
import { buildS3Key, calculateTtlEpochSeconds, isExpired } from '../utils';

@Injectable()
export class FilesService implements OnModuleInit {
  private readonly logger = new Logger(FilesService.name);
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(
    private readonly s3Service: S3Service,
    private readonly dynamoDbService: DynamoDbService,
    private readonly appConfigService: AppConfigService,
  ) {}

  private getRootUrl(): string {
    const raw = this.appConfigService?.appUrl || 'http://localhost:3000';
    return raw.replace(REGEX_PATTERNS.TRAILING_SLASH, '');
  }

  private getFrontendUrl(): string {
    const raw = this.appConfigService?.frontendUrl || 'http://localhost:5173';
    return raw.replace(REGEX_PATTERNS.TRAILING_SLASH, '');
  }

  /**
   * Lifecycle hook: starts an automatic background sweeper that purges expired files
   * from S3 storage every 3 hours while preserving the DynamoDB audit trail.
   */
  onModuleInit() {
    // Run sweeper every 3 hours (3 * 60 * 60 * 1000 ms)
    const intervalMs = 3 * 60 * 60 * 1000;
    this.cleanupInterval = setInterval(() => {
      this.purgeExpiredFiles().catch((err) => {
        this.logger.error(`Periodic expired file cleanup failed: ${err.message}`);
      });
    }, intervalMs);
    this.logger.log('Automated expired file background sweeper initialized (3-hour interval)');
  }

  async requestUpload(dto: CreateUploadDto, uploaderId?: string) {
    const fileId = uuidv4();
    const s3Key = buildS3Key(fileId, dto.fileName);
    const ttlSeconds = calculateTtlEpochSeconds(dto.expiryHours || FILE_CONSTANTS.DEFAULT_EXPIRY_HOURS);

    // 1. Generate pre-signed PUT URL (valid for 15 minutes)
    const uploadUrl = await this.s3Service.generatePresignedUploadUrl(
      s3Key,
      dto.mimeType,
      FILE_CONSTANTS.PRESIGNED_UPLOAD_EXPIRY_SECONDS,
    );

    // 2. Register metadata record in DynamoDB with PENDING status
    const record: FileRecord = {
      fileId,
      originalName: dto.fileName,
      uploaderId: uploaderId || undefined,
      s3Key,
      mimeType: dto.mimeType,
      sizeBytes: dto.sizeBytes,
      status: FileStatus.PENDING,
      uploadedAt: new Date().toISOString(),
      expiresAt: ttlSeconds,
      downloadCount: 0,
      tags: dto.tags || [],
    };

    await this.dynamoDbService.saveFileRecord(record);
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
    uploaderId?: string,
  ) {
    const fileId = uuidv4();
    const s3Key = buildS3Key(fileId, file.originalname);
    const hours = expiryHours || FILE_CONSTANTS.DEFAULT_EXPIRY_HOURS;
    const ttlSeconds = calculateTtlEpochSeconds(hours);

    // 1. Upload file buffer directly to S3
    await this.s3Service.uploadFileBuffer(s3Key, file.buffer, file.mimetype);

    // 2. Save metadata in DynamoDB with READY status
    const record: FileRecord = {
      fileId,
      originalName: file.originalname,
      uploaderId: uploaderId || undefined,
      s3Key,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      status: FileStatus.READY,
      uploadedAt: new Date().toISOString(),
      expiresAt: ttlSeconds,
      downloadCount: 0,
      tags: ['multipart-upload'],
    };

    await this.dynamoDbService.saveFileRecord(record);
    this.logger.log(`Multipart file uploaded directly: ${file.originalname} (${fileId})`);

    // 3. Clean, shortened proxy links that mask S3 bucket details
    const rootUrl = this.getRootUrl();
    const frontendUrl = this.getFrontendUrl();
    const downloadUrl = `${rootUrl}/d/${fileId}`;
    const previewUrl = `${rootUrl}/f/${fileId}`;
    const shareLink = `${frontendUrl}/download/${fileId}`;

    return {
      message: 'File uploaded successfully',
      fileId,
      originalName: file.originalname,
      sizeBytes: file.size,
      mimeType: file.mimetype,
      status: FileStatus.READY,
      downloadLink: downloadUrl,
      previewLink: previewUrl,
      shareLink,
      expiryHours: hours,
      expiresAt: new Date(ttlSeconds * 1000).toISOString(),
    };
  }

  async confirmUpload(fileId: string) {
    const record = await this.dynamoDbService.getFileRecord(fileId);
    if (!record) {
      throw new NotFoundException(`File record ${fileId} not found`);
    }

    // Mark status as READY once client confirms upload
    await this.dynamoDbService.updateFileStatus(fileId, FileStatus.READY);

    const rootUrl = this.getRootUrl();
    const frontendUrl = this.getFrontendUrl();

    return {
      message: 'File upload confirmed successfully',
      fileId,
      status: FileStatus.READY,
      downloadLink: `${rootUrl}/d/${fileId}`,
      previewLink: `${rootUrl}/f/${fileId}`,
      shareLink: `${frontendUrl}/download/${fileId}`,
    };
  }

  /**
   * Lists active file transfers for a specific client/browser ID.
   * If no uploaderId is provided, returns an empty list to protect user privacy.
   * Injects downloadLink, previewLink, and shareLink into each returned file object.
   * Automatically purges expired S3 files in the background while keeping DynamoDB audit records.
   */
  async listFiles(uploaderId?: string) {
    if (!uploaderId) {
      return [];
    }

    const records = await this.dynamoDbService.listFileRecords();
    const activeRecords: FileRecord[] = [];

    const rootUrl = this.getRootUrl();
    const frontendUrl = this.getFrontendUrl();

    for (const record of records) {
      const expired = isExpired(record.expiresAt) || record.status === FileStatus.EXPIRED;

      if (expired) {
        // Soft-delete from S3 to eliminate storage costs, but keep DynamoDB audit trail
        if (record.status !== FileStatus.EXPIRED) {
          this.s3Service.deleteObject(record.s3Key).catch((err) => {
            this.logger.warn(`Failed to delete S3 object for expired file ${record.fileId}: ${err.message}`);
          });
          this.dynamoDbService
            .updateFileAuditStatus(record.fileId, FileStatus.EXPIRED)
            .catch((err) => {
              this.logger.warn(`Failed to update DynamoDB audit status for expired file ${record.fileId}: ${err.message}`);
            });
        }
      } else if (
        record.status === FileStatus.READY &&
        record.uploaderId === uploaderId
      ) {
        activeRecords.push({
          ...record,
          downloadLink: `${rootUrl}/d/${record.fileId}`,
          previewLink: `${rootUrl}/f/${record.fileId}`,
          shareLink: `${frontendUrl}/download/${record.fileId}`,
        });
      }
    }

    return activeRecords;
  }

  /**
   * Retrieves file details. If the file was deleted or expired,
   * returns a clear explanatory message.
   */
  async getFileDetails(fileId: string) {
    const record = await this.dynamoDbService.getFileRecord(fileId);
    if (!record) {
      throw new NotFoundException(`File with ID ${fileId} not found`);
    }

    if (record.status === FileStatus.DELETED) {
      throw new NotFoundException('This file transfer was deleted by the sender.');
    }

    if (isExpired(record.expiresAt) || record.status === FileStatus.EXPIRED) {
      // Proactively purge from S3 storage if not already done
      if (record.status !== FileStatus.EXPIRED) {
        await this.s3Service.deleteObject(record.s3Key).catch((err) => {
          this.logger.warn(`Failed to delete S3 object on access: ${err.message}`);
        });
        await this.dynamoDbService
          .updateFileAuditStatus(fileId, FileStatus.EXPIRED)
          .catch((err) => {
            this.logger.warn(`Failed to update DynamoDB audit status on access: ${err.message}`);
          });
      }
      throw new BadRequestException('This file transfer has expired and is no longer available.');
    }

    if (record.status === FileStatus.PENDING) {
      throw new BadRequestException('This file upload was never completed or was abandoned.');
    }

    const rootUrl = this.getRootUrl();
    const frontendUrl = this.getFrontendUrl();

    return {
      ...record,
      downloadLink: `${rootUrl}/d/${fileId}`,
      previewLink: `${rootUrl}/f/${fileId}`,
      shareLink: `${frontendUrl}/download/${fileId}`,
    };
  }

  /**
   * Retrieves a readable stream from S3 for direct proxying to the client.
   * Increments download counter in DynamoDB.
   */
  async getFileStream(fileId: string) {
    const record = await this.getFileDetails(fileId);
    await this.dynamoDbService.incrementDownloadCount(fileId);
    const { stream, contentType, contentLength } = await this.s3Service.getFileStream(record.s3Key);
    return {
      stream,
      originalName: record.originalName,
      mimeType: contentType || record.mimeType,
      sizeBytes: contentLength || record.sizeBytes,
    };
  }

  async getDownloadUrl(fileId: string, forceDownload = false) {
    const record = await this.getFileDetails(fileId);

    // Increment download counter in DynamoDB
    const newCount = await this.dynamoDbService.incrementDownloadCount(fileId);

    const disposition = forceDownload ? 'attachment' : 'inline';

    // Generate pre-signed GET URL (valid for 5 minutes)
    const downloadUrl = await this.s3Service.generatePresignedDownloadUrl(
      record.s3Key,
      record.originalName,
      FILE_CONSTANTS.PRESIGNED_DOWNLOAD_EXPIRY_SECONDS,
      disposition,
    );

    const rootUrl = this.getRootUrl();
    const frontendUrl = this.getFrontendUrl();

    return {
      fileId,
      originalName: record.originalName,
      mimeType: record.mimeType,
      mediaUrl: `${rootUrl}/f/${fileId}`,
      previewLink: `${rootUrl}/f/${fileId}`,
      directDownloadUrl: `${rootUrl}/d/${fileId}`,
      downloadLink: `${rootUrl}/d/${fileId}`,
      shareLink: `${frontendUrl}/download/${fileId}`,
      downloadUrl,
      downloadCount: newCount,
      expiresInSeconds: FILE_CONSTANTS.PRESIGNED_DOWNLOAD_EXPIRY_SECONDS,
    };
  }

  /**
   * Soft-deletes a file: permanently deletes the physical file from S3
   * to eliminate storage costs, but retains the record in DynamoDB with
   * status DELETED for audit tracking.
   */
  async deleteFile(fileId: string) {
    const record = await this.dynamoDbService.getFileRecord(fileId);
    if (!record) {
      throw new NotFoundException(`File with ID ${fileId} not found`);
    }

    await this.s3Service.deleteObject(record.s3Key);
    await this.dynamoDbService.updateFileAuditStatus(fileId, FileStatus.DELETED);
    this.logger.log(`File soft-deleted: ${fileId} (${record.originalName}). S3 object purged, DynamoDB audit record retained.`);
    return {
      message: `File ${record.originalName} (${fileId}) deleted successfully`,
      fileId,
      status: FileStatus.DELETED,
    };
  }

  /**
   * Sweeps the database, finds expired records, deletes them from S3,
   * and marks them as EXPIRED in DynamoDB for historical auditing.
   */
  async purgeExpiredFiles(): Promise<{ purgedCount: number; purgedFiles: string[] }> {
    const records = await this.dynamoDbService.listFileRecords();
    const purgedFiles: string[] = [];

    for (const record of records) {
      if (
        record.status !== FileStatus.DELETED &&
        (isExpired(record.expiresAt) || record.status === FileStatus.EXPIRED)
      ) {
        try {
          await this.s3Service.deleteObject(record.s3Key);
          await this.dynamoDbService.updateFileAuditStatus(record.fileId, FileStatus.EXPIRED);
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
