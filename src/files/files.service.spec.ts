import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { FilesService } from './files.service';
import { S3Service } from '../aws/s3.service';
import { DynamoDbService } from '../aws/dynamodb.service';
import { FileRecord } from '../aws/interfaces/file-record.interface';
import { AppConfigService } from '../config';
import { FileStatus } from '../constants';

describe('FilesService', () => {
  let service: FilesService;
  let s3Service: jest.Mocked<Partial<S3Service>>;
  let dynamoDbService: jest.Mocked<Partial<DynamoDbService>>;

  const mockAppConfigService = {
    appUrl: 'http://localhost:3000',
    frontendUrl: 'http://localhost:5173',
  };

  beforeEach(async () => {
    s3Service = {
      generatePresignedUploadUrl: jest.fn().mockResolvedValue('https://s3.amazonaws.com/test-upload-url'),
      generatePresignedDownloadUrl: jest.fn().mockResolvedValue('https://s3.amazonaws.com/test-download-url'),
      getFileStream: jest.fn(),
      uploadFileBuffer: jest.fn().mockResolvedValue(undefined),
      deleteObject: jest.fn().mockResolvedValue(undefined),
    };

    dynamoDbService = {
      saveFileRecord: jest.fn().mockResolvedValue(undefined),
      getFileRecord: jest.fn(),
      listFileRecords: jest.fn(),
      incrementDownloadCount: jest.fn().mockResolvedValue(1),
      updateFileStatus: jest.fn().mockResolvedValue(undefined),
      updateFileAuditStatus: jest.fn().mockResolvedValue(undefined),
      deleteFileRecord: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FilesService,
        {
          provide: S3Service,
          useValue: s3Service,
        },
        {
          provide: DynamoDbService,
          useValue: dynamoDbService,
        },
        {
          provide: AppConfigService,
          useValue: mockAppConfigService,
        },
      ],
    }).compile();

    service = module.get<FilesService>(FilesService);
  });

  describe('requestUpload', () => {
    it('should create an upload session with PENDING status and return a pre-signed URL', async () => {
      const dto = {
        fileName: 'test-doc.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1048576,
        expiryHours: 12,
        tags: ['test'],
      };

      const result = await service.requestUpload(dto);

      expect(result.fileId).toBeDefined();
      expect(result.uploadUrl).toBe('https://s3.amazonaws.com/test-upload-url');
      expect(result.s3Key).toContain('uploads/');
      expect(result.s3Key).toContain('test-doc.pdf');
      expect(dynamoDbService.saveFileRecord).toHaveBeenCalledTimes(1);
    });
  });

  describe('confirmUpload', () => {
    it('should mark status as READY when file exists', async () => {
      const mockRecord: FileRecord = {
        fileId: 'mock-123',
        originalName: 'test.pdf',
        s3Key: 'uploads/mock-123/test.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 100,
        status: FileStatus.PENDING,
        uploadedAt: new Date().toISOString(),
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
        downloadCount: 0,
      };

      dynamoDbService.getFileRecord = jest.fn().mockResolvedValue(mockRecord);

      const result = await service.confirmUpload('mock-123');
      expect(result.status).toBe(FileStatus.READY);
      expect(dynamoDbService.updateFileStatus).toHaveBeenCalledWith('mock-123', FileStatus.READY);
    });

    it('should throw NotFoundException if file record does not exist', async () => {
      dynamoDbService.getFileRecord = jest.fn().mockResolvedValue(null);
      await expect(service.confirmUpload('non-existent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getFileDetails', () => {
    it('should purge file from S3 and throw BadRequestException if file has expired', async () => {
      const expiredRecord: FileRecord = {
        fileId: 'expired-123',
        originalName: 'expired.pdf',
        s3Key: 'uploads/expired-123/expired.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 100,
        status: FileStatus.READY,
        uploadedAt: new Date().toISOString(),
        expiresAt: Math.floor(Date.now() / 1000) - 300, // 5 minutes ago
        downloadCount: 0,
      };

      dynamoDbService.getFileRecord = jest.fn().mockResolvedValue(expiredRecord);
      await expect(service.getFileDetails('expired-123')).rejects.toThrow(BadRequestException);
      expect(s3Service.deleteObject).toHaveBeenCalledWith('uploads/expired-123/expired.pdf');
      expect(dynamoDbService.updateFileAuditStatus).toHaveBeenCalledWith('expired-123', FileStatus.EXPIRED);
    });
  });

  describe('purgeExpiredFiles', () => {
    it('should soft-delete only expired files from S3 while retaining audit trail', async () => {
      const records: FileRecord[] = [
        {
          fileId: 'expired-1',
          originalName: 'old.pdf',
          s3Key: 'uploads/expired-1/old.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 100,
          status: FileStatus.READY,
          uploadedAt: new Date().toISOString(),
          expiresAt: Math.floor(Date.now() / 1000) - 100,
          downloadCount: 0,
        },
        {
          fileId: 'active-1',
          originalName: 'current.pdf',
          s3Key: 'uploads/active-1/current.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 200,
          status: FileStatus.READY,
          uploadedAt: new Date().toISOString(),
          expiresAt: Math.floor(Date.now() / 1000) + 3600,
          downloadCount: 0,
        },
      ];

      dynamoDbService.listFileRecords = jest.fn().mockResolvedValue(records);
      const result = await service.purgeExpiredFiles();

      expect(result.purgedCount).toBe(1);
      expect(result.purgedFiles).toContain('expired-1');
      expect(s3Service.deleteObject).toHaveBeenCalledWith('uploads/expired-1/old.pdf');
      expect(dynamoDbService.updateFileAuditStatus).toHaveBeenCalledWith('expired-1', FileStatus.EXPIRED);
    });
  });

  describe('listFiles', () => {
    it('should return empty list when no uploaderId is provided to protect user privacy', async () => {
      const result = await service.listFiles();
      expect(result).toEqual([]);
    });

    it('should only return files uploaded by the specified client/browser', async () => {
      const records: FileRecord[] = [
        {
          fileId: 'pca-file',
          originalName: 'pca.pdf',
          uploaderId: 'client-pca-123',
          s3Key: 'uploads/pca-file/pca.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 100,
          status: FileStatus.READY,
          uploadedAt: new Date().toISOString(),
          expiresAt: Math.floor(Date.now() / 1000) + 3600,
          downloadCount: 0,
        },
        {
          fileId: 'pcb-file',
          originalName: 'pcb.pdf',
          uploaderId: 'client-pcb-456',
          s3Key: 'uploads/pcb-file/pcb.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 200,
          status: FileStatus.READY,
          uploadedAt: new Date().toISOString(),
          expiresAt: Math.floor(Date.now() / 1000) + 3600,
          downloadCount: 0,
        },
      ];

      dynamoDbService.listFileRecords = jest.fn().mockResolvedValue(records);

      const pcAResult = await service.listFiles('client-pca-123');
      expect(pcAResult.length).toBe(1);
      expect(pcAResult[0].fileId).toBe('pca-file');

      const pcBResult = await service.listFiles('client-pcb-456');
      expect(pcBResult.length).toBe(1);
      expect(pcBResult[0].fileId).toBe('pcb-file');
    });
  });

  describe('getDownloadUrl', () => {
    it('should increment download count and return pre-signed download URL', async () => {
      const validRecord: FileRecord = {
        fileId: 'valid-123',
        originalName: 'valid.pdf',
        s3Key: 'uploads/valid-123/valid.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 100,
        status: FileStatus.READY,
        uploadedAt: new Date().toISOString(),
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
        downloadCount: 0,
      };

      dynamoDbService.getFileRecord = jest.fn().mockResolvedValue(validRecord);
      dynamoDbService.incrementDownloadCount = jest.fn().mockResolvedValue(1);

      const result = await service.getDownloadUrl('valid-123');
      expect(result.downloadUrl).toBe('https://s3.amazonaws.com/test-download-url');
      expect(result.downloadCount).toBe(1);
      expect(dynamoDbService.incrementDownloadCount).toHaveBeenCalledWith('valid-123');
    });
  });
});
