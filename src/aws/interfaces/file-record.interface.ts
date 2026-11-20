import { FileStatus } from '../../constants';

export interface FileRecord {
  fileId: string;
  originalName: string;
  uploaderId?: string; // Anonymous browser/client session identifier
  s3Key: string;
  mimeType: string;
  sizeBytes: number;
  status: FileStatus;
  uploadedAt: string;
  updatedAt?: string;
  expiresAt: number; // Unix timestamp in seconds for DynamoDB TTL
  downloadCount: number;
  tags?: string[];
  downloadLink?: string;
  previewLink?: string;
  shareLink?: string;
  processedMetadata?: {
    md5Checksum?: string;
    previewGenerated?: boolean;
    lambdaProcessedAt?: string;
  };
}

