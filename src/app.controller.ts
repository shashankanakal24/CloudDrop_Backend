import { Controller, Get, Param, Query, Res, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam, ApiQuery } from '@nestjs/swagger';
import { Response } from 'express';
import { FilesService } from './files/files.service';

@ApiTags('Health')
@Controller()
export class AppController {
  constructor(private readonly filesService: FilesService) {}

  @Get('health')
  @ApiOperation({ summary: 'Target group / NLB health check endpoint' })
  getHealth() {
    return {
      status: 'UP',
      service: 'clouddrop-backend',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('api/health')
  @ApiOperation({ summary: 'API specific health check endpoint' })
  getApiHealth() {
    return {
      status: 'UP',
      service: 'clouddrop-backend',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  }

  private extractUuid(raw: string): string {
    const match = raw.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    return match ? match[0] : raw.replace(/["',]+/g, '').trim();
  }

  @Get(['d/:fileId', 'd/:fileId*'])
  @ApiOperation({
    summary: 'Direct download link - press enter and file downloads immediately',
    description: 'Instant download link. Automatically triggers file download in any browser without needing confirmation.',
  })
  @ApiParam({ name: 'fileId', description: 'Unique UUID of the file' })
  async forceDownload(
    @Param('fileId') fileId: string,
    @Res() res: Response,
  ) {
    const cleanFileId = this.extractUuid(fileId);
    const { downloadUrl } = await this.filesService.getDownloadUrl(cleanFileId, true);
    return res.redirect(HttpStatus.FOUND, downloadUrl);
  }

  @Get(['f/:fileId', 'f/:fileId*'])
  @ApiOperation({
    summary: 'Direct short media link to view/stream or download file',
    description:
      'Clean short link. Opens images, audio, video, and PDFs directly in the browser. Add ?download=true to force a download.',
  })
  @ApiParam({ name: 'fileId', description: 'Unique UUID of the file' })
  @ApiQuery({ name: 'download', required: false, description: 'Set to true to force download dialog' })
  async viewOrDownload(
    @Param('fileId') fileId: string,
    @Query('download') download: string,
    @Res() res: Response,
  ) {
    const cleanFileId = this.extractUuid(fileId);
    const isDownload = download === 'true' || download === '1';
    const { downloadUrl } = await this.filesService.getDownloadUrl(cleanFileId, isDownload);
    return res.redirect(HttpStatus.FOUND, downloadUrl);
  }
}

