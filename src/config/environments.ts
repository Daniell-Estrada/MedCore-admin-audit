// Environment configuration for the microservice
export const MS_ADMIN_AUDIT_CONFIG = {
  DATABASE_URL: process.env.DATABASE_URL || "",
  PORT: parseInt(process.env.PORT || "3015"),
  ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS?.split(",") || [],
  LOG_LEVEL: process.env.LOG_LEVEL || "info",
  NODE_ENV: process.env.NODE_ENV || "development",
  JWT_SECRET: process.env.JWT_SECRET,
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET,
} as const;

// Azure Event Hub configuration
export const AZURE_EVENT_HUB_CONFIG = {
  CONNECTION_STRING: process.env.AZURE_EVENTHUB_CONNECTION_STRING || "",
  NAMESPACE: process.env.AZURE_EVENTHUB_NAMESPACE || "",
  CLIENT_ID: process.env.AZURE_EVENTHUB_CLIENT_ID || "",
  BROKERS: (process.env.AZURE_EVENTHUB_BROKERS || "").split(","),
  CONSUMER_GROUP: process.env.AZURE_EVENTHUB_CONSUMER_GROUP || "$Default",
  PARTITION_COUNT: parseInt(process.env.AZURE_EVENTHUB_PARTITION_COUNT || "4"),
  MAX_BATCH_SIZE: parseInt(process.env.AZURE_EVENTHUB_MAX_BATCH_SIZE || "100"),
  MAX_WAIT_TIME_MS: parseInt(
    process.env.AZURE_EVENTHUB_MAX_WAIT_TIME_MS || "1000",
  ),
} as const;
