import { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';
import { AppConfigService } from './app-config.service';

/**
 * Builds the complete CORS configuration object.
 * Reads allowed frontend origins from AppConfigService (which reads ALLOWED_ORIGINS and FRONTEND_URL from .env).
 *
 * Allows the React frontend (running locally on localhost:5173 or
 * hosted on AWS Amplify) to securely communicate with the NestJS backend without CORS blocking.
 */
export function getCorsConfig(appConfig: AppConfigService): CorsOptions {
  return {
    origin: appConfig.corsOrigins,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'Accept',
      'Origin',
      'X-Client-Timestamp',
      'X-Client-Platform',
      'X-Client-Request-Id',
    ],
    exposedHeaders: ['ETag'],
    credentials: appConfig.corsCredentials,
    maxAge: 3600, // Cache preflight OPTIONS response for 1 hour
  };
}
