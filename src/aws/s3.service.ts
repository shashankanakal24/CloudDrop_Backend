import { Injectable, Logger } from '@nestjs/common';
import { Readable } from 'stream';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { AppConfigService } from '../config';
import { FILE_CONSTANTS } from '../constants';

@Injectable()
export class S3Service {
  private readonly logger = new Logger(S3Service.name);
  private readonly s3Client: S3Client;
  private readonly bucketName: string;

  constructor(private readonly appConfigService: AppConfigService) {
    const region = this.appConfigService.awsRegion;
    this.bucketName = this.appConfigService.s3BucketName;

    // Use credentials from config if provided (e.g. local dev);
    // Otherwise AWS SDK automatically retrieves IAM Instance Profile on EC2
    const credentials = this.appConfigService.awsCredentials;
    const clientConfig: any = { region };
    if (credentials) {
      clientConfig.credentials = credentials;
    }

    this.s3Client = new S3Client(clientConfig);
    this.logger.log(`Initialized S3 Service for Region: ${region}, Bucket: ${this.bucketName}`);
  }

  getBucketName(): string {
    return this.bucketName;
  }

  /**
   * Generates a pre-signed S3 PUT URL for secure, direct client-to-S3 uploads.
   * This offloads heavy file uploads from EC2, saving bandwidth and compute.
   */
  async generatePresignedUploadUrl(
    s3Key: string,
    mimeType: string,
    expiresInSeconds = FILE_CONSTANTS.PRESIGNED_UPLOAD_EXPIRY_SECONDS,
  ): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: s3Key,
      ContentType: mimeType,
    });
    return getSignedUrl(this.s3Client, command, { expiresIn: expiresInSeconds });
  }

  /**
   * Generates a pre-signed S3 GET URL for direct, secure file view or download.
   * disposition 'inline' opens images, videos, audio, and PDFs directly in the browser;
   * disposition 'attachment' forces a file download dialog.
   */
  async generatePresignedDownloadUrl(
    s3Key: string,
    originalName: string,
    expiresInSeconds = FILE_CONSTANTS.PRESIGNED_DOWNLOAD_EXPIRY_SECONDS,
    disposition: 'inline' | 'attachment' = 'inline',
  ): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: s3Key,
      ResponseContentDisposition: `${disposition}; filename="${encodeURIComponent(originalName)}"`,
    });
    return getSignedUrl(this.s3Client, command, { expiresIn: expiresInSeconds });
  }

  /**
   * Retrieves a readable stream from S3 for direct proxying to the client.
   * Completely hides the S3 bucket name, prevents signature errors, and allows fast chunked delivery.
   */
  async getFileStream(s3Key: string): Promise<{
    stream: Readable;
    contentType: string;
    contentLength: number;
  }> {
    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: s3Key,
    });
    const response = await this.s3Client.send(command);
    return {
      stream: response.Body as Readable,
      contentType: response.ContentType || 'application/octet-stream',
      contentLength: response.ContentLength || 0,
    };
  }

  /**
   * Directly uploads a file buffer to S3 (used for multipart form uploads in Swagger)
   */
  async uploadFileBuffer(s3Key: string, buffer: Buffer, mimeType: string): Promise<void> {
    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: s3Key,
        Body: buffer,
        ContentType: mimeType,
      }),
    );
  }

  /**
   * Deletes a physical file object from the S3 bucket.
   */
  async deleteObject(s3Key: string): Promise<void> {
    try {
      await this.s3Client.send(
        new DeleteObjectCommand({
          Bucket: this.bucketName,
          Key: s3Key,
        }),
      );
      this.logger.log(`Deleted S3 object: ${s3Key}`);
    } catch (err: any) {
      this.logger.warn(`Failed to delete S3 object ${s3Key}: ${err.message}`);
    }
  }
}

