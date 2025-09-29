import { v4 as uuidv4 } from "uuid";
import { logger } from "@/utils/logger";
import { DatabaseConfig } from "@/config/database";
import { eventBus, type MedCoreAuditEvent } from "@/services/EventBus";
import { AUDIT_CONSTANTS } from "@/config/constants";

export interface EventReplayOptions {
  startDate: Date;
  endDate: Date;
  eventTypes?: (keyof typeof AUDIT_CONSTANTS.EVENT_TYPES)[];
  sources?: string[];
  maxEvents?: number;
}

export interface EventReplayResult {
  success: boolean;
  eventsReplayed: number;
  errors: string[];
  startedAt: Date;
  completedAt: Date;
}

/**
 * Service for advanced event processing operations
 * Handles event replay, dead letter queue management, and event analytics
 */
export class EventProcessingService {
  private prisma = DatabaseConfig.getInstance();

  /**
   * Replay events from a specific time range
   * Useful for recovering from system failures or reprocessing events
   */
  async replayEvents(options: EventReplayOptions): Promise<EventReplayResult> {
    const startedAt = new Date();
    const errors: string[] = [];
    let eventsReplayed = 0;

    try {
      logger.info("Starting event replay", { options });

      const auditLogs = await this.prisma.auditLog.findMany({
        where: {
          createdAt: {
            gte: options.startDate,
            lte: options.endDate,
          },
          ...(options.eventTypes && {
            eventType: { in: options.eventTypes },
          }),
        },
        orderBy: { createdAt: "asc" },
        take: options.maxEvents || 1000,
      });

      logger.info(`Found ${auditLogs.length} events to replay`);

      for (const auditLog of auditLogs) {
        try {
          const event: MedCoreAuditEvent = {
            eventId: uuidv4(),
            eventType: auditLog.eventType,
            source: "ms-admin-audit-replay",
            timestamp: auditLog.createdAt,
            userId: auditLog.userId || undefined,
            sessionId: auditLog.sessionId || undefined,
            severityLevel: auditLog.severityLevel,
            data: {
              originalEventId: auditLog.id,
              replayedAt: new Date(),
              ...(auditLog.metadata as Record<string, any>),
            },
            hipaaCompliance: auditLog.patientId
              ? {
                  patientId: auditLog.patientId,
                  accessReason: "EVENT_REPLAY",
                }
              : {},
          };

          const targetHub = this.determineEventHub(auditLog.eventType);
          const result = await eventBus.publishEvent(targetHub, event);

          if (result.success) {
            eventsReplayed++;
          } else {
            errors.push(
              `Failed to replay event ${auditLog.id}: ${result.error}`,
            );
          }
        } catch (error) {
          const errorMsg = `Error replaying event ${auditLog.id}: ${error}`;
          errors.push(errorMsg);
          logger.error(errorMsg, { auditLogId: auditLog.id, error });
        }
      }

      const completedAt = new Date();

      logger.info("Event replay completed", {
        eventsReplayed,
        errors: errors.length,
        duration: completedAt.getTime() - startedAt.getTime(),
      });

      return {
        success: errors.length === 0,
        eventsReplayed,
        errors,
        startedAt,
        completedAt,
      };
    } catch (error) {
      logger.error("Event replay failed", { error, options });

      return {
        success: false,
        eventsReplayed,
        errors: [...errors, `Replay failed: ${error}`],
        startedAt,
        completedAt: new Date(),
      };
    }
  }

  /**
   * Process events from dead letter queue
   * Attempts to reprocess failed events after investigation
   */
  async processDeadLetterQueue(maxEvents = 100): Promise<{
    processed: number;
    errors: string[];
  }> {
    const errors: string[] = [];
    let processed = 0;

    try {
      logger.info("Processing dead letter queue", { maxEvents });

      const failedEvents = await this.prisma.eventProcessingStatus.findMany({
        where: {
          status: "FAILED",
          sentToDLQ: false,
        },
        take: maxEvents,
        orderBy: { createdAt: "asc" },
      });

      for (const failedEvent of failedEvents) {
        try {
          await this.prisma.eventProcessingStatus.update({
            where: { id: failedEvent.id },
            data: {
              status: "PROCESSING",
              retryCount: { increment: 1 },
              updatedAt: new Date(),
            },
          });

          const reprocessEvent: MedCoreAuditEvent = {
            eventId: uuidv4(),
            eventType: failedEvent.eventType,
            source: failedEvent.source,
            timestamp: new Date(),
            severityLevel: "MEDIUM",
            data: {
              originalEventId: failedEvent.eventId,
              reprocessedAt: new Date(),
              previousErrors: failedEvent.errorMessage,
              retryCount: failedEvent.retryCount,
            },
          };

          const targetHub = this.determineEventHub(failedEvent.eventType);

          const result = await eventBus.publishEvent(targetHub, reprocessEvent);

          if (result.success) {
            await this.prisma.eventProcessingStatus.update({
              where: { id: failedEvent.id },
              data: {
                status: "COMPLETED",
                processedAt: new Date(),
                updatedAt: new Date(),
              },
            });
            processed++;
          } else {
            await this.prisma.eventProcessingStatus.update({
              where: { id: failedEvent.id },
              data: {
                status: "FAILED",
                sentToDLQ: true,
                dlqReason: result.error ?? null,
                updatedAt: new Date(),
              },
            });
            errors.push(
              `Failed to reprocess event ${failedEvent.eventId}: ${result.error}`,
            );
          }
        } catch (error) {
          const errorMsg = `Error processing DLQ event ${failedEvent.eventId}: ${error}`;
          errors.push(errorMsg);
          logger.error(errorMsg, { eventId: failedEvent.eventId, error });
        }
      }

      logger.info("Dead letter queue processing completed", {
        processed,
        errors: errors.length,
      });

      return { processed, errors };
    } catch (error) {
      logger.error("Failed to process dead letter queue", { error });
      return {
        processed,
        errors: [...errors, `DLQ processing failed: ${error}`],
      };
    }
  }

