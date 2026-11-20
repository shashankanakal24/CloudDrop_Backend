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
} from '@nestjs/common';
import { Request } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiConsumes, ApiBody, ApiHeader } from '@nestjs/swagger';
import { FilesService } from './files.service';

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
  @ApiHeader({
    name: 'x-client-id',
    description: 'Unique browser/client ID (e.g. "pc-a" or "pc-b") for privacy isolation',
    required: false,
    example: 'pc-a-chrome',
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
    const clientId = (req.headers['x-client-id'] as string) || undefined;
    return this.filesService.uploadDirect(
      file,
      expiryHours ? Number(expiryHours) : undefined,
      baseUrl,
      clientId,
    );
  }

  @Get('active/files/list')
  @ApiOperation({
    summary: 'List active transferred files for this browser/client',
    description:
      'Fetches active file transfer records owned by the calling browser (identified by X-Client-Id). Each record includes direct downloadLink, previewLink, and shareLink.',
  })
  @ApiHeader({
    name: 'x-client-id',
    description: 'Unique browser/client ID (e.g. "pc-a" or "pc-b") for privacy isolation',
    required: false,
    example: 'pc-a-chrome',
  })
  async listFiles(@Req() req: Request) {
    const clientId = (req.headers['x-client-id'] as string) || undefined;
    return this.filesService.listFiles(clientId);
  }

  @Get(':fileId')
  @ApiOperation({
    summary: 'Get details for a specific file transfer',
    description: 'Returns file metadata, size, download count, and expiration for the recipient page.',
  })
  @ApiParam({ name: 'fileId', description: 'Unique UUID of the file' })
  async getFileDetails(@Param('fileId') fileId: string) {
    return this.filesService.getFileDetails(fileId);
  }

  @Delete(':fileId')
  @ApiOperation({
    summary: 'Delete file from S3 storage',
    description: 'Deletes the file object from S3 and marks the DynamoDB record as DELETED.',
  })
  @ApiParam({ name: 'fileId', description: 'Unique UUID of the file' })
  async deleteFile(@Param('fileId') fileId: string) {
    return this.filesService.deleteFile(fileId);
  }
}

