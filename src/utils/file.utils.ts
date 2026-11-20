import { FILE_CONSTANTS, REGEX_PATTERNS } from '../constants';

/**
 * Sanitizes a file name by removing dangerous characters and spaces
 */
export function sanitizeFileName(fileName: string): string {
  if (!fileName) return 'unnamed_file';
  return fileName.replace(REGEX_PATTERNS.FILENAME_SPECIAL_CHARS, '_');
}

/**
 * Builds the canonical S3 object key for a file transfer
 * Convention: uploads/{fileId}/{sanitizedFileName}
 */
export function buildS3Key(fileId: string, fileName: string): string {
  const cleanName = sanitizeFileName(fileName);
  return `${FILE_CONSTANTS.S3_UPLOAD_PREFIX}/${fileId}/${cleanName}`;
}

/**
 * Calculates the DynamoDB TTL expiration timestamp in Unix epoch seconds
 */
export function calculateTtlEpochSeconds(expiryHours: number = FILE_CONSTANTS.DEFAULT_EXPIRY_HOURS): number {
  const clampedHours = Math.max(
    FILE_CONSTANTS.MIN_EXPIRY_HOURS,
    Math.min(expiryHours, FILE_CONSTANTS.MAX_EXPIRY_HOURS),
  );
  const nowSeconds = Math.floor(Date.now() / 1000);
  return nowSeconds + clampedHours * FILE_CONSTANTS.SECONDS_PER_HOUR;
}

/**
 * Checks if a given epoch timestamp has passed
 */
export function isExpired(epochSeconds: number): boolean {
  if (!epochSeconds) return false;
  return Math.floor(Date.now() / 1000) > epochSeconds;
}

/**
 * Converts bytes into human readable format (KB, MB, GB)
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/**
 * Resolves accurate MIME types with charset for previewable files.
 * Ensures browsers render text, json, pdf, and images inline rather than downloading them.
 */
export function getMimeTypeFromFileName(fileName: string, fallback = 'application/octet-stream'): string {
  if (!fileName) return fallback;
  const ext = fileName.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'txt':
    case 'log':
      return 'text/plain; charset=utf-8';
    case 'csv':
      return 'text/csv; charset=utf-8';
    case 'json':
      return 'application/json; charset=utf-8';
    case 'md':
      return 'text/markdown; charset=utf-8';
    case 'html':
    case 'htm':
      return 'text/html; charset=utf-8';
    case 'pdf':
      return 'application/pdf';
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'svg':
      return 'image/svg+xml';
    case 'mp4':
      return 'video/mp4';
    case 'mp3':
      return 'audio/mpeg';
    case 'wav':
      return 'audio/wav';
    default:
      return fallback;
  }
}


