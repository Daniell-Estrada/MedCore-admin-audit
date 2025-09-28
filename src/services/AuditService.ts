import type { PrismaClient } from "@prisma/client";
import { v4 as uuidv4 } from "uuid";
import {
  AuditLog,
  AuditLogSchema,
  type AuditLogInput,
} from "@/models/AuditLog";
import { logger, auditLogger, securityLogger } from "@/utils/logger";
import { DatabaseConfig } from "@/config/database";
import { Record } from "@prisma/client/runtime/library";

/**
 * Filters for querying audit logs.
 */
export interface AuditQueryFilters {
  evetType?: string;
  userId?: string;
  patientId?: string;
  resourceId?: string;
  riskLevel?: string;
  startDate?: Date;
  endDate?: Date;
  success?: boolean;
  page?: number;
  limit?: number;
}

/**
 * Result of an audit log query, including logs and pagination info.
 */
export interface AuditQueryResult {
  logs: AuditLog[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/**
 * AuditService class responsible for managing audit logs.
 * This service provides methods to create and handle audit logs,
 * including special handling for critical and HIPAA-sensitive events.
 */
export class AuditService {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = DatabaseConfig.getInstance();
  }

  /**
   * Create a new audit log entry.
   * Validates input, saves to the database, and handles special cases.
   */
  async createAuditLog(input: AuditLogInput): Promise<AuditLog> {
    try {
      const validatedInput = AuditLogSchema.parse(input);

      const auditLogData = {
        id: uuidv4(),
        ...validatedInput,
        createdAt: new Date(),
      };

      const savedLog = await this.prisma.auditLog.create({
        data: auditLogData as any,
      });

      const auditLog: AuditLog = new AuditLog(
        savedLog.id,
        savedLog.eventType,
        savedLog.action,
        savedLog.createdAt,
        savedLog.userId || undefined,
        savedLog.userRole || undefined,
        savedLog.targetUserId || undefined,
        savedLog.patientId || undefined,
        savedLog.resourceType || undefined,
        savedLog.resourceId || undefined,
        savedLog.description || undefined,
        savedLog.ipAddress || undefined,
        savedLog.userAgent || undefined,
        savedLog.sessionId || undefined,
        savedLog.riskLevel,
        (savedLog.metadata as Record<string, any>) || undefined,
        savedLog.success,
        savedLog.errorMessage || undefined,
      );

      auditLogger.info("Audit log created", {
        id: auditLog.id,
        eventType: auditLog.eventType,
        userId: auditLog.userId,
        patientId: auditLog.patientId,
        riskLevel: auditLog.riskLevel,
        success: auditLog.success,
      });

      if (auditLog.requiresImmediateAttention()) {
        await this.handleCriticalEvent(auditLog);
      }

      if (auditLog.isHIPAASensitive()) {
        await this.handleHIPAAEvent(auditLog);
      }

      logger.info("Audit log crated successfully", {
        auditLogId: auditLog.id,
        eventType: auditLog.eventType,
        userId: auditLog.userId,
      });

      return auditLog;
    } catch (error) {
      logger.error("Failed to create audit log", {
        error: error instanceof Error ? error.message : "Unknown error",
        input,
      });
      throw new Error("Failed to create audit log");
    }
  }

  /**
   * Handle critical audit events by logging and creating system alerts.
   */
  private async handleCriticalEvent(auditLog: AuditLog): Promise<void> {
    try {
      securityLogger.warn("Critical audit event detected", {
        auditLogId: auditLog.id,
        eventType: auditLog.eventType,
        userId: auditLog.userId,
        riskLevel: auditLog.riskLevel,
        success: auditLog.success,
      });

      await this.prisma.systemAlert.create({
        data: {
          id: uuidv4(),
          type: auditLog.isSecurityEvent() ? "SECURITY" : "ERROR",
          severity: "CRITICAL",
          title: `Critical event: ${auditLog.eventType}`,
          message:
            auditLog.description ||
            `Critical audit event detected: ${auditLog.eventType}`,
          source: "ms-admin-audit",
          metadata: {
            auditLogId: auditLog.id,
            eventType: auditLog.eventType,
            userId: auditLog.userId,
            riskLevel: auditLog.riskLevel,
          },
        },
      });

      logger.warn("Critical event handled", {
        auditLogId: auditLog.id,
        eventType: auditLog.eventType,
      });
    } catch (error) {
      logger.error("Failed to handle critical event", {
        error: error instanceof Error ? error.message : "Unknown error",
        auditLogId: auditLog.id,
      });
    }
  }

  /**
   * Handle HIPAA-sensitive audit events by logging to a secure system.
   */
  private async handleHIPAAEvent(auditLog: AuditLog): Promise<void> {
    try {
      auditLogger.info("HIPAA-sensitive event", {
        audtLogId: auditLog.id,
        eventType: auditLog.eventType,
        userId: auditLog.userId,
        patientId: auditLog.patientId,
        resourceId: auditLog.resourceId,
        resourceType: auditLog.resourceType,
        compliance: "HIPAA",
        success: auditLog.success,
        timestamp: auditLog.createdAt.toISOString(),
      });

      logger.info("HIPAA event handled", {
        auditLogId: auditLog.id,
        eventType: auditLog.eventType,
      });
    } catch (error) {
      logger.error("Failed to handle HIPAA event", {
        error: error instanceof Error ? error.message : "Unknown error",
        auditLogId: auditLog.id,
      });
    }
  }
}
