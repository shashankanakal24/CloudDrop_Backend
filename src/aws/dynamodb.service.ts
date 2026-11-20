import { Injectable, Logger } from '@nestjs/common';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  ScanCommand,
  UpdateCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';
import { AppConfigService } from '../config';
import { FileStatus } from '../constants';
import { FileRecord } from './interfaces/file-record.interface';

@Injectable()
export class DynamoDbService {
  private readonly logger = new Logger(DynamoDbService.name);
  private readonly docClient: DynamoDBDocumentClient;
  private readonly tableName: string;

  constructor(private readonly appConfigService: AppConfigService) {
    const region = this.appConfigService.awsRegion;
    this.tableName = this.appConfigService.dynamoDbTableName;

    // Use credentials from config if provided (e.g. local dev);
    // Otherwise AWS SDK automatically retrieves IAM Instance Profile on EC2
    const credentials = this.appConfigService.awsCredentials;
    const clientConfig: any = { region };
    if (credentials) {
      clientConfig.credentials = credentials;
    }

    const ddbClient = new DynamoDBClient(clientConfig);
    this.docClient = DynamoDBDocumentClient.from(ddbClient, {
      marshallOptions: { removeUndefinedValues: true },
    });

    this.logger.log(`Initialized DynamoDB Service for Region: ${region}, Table: ${this.tableName}`);
  }

  getTableName(): string {
    return this.tableName;
  }

  /**
   * Save file record in DynamoDB
   */
  async saveFileRecord(record: FileRecord): Promise<void> {
    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: record,
      }),
    );
  }

  /**
   * Get file record from DynamoDB by fileId
   */
  async getFileRecord(fileId: string): Promise<FileRecord | null> {
    const result = await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { fileId },
      }),
    );
    return (result.Item as FileRecord) || null;
  }

  /**
   * List all file records from DynamoDB
   */
  async listFileRecords(): Promise<FileRecord[]> {
    const result = await this.docClient.send(
      new ScanCommand({
        TableName: this.tableName,
      }),
    );
    const items = (result.Items as FileRecord[]) || [];
    return items.sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());
  }

  /**
   * Increments download counter in DynamoDB atomically
   */
  async incrementDownloadCount(fileId: string): Promise<number> {
    const result = await this.docClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { fileId },
        UpdateExpression: 'SET downloadCount = if_not_exists(downloadCount, :zero) + :incr',
        ExpressionAttributeValues: {
          ':zero': 0,
          ':incr': 1,
        },
        ReturnValues: 'UPDATED_NEW',
      }),
    );
    return result.Attributes?.downloadCount || 1;
  }

  /**
   * Update file status in DynamoDB
   */
  async updateFileStatus(fileId: string, status: FileStatus): Promise<void> {
    await this.docClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { fileId },
        UpdateExpression: 'SET #s = :status',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: { ':status': status },
      }),
    );
  }

  /**
   * Updates file status and updatedAt timestamp (used for audit tracking on soft delete / expiry)
   */
  async updateFileAuditStatus(
    fileId: string,
    status: FileStatus.EXPIRED | FileStatus.DELETED,
  ): Promise<void> {
    const nowIso = new Date().toISOString();
    await this.docClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { fileId },
        UpdateExpression: 'SET #s = :status, updatedAt = :updatedAt',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: {
          ':status': status,
          ':updatedAt': nowIso,
        },
      }),
    );
  }

  /**
   * Hard-deletes a record from DynamoDB
   */
  async deleteFileRecord(fileId: string): Promise<void> {
    await this.docClient.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: { fileId },
      }),
    );
  }
}

