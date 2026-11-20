/**
 * Centralized Regular Expression patterns used across the application.
 * Prevents inline duplicate regexes and ensures consistency.
 */
export const REGEX_PATTERNS = {
  /**
   * Matches one or more trailing slashes at the end of a URL or path.
   * Example: "https://example.com///" -> matches "///"
   */
  TRAILING_SLASH: /\/+$/,

  /**
   * Standard RFC 4122 UUID pattern (case-insensitive).
   * Matches 8-4-4-4-12 hex characters.
   */
  UUID: /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,

  /**
   * Matches any characters that are NOT alphanumeric, dot, underscore, or hyphen.
   * Used for safe S3 object key filenames.
   */
  FILENAME_SPECIAL_CHARS: /[^a-zA-Z0-9._-]/g,

  /**
   * Matches surrounding quotes, double quotes, and commas.
   * Used to sanitize accidentally copied URLs with JSON formatting.
   */
  QUOTES_AND_COMMAS: /["',]+/g,
} as const;

