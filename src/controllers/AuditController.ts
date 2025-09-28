import type { Request, Response } from "express";
import type { AuditService } from "@/services/AuditService";
import type { EventBus } from "@/services/EventBus";
import { logger } from "@/utils/logger";
import type { AuditEventType, AuditSeverity } from "@/models/AuditLog";

export class AuditController {
  constructor(
    private auditService: AuditService,
    private eventBus: EventBus,
  ) {}

  /**
   * Receive an event from an external source.
   * Validates and queues the event for processing.
   */
  async receiveEvent(req: Request, res: Response): Promise<void> {
    try {
      const { eventType, eventData } = req.body;
      const success = this.eventBus.emit(eventType, eventData);
            logger.info("Event received and queued for processing", { eventType });
      if (!success) {
        res.status(400).json({ error: "No handler for event type" });
        return;
      }

      res.status(200).json({ message: "Event received successfully" });
    } catch (error) {
      logger.error("Failed to receive event", { error, body: req.body });
      res.status(500).json({ error: "Failed to process event" });
    }
  }

  /**
   * Retrieve audit logs with optional filtering and pagination.
   */
  async getAuditLogs(req: Request, res: Response): Promise<void> {
    try {
      const {
        page = "1",
        limit = "50",
        startDate,
        endDate,
        eventType,
        severity,
        userId,
        resourceType,
      } = req.query;

      const filters = {
        startDate: startDate ? new Date(startDate as string) : undefined,
        endDate: endDate ? new Date(endDate as string) : undefined,
        eventType: eventType as AuditEventType,
        severity: severity as AuditSeverity,
        userId: userId as string,
        resourceType: resourceType as string,
      };

      const result = await this.auditService.getAuditLogs(
        Number.parseInt(page as string),
        Number.parseInt(limit as string),
        filters,
      );

      res.json(result);
    } catch (error) {
      logger.error("Failed to get audit logs", { error, query: req.query });
      res.status(500).json({ error: "Failed to retrieve audit logs" });
    }
  }
}
