import winston from "winston";
import path from "path";

import fs from "fs";
import { MS_ADMIN_AUDIT_CONFIG } from "@/config/environments";

/**
 * Custom Winston logger configuration for HIPAA compliance.
 * Logs are structured in JSON format with necessary metadata.
 * Separate log files for general logs, errors, audit trails, and security events.
 */
const hipaaFormat = winston.format.combine(
  winston.format.timestamp({
    format: "YYYY-MM-DD HH:mm:ss.SSS",
  }),
  winston.format.errors({ stack: true }),
  winston.format.json(),
  winston.format.printf(
    ({ timestamp, level, message, service, userId, sessionId, ...meta }) => {
      const logEntry = {
        timestamp,
        level: level.toUpperCase(),
        service: service || "ms-admin-audit",
        message,
        ...(userId ? { userId } : {}),
        ...(sessionId ? { sessionId } : {}),
        ...(meta || {}),
      };

      return JSON.stringify(logEntry);
    },
  ),
);

/**
 * Main application logger
 * - Logs general application info and errors
 * - Logs audit trails to a separate file
 * - Logs security events to a separate file
 * - Handles uncaught exceptions and unhandled promise rejections
 */
const baseConsoleTransport = new winston.transports.Console({
  format: winston.format.combine(
    winston.format.colorize(),
    winston.format.simple(),
  ),
});

const fileTransports: winston.transport[] = MS_ADMIN_AUDIT_CONFIG.VERCEL
  ? []
  : [
      new winston.transports.File({
        filename: path.join(MS_ADMIN_AUDIT_CONFIG.BACKUP_DIR, "app.log"),
        maxsize: 10 * 1024 * 1024,
        maxFiles: 10,
        tailable: true,
      }),
      new winston.transports.File({
        filename: path.join(MS_ADMIN_AUDIT_CONFIG.LOG_DIR, "error.log"),
        level: "error",
        maxsize: 10 * 1024 * 1024,
        maxFiles: 5,
        tailable: true,
      }),
      new winston.transports.File({
        filename: path.join(MS_ADMIN_AUDIT_CONFIG.LOG_DIR, "audit.log"),
        level: "info",
        maxsize: 50 * 1024 * 1024,
        maxFiles: 50,
        tailable: true,
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.json(),
        ),
      }),
    ];

export const logger = winston.createLogger({
  level: MS_ADMIN_AUDIT_CONFIG.LOG_LEVEL,
  format: hipaaFormat,
  defaultMeta: {
    service: "ms-admin-audit",
    version: "1.0.0",
    environment: MS_ADMIN_AUDIT_CONFIG.NODE_ENV,
  },
  transports: [baseConsoleTransport, ...fileTransports],
  exceptionHandlers: MS_ADMIN_AUDIT_CONFIG.VERCEL
    ? [baseConsoleTransport]
    : [
        new winston.transports.File({
          filename: path.join(MS_ADMIN_AUDIT_CONFIG.LOG_DIR, "exceptions.log"),
        }),
      ],
  rejectionHandlers: MS_ADMIN_AUDIT_CONFIG.VERCEL
    ? [baseConsoleTransport]
    : [
        new winston.transports.File({
          filename: path.join(MS_ADMIN_AUDIT_CONFIG.LOG_DIR, "rejections.log"),
        }),
      ],
});

export const auditLogger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp({
      format: "YYYY-MM-DD HH:mm:ss.SSS",
    }),
    winston.format.json(),
  ),
  defaultMeta: {
    service: "ms-admin-audit",
    type: "audit",
  },
  transports: MS_ADMIN_AUDIT_CONFIG.VERCEL
    ? [baseConsoleTransport]
    : [
        new winston.transports.File({
          filename: path.join(MS_ADMIN_AUDIT_CONFIG.LOG_DIR, "audit-trail.log"),
          maxsize: 100 * 1024 * 1024,
          maxFiles: 100,
          tailable: true,
        }),
      ],
});

export const securityLogger = winston.createLogger({
  level: "warn",
  format: winston.format.combine(
    winston.format.timestamp({
      format: "YYYY-MM-DD HH:mm:ss.SSS",
    }),
    winston.format.json(),
  ),
  defaultMeta: {
    service: "ms-admin-audit",
    type: "security",
  },
  transports: MS_ADMIN_AUDIT_CONFIG.VERCEL
    ? [baseConsoleTransport]
    : [
        new winston.transports.File({
          filename: path.join(MS_ADMIN_AUDIT_CONFIG.LOG_DIR, "security.log"),
          maxsize: 50 * 1024 * 1024,
          maxFiles: 20,
          tailable: true,
        }),
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple(),
          ),
        }),
      ],
});

if (!MS_ADMIN_AUDIT_CONFIG.VERCEL) {
  const logDir = path.join(MS_ADMIN_AUDIT_CONFIG.LOG_DIR);
  try {
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
  } catch (e) {
    console.warn("Could not create log directory:", logDir, e);
  }

  const backupDir = path.join(MS_ADMIN_AUDIT_CONFIG.BACKUP_DIR);
  try {
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }
  } catch (e) {
    console.warn("Could not create backup directory:", backupDir, e);
  }
}

export default {
  ...logger,

  auditAction: (action: string, userId: string, details: any) => {
    auditLogger.info("User Action", {
      action,
      userId,
      timestamp: new Date().toISOString(),
      details,
    });
  },

  securityEvent: (event: string, details: any) => {
    securityLogger.warn("Security Event", {
      event,
      timestamp: new Date().toISOString(),
      details,
    });
  },

  hipaaAccess: (
    resourceType: string,
    resourceId: string,
    userId: string,
    action: string,
  ) => {
    auditLogger.info("HIPAA Data Access", {
      resourceType,
      resourceId,
      userId,
      action,
      timestamp: new Date().toISOString(),
      compliance: "HIPAA",
    });
  },
};
