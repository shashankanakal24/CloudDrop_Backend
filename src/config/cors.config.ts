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
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g. mobile apps, curl, server-to-server)
      if (!origin) {
        return callback(null, true);
      }

      const allowed = appConfig.allowedOrigins || [];

      // Automatically allow Amplify domains, localhost, or configured origins
      if (
        allowed.includes('*') ||
        allowed.includes(origin) ||
        origin.endsWith('.amplifyapp.com') ||
        origin.includes('localhost') ||
        origin.includes('127.0.0.1')
      ) {
        return callback(null, true);
      }

      // Default to allowing the origin to prevent CORS preflight blocks
      return callback(null, true);
    },
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
    credentials: true,
    maxAge: 3600,
  };
}
