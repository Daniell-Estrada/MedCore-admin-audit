import { EventEmitter } from "events";
import { logger } from "@/utils/logger";
import { AuditService } from "./AuditService";
import { AUDIT_CONSTANTS } from "@/config/constants";

export interface MedCoreEvent {
  id: string;
  type: string;
  source: string;
  timestamp: Date;
  data: any;
  userId?: string;
  sessionId?: string;
}

/**
 * EventBus class to handle and emit events across the application
 * Extends Node.js EventEmitter to leverage event-driven architecture
 */
export class EventBus extends EventEmitter {
  private auditService: AuditService;

  constructor() {
    super();
    this.auditService = new AuditService();
    this.setupEventHandlers();
  }

  /**
   * Sets up event handlers for various user-related events
   */
  private setupEventHandlers(): void {
    // User Management Events (from ms-security)
    this.on("UserCreated", this.handleUserEvent.bind(this));
    this.on("UserUpdated", this.handleUserEvent.bind(this));
    this.on("UserDeactivated", this.handleUserEvent.bind(this));
    this.on("UserDeleted", this.handleUserEvent.bind(this));
    this.on("UserLogin", this.handleUserEvent.bind(this));
    this.on("UserLogout", this.handleUserEvent.bind(this));
  }

  /**
   * Handles user-related events and creates corresponding audit logs
   */
  private async handleUserEvent(event: MedCoreEvent): Promise<void> {
    try {
      const riskLevel =
        event.type === "UserDeactivated"
          ? AUDIT_CONSTANTS.RISK_LEVELS.HIGH
          : AUDIT_CONSTANTS.RISK_LEVELS.MEDIUM;

      await this.auditService.createAuditLog({
        eventType: event.type.toUpperCase(),
        userId: event.userId,
        userRole: event.data.userRole || AUDIT_CONSTANTS.USER_ROLES.SYSTEM,
        targetUserId: event.data.targetUserId || event.data.userId,
        action: this.getActionFromEventType(event.type),
        description: `Event event: ${event.type}`,
        resourceType: "USER",
        resourceId: event.data.targetUserId || event.data.userId,
        riskLevel,
        metadata: {
          source: event.source,
          eventId: event.id,
          ...event.data,
        },
        success: true,
      });
    } catch (error) {
      logger.error("Failed to handle user event", {
        error: error instanceof Error ? error.message : "Unknown error",
        event,
      });
    }
  }

  /**
   * Maps event types to action types for audit logging
   */
  private getActionFromEventType(eventType: string): string {
    if (eventType.includes("Created"))
      return AUDIT_CONSTANTS.ActionTypes.CREATE;
    if (eventType.includes("Updated"))
      return AUDIT_CONSTANTS.ActionTypes.UPDATE;
    if (eventType.includes("Cancelled"))
      return AUDIT_CONSTANTS.ActionTypes.DELETE;
    if (eventType.includes("Deleted"))
      return AUDIT_CONSTANTS.ActionTypes.DELETE;
    if (eventType.includes("Accessed")) return AUDIT_CONSTANTS.ActionTypes.READ;
    if (eventType.includes("Login")) return AUDIT_CONSTANTS.ActionTypes.READ;
    if (eventType.includes("Logout")) return AUDIT_CONSTANTS.ActionTypes.LOGOUT;
    return AUDIT_CONSTANTS.ActionTypes.ACCESS;
  }
}
