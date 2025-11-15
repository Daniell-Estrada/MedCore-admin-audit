const IS_VERCEL =
  !!process.env.VERCEL &&
  process.env.VERCEL !== "false" &&
  process.env.VERCEL !== "0";

export const MS_ADMIN_AUDIT_CONFIG = {
  DATABASE_URL: process.env.DATABASE_URL || "",
  PORT: parseInt(process.env.PORT || "3015"),
  ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS?.split(",") || [],
  LOG_LEVEL: process.env.LOG_LEVEL || "info",
  LOG_DIR: process.env.LOG_DIR || (IS_VERCEL ? "/tmp/logs" : "./logs"),
  BACKUP_DIR:
    process.env.BACKUP_DIR || (IS_VERCEL ? "/tmp/backups" : "./backups"),
  NODE_ENV: process.env.NODE_ENV || "development",
  JWT_SECRET: process.env.JWT_SECRET,
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET,
  VERCEL: IS_VERCEL,
} as const;

// Azure Event Hub configuration
export const AZURE_EVENT_HUB_CONFIG = {
  CONNECTION_STRING: process.env.AZURE_EVENT_HUB_CONNECTION_STRING || "",
  NAMESPACE: process.env.AZURE_EVENT_HUB_NAMESPACE || "",
  CLIENT_ID: process.env.AZURE_EVENT_HUB_CLIENT_ID || "",
  BROKERS: (process.env.AZURE_EVENT_HUB_BROKERS || "").split(","),
  CONSUMER_GROUP: process.env.AZURE_EVENT_HUB_CONSUMER_GROUP || "$Default",
  PARTITION_COUNT: parseInt(process.env.AZURE_EVENT_HUB_PARTITION_COUNT || "4"),
  MAX_BATCH_SIZE: parseInt(process.env.AZURE_EVENT_HUB_MAX_BATCH_SIZE || "100"),
  MAX_WAIT_TIME_MS: parseInt(
    process.env.AZURE_EVENT_HUB_MAX_WAIT_TIME_MS || "3000",
  ),
  CONSUMER_SESSION_TIMEOUT_MS: parseInt(
    process.env.AZURE_EVENT_HUB_CONSUMER_SESSION_TIMEOUT_MS || "30000",
  ),
  CONSUMER_HEARTBEAT_INTERVAL_MS: parseInt(
    process.env.AZURE_EVENT_HUB_CONSUMER_HEARTBEAT_INTERVAL_MS || "3000",
  ),
  REBALANCE_TIMEOUT_MS: parseInt(
    process.env.AZURE_EVENT_HUB_REBALANCE_TIMEOUT_MS || "60000",
  ),
  METADATA_MAX_AGE_MS: parseInt(
    process.env.AZURE_EVENT_HUB_METADATA_MAX_AGE_MS || "30000",
  ),
} as const;
