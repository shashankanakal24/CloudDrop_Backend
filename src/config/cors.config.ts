import { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';
import { AppConfigService } from './app-config.service';
import { CORS_CONSTANTS, REGEX_PATTERNS } from '../constants';

/**
 * Builds the complete CORS configuration object.
 * Reads allowed frontend origins from AppConfigService (which reads ALLOWED_ORIGINS and FRONTEND_URL from .env).
 *
 * Allows only explicitly whitelisted origins (comma-separated in .env) to securely communicate with the NestJS backend.
 */
export function getCorsConfig(appConfig: AppConfigService): CorsOptions {
  return {
    origin: (origin, callback) => {
      // 1. Allow tools without an origin header (e.g. mobile apps, curl, Postman, server-to-server)
      if (!origin) {
        return callback(null, true);
      }

      // 2. Strict Whitelist: Read comma-separated origins from .env and normalize them (trim spaces & trailing slashes)
      const allowedOrigins = (appConfig.allowedOrigins || []).map((o) =>
        o.trim().replace(REGEX_PATTERNS.TRAILING_SLASH, ''),
      );

      const incomingOrigin = origin.trim().replace(REGEX_PATTERNS.TRAILING_SLASH, '');

      // 3. Check if the caller is in your whitelist
      if (allowedOrigins.includes(incomingOrigin)) {
        return callback(null, true); // ALLOW
      }

      // 4. BLOCK any unknown or malicious website!
      return callback(
        new Error(`CORS Error: Origin ${origin} is not allowed by CORS whitelist`),
      );
    },
    methods: [...CORS_CONSTANTS.ALLOWED_METHODS],
    allowedHeaders: [...CORS_CONSTANTS.ALLOWED_HEADERS],
    exposedHeaders: [...CORS_CONSTANTS.EXPOSED_HEADERS],
    credentials: true,
    maxAge: CORS_CONSTANTS.MAX_AGE_SECONDS,
  };
}
