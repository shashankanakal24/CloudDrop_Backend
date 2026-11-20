/**
 * Centralized CORS configuration constants.
 */
export const CORS_CONSTANTS = {
  /**
   * HTTP Methods allowed for Cross-Origin requests.
   */
  ALLOWED_METHODS: [
    'GET',
    'HEAD',
    'PUT',
    'PATCH',
    'POST',
    'DELETE',
    'OPTIONS',
  ] as const,

  /**
   * Headers allowed in CORS requests from frontend clients.
   */
  ALLOWED_HEADERS: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'Accept',
    'Origin',
    'X-Client-Timestamp',
    'X-Client-Platform',
    'X-Client-Request-Id',
    'X-Client-Id',
  ] as const,

  /**
   * Response headers exposed to the client browser.
   */
  EXPOSED_HEADERS: ['ETag'] as const,

  /**
   * Browser preflight cache duration in seconds (1 hour).
   */
  MAX_AGE_SECONDS: 3600,
} as const;

