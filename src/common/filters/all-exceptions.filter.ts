import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');
  private readonly logDir = path.resolve(process.cwd(), 'logs');
  private readonly errorLogFile = path.join(this.logDir, 'error.log');

  constructor() {
    // Ensure logs directory exists
    if (!fs.existsSync(this.logDir)) {
      try {
        fs.mkdirSync(this.logDir, { recursive: true });
      } catch (err) {
        this.logger.error(`Failed to create logs directory: ${err.message}`);
      }
    }
  }

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const isHttpException = exception instanceof HttpException;
    const status = isHttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    const timestamp = new Date().toISOString();
    const rawErrorMessage =
      exception instanceof Error
        ? exception.message
        : typeof exception === 'string'
        ? exception
        : JSON.stringify(exception);

    const stackTrace = exception instanceof Error ? exception.stack : '';

    // Determine the user-facing message
    let clientMessage: any = 'Internal server error occurred';

    if (isHttpException) {
      const res = exception.getResponse();
      clientMessage = typeof res === 'object' && res !== null ? (res as any).message || res : res;
    } else {
      // For any unhandled exception (e.g. AWS S3 NoSuchBucket, DynamoDB errors, syntax errors):
      // Mask internal system details from client and return standard 500
      clientMessage = 'Internal Server Error. Please contact support or try again later.';
    }

    // Prepare log record for file
    const logEntry = `[${timestamp}] [${request.method}] ${request.url} | Status: ${status}\n` +
      `IP: ${request.ip} | User-Agent: ${request.headers['user-agent'] || 'Unknown'}\n` +
      `Error: ${rawErrorMessage}\n` +
      (stackTrace ? `Stack:\n${stackTrace}\n` : '') +
      `--------------------------------------------------------------------------------\n`;

    // 1. Write actual detailed error to logs/error.log file
    try {
      fs.appendFileSync(this.errorLogFile, logEntry, 'utf8');
    } catch (writeErr) {
      this.logger.error(`Failed to write to ${this.errorLogFile}: ${writeErr.message}`);
    }

    // 2. Also log to console
    if (status >= 500) {
      this.logger.error(
        `[500 ERROR] ${request.method} ${request.url} - ${rawErrorMessage}`,
        stackTrace,
      );
    } else {
      this.logger.warn(`[${status}] ${request.method} ${request.url} - ${rawErrorMessage}`);
    }

    // 3. Send response to frontend
    response.status(status).json({
      statusCode: status,
      message: clientMessage,
      error: status >= 500 ? 'Internal Server Error' : (exception as any).name || 'HttpException',
      timestamp,
      path: request.url,
    });
  }
}