  /**
   * Get event processing analytics
   */
  async getEventAnalytics(days = 7): Promise<{
    totalEvents: number;
    successfulEvents: number;
    failedEvents: number;
    eventsByType: Record<string, number>;
    eventsBySource: Record<string, number>;
    processingTrends: Array<{
      date: string;
      total: number;
      successful: number;
      failed: number;
    }>;
  }> {
    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const [totalEvents, successfulEvents, failedEvents] = await Promise.all([
        this.prisma.eventProcessingStatus.count({
          where: { createdAt: { gte: startDate } },
        }),
        this.prisma.eventProcessingStatus.count({
          where: {
            createdAt: { gte: startDate },
            status: "COMPLETED",
          },
        }),
        this.prisma.eventProcessingStatus.count({
          where: {
            createdAt: { gte: startDate },
            status: "FAILED",
          },
        }),
      ]);

      const eventsByTypeRaw = await this.prisma.eventProcessingStatus.groupBy({
        by: ["eventType"],
        where: { createdAt: { gte: startDate } },
        _count: { eventType: true },
      });

      const eventsByType = eventsByTypeRaw.reduce(
        (acc, item) => {
          acc[item.eventType] = item._count.eventType;
          return acc;
        },
        {} as Record<string, number>,
      );

      const eventsBySourceRaw = await this.prisma.eventProcessingStatus.groupBy(
        {
          by: ["source"],
          where: { createdAt: { gte: startDate } },
          _count: { source: true },
        },
      );

      const eventsBySource = eventsBySourceRaw.reduce(
        (acc, item) => {
          acc[item.source] = item._count.source;
          return acc;
        },
        {} as Record<string, number>,
      );

      const processingTrends = [];
      for (let i = days - 1; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().split("T")[0];

        const dayStart = new Date(date);
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(date);
        dayEnd.setHours(23, 59, 59, 999);

        const [total, successful, failed] = await Promise.all([
          this.prisma.eventProcessingStatus.count({
            where: {
              createdAt: { gte: dayStart, lte: dayEnd },
            },
          }),
          this.prisma.eventProcessingStatus.count({
            where: {
              createdAt: { gte: dayStart, lte: dayEnd },
              status: "COMPLETED",
            },
          }),
          this.prisma.eventProcessingStatus.count({
            where: {
              createdAt: { gte: dayStart, lte: dayEnd },
              status: "FAILED",
            },
          }),
        ]);

        processingTrends.push({
          date: dateStr,
          total,
          successful,
          failed,
        });
      }

      return {
        totalEvents,
        successfulEvents,
        failedEvents,
        eventsByType,
        eventsBySource,
        processingTrends,
      };
    } catch (error) {
      logger.error("Failed to get event analytics", { error });
      throw error;
    }
  }

  /**
   * Clean up old event processing records
   */
  async cleanupEventProcessingRecords(olderThanDays = 30): Promise<number> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

      const result = await this.prisma.eventProcessingStatus.deleteMany({
        where: {
          createdAt: { lt: cutoffDate },
          status: "COMPLETED",
        },
      });

      logger.info("Event processing records cleaned up", {
        deletedRecords: result.count,
        cutoffDate,
      });

      return result.count;
    } catch (error) {
      logger.error("Failed to cleanup event processing records", { error });
      throw error;
    }
  }

  /**
   * Determine which event hub to use based on event type
   */
  private determineEventHub(eventType: string): string {
    const eventHubMap: Record<string, string> = {
      USER_LOGIN: "SECURITY",
      USER_LOGOUT: "SECURITY",
      USER_CREATED: "SECURITY",
      USER_UPDATED: "SECURITY",
      USER_DEACTIVATED: "SECURITY",
      SECURITY_VIOLATION: "SECURITY",
      PATIENT_CREATED: "PATIENT",
      PATIENT_UPDATED: "PATIENT",
      PATIENT_ACCESSED: "PATIENT",
      EHR_CREATED: "PATIENT",
      EHR_UPDATED: "PATIENT",
      EHR_ACCESSED: "PATIENT",
      DOCUMENT_UPLOADED: "PATIENT",
      DOCUMENT_ACCESSED: "PATIENT",
      APPOINTMENT_CREATED: "CLINICAL",
      APPOINTMENT_UPDATED: "CLINICAL",
      APPOINTMENT_CANCELLED: "CLINICAL",
      PRESCRIPTION_CREATED: "CLINICAL",
      PRESCRIPTION_UPDATED: "CLINICAL",
      ORDER_PLACED: "CLINICAL",
      WORKFLOW_STEP_COMPLETED: "CLINICAL",
      INVENTORY_UPDATED: "INVENTORY",
      INVOICE_CREATED: "INVENTORY",
      BACKUP_CREATED: "SYSTEM",
      BACKUP_RESTORED: "SYSTEM",
      POLICY_UPDATED: "SYSTEM",
      MAINTENANCE_SCHEDULED: "SYSTEM",
      SYSTEM_ERROR: "SYSTEM",
    };

    return eventHubMap[eventType] || "SYSTEM";
  }
}
