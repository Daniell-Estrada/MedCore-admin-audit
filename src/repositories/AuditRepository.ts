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
import { API_CONSTANTS } from "@/constants/constants";
import type { AuditEventType, AuditSeverity } from "@/models/AuditLog";

/**
 * Filters for querying audit logs.
 */
export interface AuditQueryFilters {
  eventType?: string;
  userId?: string;
  patientId?: string;
  resourceType?: string;
  severityLevel?: string;
  startDate?: Date | undefined;
  endDate?: Date | undefined;
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
 * AuditRepository class responsible for managing audit logs.
 * This repository provides methods to create and handle audit logs,
 * including special handling for critical and HIPAA-sensitive events.
 */
export class AuditRepository {
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
        savedLog.severityLevel,
        (savedLog.metadata as Record<string, any>) || undefined,
        savedLog.success,
        savedLog.errorMessage || undefined,
      );

      auditLogger.info("Audit log created", {
        id: auditLog.id,
        eventType: auditLog.eventType,
        userId: auditLog.userId,
        patientId: auditLog.patientId,
        severityLevel: auditLog.severityLevel,
        success: auditLog.success,
      });

      if (auditLog.requiresImmediateAttention()) {
        await this.handleCriticalEvent(auditLog);
      }

      if (auditLog.isHIPAASensitive()) {
        await this.handleHIPAAEvent(auditLog);
      }

      logger.info("Audit log created successfully", {
        auditLogId: auditLog.id,
        eventType: auditLog.eventType,
        userId: auditLog.userId,
      });

      return auditLog;
    } catch (error) {
      logger.error("Failed to create audit log", {
        error: error instanceof Error ? error.message : "Unknown error",
      });
      throw new Error("Failed to create audit log");
    }
  }

  /**
   * Query audit logs with filtering and pagination.
   */
  async queryAuditLogs(filters: AuditQueryFilters): Promise<AuditQueryResult> {
    try {
      const page = Math.max(1, filters.page || 1);
      const limit = Math.min(
        API_CONSTANTS.MAX_PAGE_SIZE,
        filters.limit || API_CONSTANTS.DEFAULT_PAGE_SIZE,
      );
      const skip = (page - 1) * limit;
      const where: any = {};

      if (filters.eventType) where.eventType = filters.eventType;
      if (filters.userId) where.userId = filters.userId;
      if (filters.patientId) where.patientId = filters.patientId;
      if (filters.resourceType) where.resourceType = filters.resourceType;
      if (filters.severityLevel) where.severityLevel = filters.severityLevel;
      if (filters.success !== undefined) where.success = filters.success;

      if (filters.startDate || filters.endDate) {
        where.createdAt = {};
        if (filters.startDate) where.createdAt.gte = filters.startDate;
        if (filters.endDate) where.createdAt.lte = filters.endDate;
      }

      const [logs, total] = await Promise.all([
        this.prisma.auditLog.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip,
          take: limit,
        }),
        this.prisma.auditLog.count({ where }),
      ]);

      const auditLogs = logs.map(
        (log) =>
          new AuditLog(
            log.id,
            log.eventType,
            log.action,
            log.createdAt,
            log.userId || undefined,
            log.userRole || undefined,
            log.targetUserId || undefined,
            log.patientId || undefined,
            log.resourceType || undefined,
            log.resourceId || undefined,
            log.description || undefined,
            log.ipAddress || undefined,
            log.userAgent || undefined,
            log.sessionId || undefined,
            log.severityLevel,
            (log.metadata as Record<string, any>) || undefined,
            log.success,
            log.errorMessage || undefined,
          ),
      );

      const totalPages = Math.ceil(total / limit);

      logger.info("Audit logs queried successfully", {
        total,
        page,
        limit,
        filters,
      });

      return {
        logs: auditLogs,
        total,
        page,
        limit,
        totalPages,
      };
    } catch (error) {
      logger.error("Failed to query audit logs", {
        error: error instanceof Error ? error.message : "Unknown error",
        filters,
      });
      throw new Error("Failed to query audit logs");
    }
  }

  /**
   * Public method to get audit logs with pagination and filtering.
   */
  async getAuditLogs(
    page = 1,
    limit = 20,
    filters: {
      startDate?: Date | undefined;
      endDate?: Date | undefined;
      eventType?: AuditEventType;
      severity?: AuditSeverity;
      userId?: string;
      resourceType?: string;
      patientId?: string;
      success?: boolean;
    } = {},
  ): Promise<AuditQueryResult> {
    return this.queryAuditLogs({
      page,
      limit,
      ...filters,
    });
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
        severityLevel: auditLog.severityLevel,
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
            severityLevel: auditLog.severityLevel,
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
