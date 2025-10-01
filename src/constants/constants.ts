// These constants are used throughout the application for various configurations and limits.

export const API_CONSTANTS = {
  MAX_PAGE_SIZE: 100,
  DEFAULT_PAGE_SIZE: 20,
  MAX_EXPORT_RECORDS: 10000,
} as const;

export const VALIDATION_CONSTANTS = {
  MIN_PASSWORD_LENGTH: 8,
  MAX_PASSWORD_LENGTH: 128,
  MAX_DESCRIPTION_LENGTH: 1000,
  MAX_METADATA_SIZE: 10000,
} as const;
