import { Controller, Get, Param, Query, Res, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiExcludeEndpoint } from '@nestjs/swagger';
import { Response } from 'express';
import { FilesService } from './files/files.service';
import { REGEX_PATTERNS } from './constants';
import { getMimeTypeFromFileName } from './utils/file.utils';

@Controller()
export class AppController {
  constructor(private readonly filesService: FilesService) {}

  @ApiTags('Health')
  @Get('health')
  @ApiOperation({ summary: 'Target group / NLB health check endpoint' })
  getHealth() {
    return {
      status: 'UP',
      service: 'clouddrop-backend',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Internal Short Link Proxy for Direct Download.
   * Excluded from Swagger UI to keep docs minimal.
   * Completely masks S3 bucket name and streams the file directly to the client.
   */
  @ApiExcludeEndpoint()
  @Get(['d/:fileId', 'd/:fileId*'])
  async forceDownload(
    @Param('fileId') fileId: string,
    @Res() res: Response,
  ) {
    const match = fileId.match(REGEX_PATTERNS.UUID);
    const cleanFileId = match ? match[0] : fileId.replace(REGEX_PATTERNS.QUOTES_AND_COMMAS, '').trim();
    const { stream, originalName, mimeType, sizeBytes } = await this.filesService.getFileStream(cleanFileId);

    res.set({
      'Content-Type': mimeType || 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(originalName)}"`,
      'Content-Length': String(sizeBytes),
    });
    return stream.pipe(res);
  }

  /**
   * Internal Short Link Proxy for Inline Preview.
   * Excluded from Swagger UI to keep docs minimal.
   * Completely masks S3 bucket name and streams file inline.
   */
  @ApiExcludeEndpoint()
  @Get(['f/:fileId', 'f/:fileId*'])
  async viewOrDownload(
    @Param('fileId') fileId: string,
    @Query('download') download: string,
    @Res() res: Response,
  ) {
    const match = fileId.match(REGEX_PATTERNS.UUID);
    const cleanFileId = match ? match[0] : fileId.replace(REGEX_PATTERNS.QUOTES_AND_COMMAS, '').trim();
    const isDownload = download === 'true' || download === '1';
    const { stream, originalName, mimeType, sizeBytes } = await this.filesService.getFileStream(cleanFileId);

    const disposition = isDownload ? 'attachment' : 'inline';
    const effectiveMimeType = isDownload
      ? (mimeType || 'application/octet-stream')
      : getMimeTypeFromFileName(originalName, mimeType || 'application/octet-stream');

    res.set({
      'Content-Type': effectiveMimeType,
      'Content-Disposition': `${disposition}; filename="${encodeURIComponent(originalName)}"`,
      'Content-Length': String(sizeBytes),
    });
    return stream.pipe(res);
  }
}
