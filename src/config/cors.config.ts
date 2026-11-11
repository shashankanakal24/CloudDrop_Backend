import { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';
import { AppConfigService } from './app-config.service';

/**
 * Builds the complete CORS configuration object.
 * Reads allowed frontend origins from AppConfigService (which reads FRONTEND_URL from .env).
 *
 * This allows the React frontend (running locally on localhost:5173 or
 * hosted on AWS Amplify https://main.d12345.amplifyapp.com) to securely communicate
 * with the NestJS backend without browser CORS blocking.
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
    ],
    exposedHeaders: ['ETag'],
    credentials: appConfig.corsCredentials,
    maxAge: 3600, // Cache preflight OPTIONS response for 1 hour
  };
}
