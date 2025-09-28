import { EventEmitter } from "events";
import { logger } from "@/utils/logger";
import { AuditService } from "@/services/AuditService";
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
    this.on("user.login", this.handleUserLogin.bind(this));
    // this.on("user.logout", this.handleUserLogout.bind(this))
    // this.on("user.login_failed", this.handleLoginFailed.bind(this))
    // this.on("user.password_changed", this.handlePasswordChanged.bind(this))
    // this.on("user.role_changed", this.handleRoleChanged.bind(this))
  }

  private async handleUserLogin(eventData: any): Promise<void> {
    try {
      const metadata: Record<string, any> = {};
      if (eventData.department) metadata.department = eventData.department;
      if (eventData.loginMethod) metadata.loginMethod = eventData.loginMethod;

      await this.auditService.createAuditLog({
        eventType: AUDIT_CONSTANTS.EVENT_TYPES.USER_LOGIN,
        severityLevel: AUDIT_CONSTANTS.SEVERITY_LEVELS.INFO,
        action: AUDIT_CONSTANTS.ACTION_TYPES.LOGIN,
        userId: eventData.userId,
        userRole: eventData.role,
        resourceType: AUDIT_CONSTANTS.RESOURCE_TYPES.USER_ACCOUNT,
        resourceId: eventData.userId,
        description: "User logged in",
        sessionId: eventData.sessionId,
        ipAddress: eventData.ipAddress,
        userAgent: eventData.userAgent,
        metadata,
        success: true,
      });
      logger.info("User login event logged", { eventData });
    } catch (error) {
      logger.error("Failed to log user login event", { error, eventData });
    }
  }
}
