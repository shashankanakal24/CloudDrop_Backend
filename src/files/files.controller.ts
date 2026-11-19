import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  HttpStatus,
  HttpCode,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  Req,
  Res,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { FilesService } from './files.service';
import { CreateUploadDto } from './dto/create-upload.dto';
import { ConfirmUploadDto } from './dto/confirm-upload.dto';

@ApiTags('Files')
@Controller('api/files')
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Post('upload')
  @HttpCode(HttpStatus.CREATED)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Direct multipart file upload (Swagger browser test)',
    description:
      'Upload a file directly using multipart/form-data with a file chooser button in Swagger UI. Uploads the file to S3 and returns a clean shareable download link.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'Select a file from your computer to upload directly to S3',
        },
        expiryHours: {
          type: 'number',
          description: 'Hours until file expires (default 24)',
          default: 24,
        },
      },
      required: ['file'],
    },
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'File uploaded to S3 and registered in DynamoDB successfully',
  })
  @UseInterceptors(FileInterceptor('file'))
  async uploadFile(
    @UploadedFile() file: any,
    @Req() req: Request,
    @Body('expiryHours') expiryHours?: number,
  ) {
    if (!file) {
      throw new BadRequestException('No file provided in request body');
    }
    const host = req.get('host') || 'localhost:3000';
    const protocol = req.protocol || 'http';
    const baseUrl = `${protocol}://${host}`;
    return this.filesService.uploadDirect(file, expiryHours ? Number(expiryHours) : undefined, baseUrl);
  }

  @Post('upload-url')
  @ApiOperation({
    summary: 'Request a pre-signed S3 upload URL',
    description:
      'Creates a file metadata entry in DynamoDB and returns a secure, time-limited S3 pre-signed PUT URL. The client uploads the file directly to S3 without putting load on the backend server.',
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Pre-signed URL generated successfully',
  })
  async requestUploadUrl(@Body() dto: CreateUploadDto) {
    return this.filesService.requestUpload(dto);
  }

  @Post(':fileId/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Confirm direct S3 upload completion',
    description: 'Updates file status to READY in DynamoDB once S3 PUT upload succeeds.',
  })
  @ApiParam({ name: 'fileId', description: 'Unique UUID of the file' })
  async confirmUpload(
    @Param('fileId') fileId: string,
    @Body() _dto: ConfirmUploadDto,
  ) {
    return this.filesService.confirmUpload(fileId);
  }

  @Get()
  @ApiOperation({
    summary: 'List all transferred files and metadata',
    description: 'Fetches active file transfer records stored in DynamoDB.',
  })
  async listFiles() {
    return this.filesService.listFiles();
  }

  @Post('cleanup-expired')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Purge all expired files from S3 and DynamoDB',
    description:
      'Sweeps through all file records, identifies expired transfers, and permanently deletes both the S3 objects and DynamoDB metadata.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Expired files purged successfully',
  })
  async cleanupExpired() {
    return this.filesService.purgeExpiredFiles();
  }

  @Get(':fileId')
  @ApiOperation({
    summary: 'Get details for a specific file transfer',
    description: 'Returns file metadata, size, download count, and expiration.',
  })
  @ApiParam({ name: 'fileId', description: 'Unique UUID of the file' })
  async getFileDetails(@Param('fileId') fileId: string) {
    return this.filesService.getFileDetails(fileId);
  }

  @Get(':fileId/download-url')
  @ApiOperation({
    summary: 'Get a secure pre-signed download URL',
    description:
      'Increments the download counter in DynamoDB and generates a temporary pre-signed S3 GET URL.',
  })
  @ApiParam({ name: 'fileId', description: 'Unique UUID of the file' })
  async getDownloadUrl(@Param('fileId') fileId: string) {
    return this.filesService.getDownloadUrl(fileId);
  }

  @Delete(':fileId')
  @ApiOperation({
    summary: 'Delete file from S3 and DynamoDB',
    description: 'Removes the object from the S3 bucket and deletes its record in DynamoDB.',
  })
  @ApiParam({ name: 'fileId', description: 'Unique UUID of the file' })
  async deleteFile(@Param('fileId') fileId: string) {
    return this.filesService.deleteFile(fileId);
  }
}

