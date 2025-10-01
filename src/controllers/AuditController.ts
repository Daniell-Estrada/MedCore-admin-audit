import type { Request, Response } from "express";
import type { AuditService } from "@/services/AuditService";
import { logger } from "@/utils/logger";
import type { AuditEventType, AuditSeverity } from "@/models/AuditLog";

/**
 * AuditController handles HTTP requests related to audit logs.
 * It provides an endpoint to retrieve audit logs with filtering and pagination support.
 */
export class AuditController {
  constructor(private auditService: AuditService) {}

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
