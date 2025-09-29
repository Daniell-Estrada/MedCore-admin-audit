import { EventEmitter } from "events";
import { v4 as uuidv4 } from "uuid";
import type { Producer, Consumer, EachMessagePayload } from "kafkajs";
import { logger, auditLogger, securityLogger } from "@/utils/logger";
import { AuditService } from "@/services/AuditService";
import { AUDIT_CONSTANTS } from "@/config/constants";
import { AzureEventHubConfig } from "@/config/AzureEventHubConfig";
import { DatabaseConfig } from "@/config/database";

export interface MedCoreAuditEvent {
  eventId: string;
  eventType: string;
  source: string;
  timestamp: Date;
  userId?: string | undefined;
  sessionId?: string | undefined;
  severityLevel: string;
  data: Record<string, any>;
  hipaaCompliance?: {
    patientId?: string | undefined;
    accessReason?: string;
  };
  metadata?: Record<string, any>;
}

export interface EventProcessingResult {
  success: boolean;
  eventId: string;
  processedAt: Date;
  error?: string;
  retryCount?: number;
}

/**
 * EventBus class to handle event-driven architecture across MedCore microservices
 * Integrates with Azure Event Hub for reliable message processing
 */
export class EventBus extends EventEmitter {
  private auditService: AuditService;
  private producers: Map<string, Producer> = new Map();
  private consumers: Map<string, Consumer> = new Map();
  private isInitialized = false;
  private processingStats = {
    totalProcessed: 0,
    totalErrors: 0,
    lastProcessedAt: new Date(),
  };

  constructor() {
    super();
    this.auditService = new AuditService();
    this.setupEventHandlers();
  }

  /**
   * Initialize Event Hub connections and start consuming events
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      logger.warn("EventBus already initialized");
      return;
    }

    try {
      await this.initializeProducers();
      await this.initializeConsumers();
      this.isInitialized = true;

      logger.info("EventBus initialized successfully");
    } catch (error) {
      logger.error("Failed to initialize EventBus", { error });
      throw error;
    }
  }

  /**
   * Initialize producers for all event hubs
   */
  private async initializeProducers(): Promise<void> {
    const eventHubs = AzureEventHubConfig.getEventHubs();

    for (const [hubName, hubTopic] of Object.entries(eventHubs)) {
      try {
        const producer = await AzureEventHubConfig.createProducer(hubTopic);
        this.producers.set(hubName, producer);

        logger.info("Producer initialized", { hubName, hubTopic });
      } catch (error) {
        logger.error("Failed to initialize producer", { hubName, error });
        throw error;
      }
    }
  }

  /**
   * Initialize consumers for relevant event hubs
   */
  private async initializeConsumers(): Promise<void> {
    const eventHubs = AzureEventHubConfig.getEventHubs();

    const subscriptions = [
      { hub: "SECURITY", handler: this.handleSecurityEvents.bind(this) },
      { hub: "PATIENT", handler: this.handlePatientEvents.bind(this) },
      { hub: "CLINICAL", handler: this.handleClinicalEvents.bind(this) },
      { hub: "INVENTORY", handler: this.handleInventoryEvents.bind(this) },
      { hub: "SYSTEM", handler: this.handleSystemEvents.bind(this) },
    ];

    for (const { hub, handler } of subscriptions) {
      try {
        const consumer = await AzureEventHubConfig.createConsumer(
          eventHubs[hub as keyof typeof eventHubs],
        );

        await consumer.run({
          eachMessage: async (payload: EachMessagePayload) => {
            await this.processMessage(payload, handler);
          },
        });

        this.consumers.set(hub, consumer);
        logger.info("Consumer initialized", { hub });
      } catch (error) {
        logger.error("Failed to initialize consumer", { hub, error });
        throw error;
      }
    }
  }

  /**
   * Process incoming messages with error handling and retry logic
   */
  private async processMessage(
    payload: EachMessagePayload,
    handler: (event: MedCoreAuditEvent) => Promise<void>,
  ): Promise<void> {
    const { message, topic, partition } = payload;
    let eventData: MedCoreAuditEvent;

    try {
      eventData = JSON.parse(message.value?.toString() || "{}");

      if (!this.isValidEvent(eventData)) {
        throw new Error("Invalid event structure");
      }

      await this.trackEventProcessing(eventData.eventId, "PROCESSING", topic);

      await handler(eventData);

      await this.trackEventProcessing(eventData.eventId, "COMPLETED", topic);

      this.processingStats.totalProcessed++;
      this.processingStats.lastProcessedAt = new Date();

      logger.debug("Event processed successfully", {
        eventId: eventData.eventId,
        eventType: eventData.eventType,
        source: eventData.source,
        topic,
        partition,
      });
    } catch (error) {
      this.processingStats.totalErrors++;

      logger.error("Failed to process event", {
        error: error instanceof Error ? error.message : "Unknown error",
        topic,
        partition,
        eventId: eventData!.eventId,
      });

      await this.handleFailedEvent(eventData!, error as Error, topic);
    }
  }

  /**
   * Validate event structure
   */
  private isValidEvent(event: any): event is MedCoreAuditEvent {
    return (
      event &&
      typeof event.eventId === "string" &&
      typeof event.eventType === "string" &&
      typeof event.source === "string" &&
      event.timestamp &&
      typeof event.severityLevel === "string" &&
      event.data
    );
  }

  /**
   * Track event processing status in database
   */
  private async trackEventProcessing(
    eventId: string,
    status: string,
    source: string,
    error?: Error,
  ): Promise<void> {
    try {
      const prisma = DatabaseConfig.getInstance();

      await prisma.eventProcessingStatus.upsert({
        where: { eventId },
        update: {
          status,
          processedAt: status === "COMPLETED" ? new Date() : null,
          errorMessage: error?.message ?? null,
          lastError: error ? new Date() : null,
          retryCount: error ? { increment: 1 } : 0,
          updatedAt: new Date(),
        },
        create: {
          id: uuidv4(),
          eventId,
          eventType: "UNKNOWN",
          source,
          status,
          processedAt: status === "COMPLETED" ? new Date() : null,
          errorMessage: error?.message ?? null,
          lastError: error ? new Date() : null,
          retryCount: error ? 1 : 0,
        },
      });
    } catch (dbError) {
      logger.error("Failed to track event processing", {
        eventId,
        error: dbError,
      });
    }
  }

  /**
   * Handle failed events with retry logic and dead letter queue
   */
  private async handleFailedEvent(
    event: MedCoreAuditEvent,
    error: Error,
    topic: string,
  ): Promise<void> {
    try {
      const prisma = DatabaseConfig.getInstance();

      const processingStatus = await prisma.eventProcessingStatus.findUnique({
        where: { eventId: event.eventId },
      });

      const retryCount = (processingStatus?.retryCount || 0) + 1;
      const maxRetries = processingStatus?.maxRetries || 3;

      if (retryCount >= maxRetries) {
        await this.sendToDeadLetterQueue(event, error, topic);

        await prisma.eventProcessingStatus.update({
          where: { eventId: event.eventId },
          data: {
            status: "FAILED",
            sentToDLQ: true,
            dlqReason: `Max retries exceeded: ${error.message}`,
            updatedAt: new Date(),
          },
        });

        logger.error("Event sent to dead letter queue", {
          eventId: event.eventId,
          retryCount,
          error: error.message,
        });
      } else {
        await this.scheduleRetry(event, retryCount);

        logger.warn("Event scheduled for retry", {
          eventId: event.eventId,
          retryCount,
          maxRetries,
        });
      }
    } catch (handlingError) {
      logger.error("Failed to handle failed event", {
        eventId: event.eventId,
        originalError: error.message,
        handlingError,
      });
    }
  }

  /**
   * Send failed events to dead letter queue
   */
  private async sendToDeadLetterQueue(
    event: MedCoreAuditEvent,
    error: Error,
    originalTopic: string,
  ): Promise<void> {
    try {
      const dlqProducer = this.producers.get("DEAD_LETTER");
      if (!dlqProducer) {
        throw new Error("Dead letter queue producer not available");
      }

      const dlqMessage = {
        ...event,
        dlqMetadata: {
          originalTopic,
          error: error.message,
          failedAt: new Date().toISOString(),
          retryCount: 3,
        },
      };

      await dlqProducer.send({
        topic: AzureEventHubConfig.getEventHubs().DEAD_LETTER,
        messages: [
          {
            key: event.eventId,
            value: JSON.stringify(dlqMessage),
            timestamp: Date.now().toString(),
          },
        ],
      });

      logger.info("Event sent to dead letter queue", {
        eventId: event.eventId,
      });
    } catch (dlqError) {
      logger.error("Failed to send event to dead letter queue", {
        eventId: event.eventId,
        error: dlqError,
      });
    }
  }

  /**
   * Schedule event retry (simplified implementation)
   */
  private async scheduleRetry(
    event: MedCoreAuditEvent,
    retryCount: number,
  ): Promise<void> {
    const delay = Math.min(1000 * Math.pow(2, retryCount), 30000);

    setTimeout(async () => {
      try {
        switch (event.source) {
          case "ms-security":
            await this.handleSecurityEvents(event);
            break;
          case "ms-patientEHR":
            await this.handlePatientEvents(event);
            break;
          case "ms-clinical":
            await this.handleClinicalEvents(event);
            break;
          case "ms-inventory-billing":
            await this.handleInventoryEvents(event);
            break;
          default:
            await this.handleSystemEvents(event);
        }
      } catch (retryError) {
        logger.error("Event retry failed", {
          eventId: event.eventId,
          retryCount,
          error: retryError,
        });
      }
    }, delay);
  }

  /**
   * Publish event to specified Event Hub
   */
  async publishEvent(
    eventHubName: string,
    event: MedCoreAuditEvent,
  ): Promise<EventProcessingResult> {
    try {
      const producer = this.producers.get(eventHubName);
      if (!producer) {
        throw new Error(`Producer for ${eventHubName} not found`);
      }

      const eventHubs = AzureEventHubConfig.getEventHubs();
      const topic = eventHubs[eventHubName as keyof typeof eventHubs];

      await producer.send({
        topic,
        messages: [
          {
            key: event.eventId,
            value: JSON.stringify(event),
            timestamp: Date.now().toString(),
            headers: {
              source: event.source,
              eventType: event.eventType,
              severity: event.severityLevel,
            },
          },
        ],
      });

      logger.info("Event published successfully", {
        eventId: event.eventId,
        eventHubName,
        topic,
      });

      return {
        success: true,
        eventId: event.eventId,
        processedAt: new Date(),
      };
    } catch (error) {
      logger.error("Failed to publish event", {
        eventId: event.eventId,
        eventHubName,
        error,
      });

      return {
        success: false,
        eventId: event.eventId,
        processedAt: new Date(),
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Setup internal event handlers
   */
  private setupEventHandlers(): void {
    this.on("user.login", this.handleUserLogin.bind(this));
    this.on("user.logout", this.handleUserLogout.bind(this));
    this.on("user.login_failed", this.handleLoginFailed.bind(this));
    this.on("user.password_changed", this.handlePasswordChanged.bind(this));
    this.on("user.role_changed", this.handleRoleChanged.bind(this));
    this.on("user.2fa_enabled", this.handle2FAEnabled.bind(this));
    this.on("user.session_expired", this.handleSessionExpired.bind(this));

    this.on("system.error", this.handleSystemError.bind(this));
    this.on("system.maintenance", this.handleMaintenanceEvent.bind(this));
    this.on("system.backup", this.handleBackupEvent.bind(this));
  }

  // Event Handlers for different microservices

  /**
   * Handle security events from ms-security
   */
  private async handleSecurityEvents(event: MedCoreAuditEvent): Promise<void> {
    try {
      const metadata: Record<string, any> = { ...event.data };

      await this.auditService.createAuditLog({
        eventType: event.eventType as any,
        severityLevel: event.severityLevel as any,
        action: this.mapEventTypeToAction(event.eventType),
        userId: event.userId,
        userRole: event.data.role,
        resourceType: AUDIT_CONSTANTS.RESOURCE_TYPES.USER_ACCOUNT,
        resourceId: event.userId,
        description: `Security event: ${event.eventType}`,
        sessionId: event.sessionId,
        ipAddress: event.data.ipAddress,
        userAgent: event.data.userAgent,
        metadata,
        success: event.data.success !== false,
      });

      securityLogger.info("Security event processed", {
        eventId: event.eventId,
        eventType: event.eventType,
        userId: event.userId,
      });
    } catch (error) {
      logger.error("Failed to handle security event", { event, error });
      throw error;
    }
  }

  /**
   * Handle patient events from ms-patientEHR
   */
  private async handlePatientEvents(event: MedCoreAuditEvent): Promise<void> {
    try {
      const metadata: Record<string, any> = { ...event.data };

      await this.auditService.createAuditLog({
        eventType: event.eventType as any,
        severityLevel: event.severityLevel as any,
        action: this.mapEventTypeToAction(event.eventType),
        userId: event.userId,
        userRole: event.data.userRole,
        patientId: event.hipaaCompliance?.patientId,
        resourceType: AUDIT_CONSTANTS.RESOURCE_TYPES.PATIENT_RECORD,
        resourceId: event.data.resourceId,
        description: `Patient event: ${event.eventType}`,
        sessionId: event.sessionId,
        ipAddress: event.data.ipAddress,
        userAgent: event.data.userAgent,
        metadata,
        success: event.data.success !== false,
      });

      auditLogger.info("Patient event processed", {
        eventId: event.eventId,
        eventType: event.eventType,
        patientId: event.hipaaCompliance?.patientId,
        hipaaCompliant: true,
      });
    } catch (error) {
      logger.error("Failed to handle patient event", { event, error });
      throw error;
    }
  }

  /**
   * Handle clinical events from ms-clinical
   */
  private async handleClinicalEvents(event: MedCoreAuditEvent): Promise<void> {
    try {
      const metadata: Record<string, any> = { ...event.data };

      await this.auditService.createAuditLog({
        eventType: event.eventType as any,
        severityLevel: event.severityLevel as any,
        action: this.mapEventTypeToAction(event.eventType),
        userId: event.userId,
        userRole: event.data.userRole,
        patientId: event.data.patientId,
        resourceType: this.mapEventTypeToResourceType(event.eventType),
        resourceId: event.data.resourceId,
        description: `Clinical event: ${event.eventType}`,
        sessionId: event.sessionId,
        metadata,
        success: event.data.success !== false,
      });

      logger.info("Clinical event processed", {
        eventId: event.eventId,
        eventType: event.eventType,
        patientId: event.data.patientId,
      });
    } catch (error) {
      logger.error("Failed to handle clinical event", { event, error });
      throw error;
    }
  }

  /**
   * Handle inventory events from ms-inventory-billing
   */
  private async handleInventoryEvents(event: MedCoreAuditEvent): Promise<void> {
    try {
      const metadata: Record<string, any> = { ...event.data };

      await this.auditService.createAuditLog({
        eventType: event.eventType as any,
        severityLevel: event.severityLevel as any,
        action: this.mapEventTypeToAction(event.eventType),
        userId: event.userId,
        userRole: event.data.userRole,
        resourceType: this.mapEventTypeToResourceType(event.eventType),
        resourceId: event.data.resourceId,
        description: `Inventory/Billing event: ${event.eventType}`,
        sessionId: event.sessionId,
        metadata,
        success: event.data.success !== false,
      });

      logger.info("Inventory event processed", {
        eventId: event.eventId,
        eventType: event.eventType,
      });
    } catch (error) {
      logger.error("Failed to handle inventory event", { event, error });
      throw error;
    }
  }

  /**
   * Handle system events
   */
  private async handleSystemEvents(event: MedCoreAuditEvent): Promise<void> {
    try {
      const metadata: Record<string, any> = { ...event.data };

      await this.auditService.createAuditLog({
        eventType: event.eventType as any,
        severityLevel: event.severityLevel as any,
        action: this.mapEventTypeToAction(event.eventType),
        userId: event.userId || "SYSTEM",
        userRole: "SYSTEM" as any,
        resourceType: AUDIT_CONSTANTS.RESOURCE_TYPES.SYSTEM_CONFIG,
        resourceId: event.data.resourceId,
        description: `System event: ${event.eventType}`,
        sessionId: event.sessionId,
        metadata,
        success: event.data.success !== false,
      });

      logger.info("System event processed", {
        eventId: event.eventId,
        eventType: event.eventType,
      });
    } catch (error) {
      logger.error("Failed to handle system event", { event, error });
      throw error;
    }
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
        description: "User logged in successfully",
        sessionId: eventData.sessionId,
        ipAddress: eventData.ipAddress,
        userAgent: eventData.userAgent,
        metadata,
        success: true,
      });

      logger.info("User login event logged", { userId: eventData.userId });
    } catch (error) {
      logger.error("Failed to log user login event", { error, eventData });
    }
  }

  private async handleUserLogout(eventData: any): Promise<void> {
    try {
      await this.auditService.createAuditLog({
        eventType: AUDIT_CONSTANTS.EVENT_TYPES.USER_LOGOUT,
        severityLevel: AUDIT_CONSTANTS.SEVERITY_LEVELS.INFO,
        action: AUDIT_CONSTANTS.ACTION_TYPES.LOGOUT,
        userId: eventData.userId,
        userRole: eventData.role,
        resourceType: AUDIT_CONSTANTS.RESOURCE_TYPES.USER_ACCOUNT,
        resourceId: eventData.userId,
        description: "User logged out",
        sessionId: eventData.sessionId,
        ipAddress: eventData.ipAddress,
        metadata: { logoutReason: eventData.reason },
        success: true,
      });

      logger.info("User logout event logged", { userId: eventData.userId });
    } catch (error) {
      logger.error("Failed to log user logout event", { error, eventData });
    }
  }

  private async handleLoginFailed(eventData: any): Promise<void> {
    try {
      await this.auditService.createAuditLog({
        eventType: AUDIT_CONSTANTS.EVENT_TYPES.USER_LOGIN,
        severityLevel: AUDIT_CONSTANTS.SEVERITY_LEVELS.HIGH,
        action: AUDIT_CONSTANTS.ACTION_TYPES.LOGIN,
        userId: eventData.userId,
        resourceType: AUDIT_CONSTANTS.RESOURCE_TYPES.USER_ACCOUNT,
        resourceId: eventData.userId,
        description: "Failed login attempt",
        ipAddress: eventData.ipAddress,
        userAgent: eventData.userAgent,
        metadata: {
          failureReason: eventData.reason,
          attemptCount: eventData.attemptCount,
        },
        success: false,
        errorMessage: eventData.reason,
      });

      securityLogger.warn("Failed login attempt logged", {
        userId: eventData.userId,
        reason: eventData.reason,
      });
    } catch (error) {
      logger.error("Failed to log login failure event", { error, eventData });
    }
  }

  private async handlePasswordChanged(eventData: any): Promise<void> {
    try {
      await this.auditService.createAuditLog({
        eventType: AUDIT_CONSTANTS.EVENT_TYPES.USER_UPDATED,
        severityLevel: AUDIT_CONSTANTS.SEVERITY_LEVELS.MEDIUM,
        action: AUDIT_CONSTANTS.ACTION_TYPES.UPDATE,
        userId: eventData.userId,
        userRole: eventData.role,
        resourceType: AUDIT_CONSTANTS.RESOURCE_TYPES.USER_ACCOUNT,
        resourceId: eventData.userId,
        description: "User password changed",
        sessionId: eventData.sessionId,
        ipAddress: eventData.ipAddress,
        metadata: { changeMethod: eventData.method },
        success: true,
      });

      logger.info("Password change event logged", { userId: eventData.userId });
    } catch (error) {
      logger.error("Failed to log password change event", { error, eventData });
    }
  }

  private async handleRoleChanged(eventData: any): Promise<void> {
    try {
      await this.auditService.createAuditLog({
        eventType: AUDIT_CONSTANTS.EVENT_TYPES.USER_UPDATED,
        severityLevel: AUDIT_CONSTANTS.SEVERITY_LEVELS.HIGH,
        action: AUDIT_CONSTANTS.ACTION_TYPES.UPDATE,
        userId: eventData.adminUserId,
        userRole: eventData.adminRole,
        targetUserId: eventData.targetUserId,
        resourceType: AUDIT_CONSTANTS.RESOURCE_TYPES.USER_ACCOUNT,
        resourceId: eventData.targetUserId,
        description: "User role changed",
        sessionId: eventData.sessionId,
        ipAddress: eventData.ipAddress,
        metadata: {
          oldRole: eventData.oldRole,
          newRole: eventData.newRole,
        },
        success: true,
      });

      logger.info("Role change event logged", {
        targetUserId: eventData.targetUserId,
        oldRole: eventData.oldRole,
        newRole: eventData.newRole,
      });
    } catch (error) {
      logger.error("Failed to log role change event", { error, eventData });
    }
  }

  private async handle2FAEnabled(eventData: any): Promise<void> {
    try {
      await this.auditService.createAuditLog({
        eventType: AUDIT_CONSTANTS.EVENT_TYPES.USER_UPDATED,
        severityLevel: AUDIT_CONSTANTS.SEVERITY_LEVELS.MEDIUM,
        action: AUDIT_CONSTANTS.ACTION_TYPES.UPDATE,
        userId: eventData.userId,
        userRole: eventData.role,
        resourceType: AUDIT_CONSTANTS.RESOURCE_TYPES.USER_ACCOUNT,
        resourceId: eventData.userId,
        description: "Two-factor authentication enabled",
        sessionId: eventData.sessionId,
        ipAddress: eventData.ipAddress,
        metadata: { method: eventData.method },
        success: true,
      });

      logger.info("2FA enabled event logged", { userId: eventData.userId });
    } catch (error) {
      logger.error("Failed to log 2FA enabled event", { error, eventData });
    }
  }

  private async handleSessionExpired(eventData: any): Promise<void> {
    try {
      await this.auditService.createAuditLog({
        eventType: AUDIT_CONSTANTS.EVENT_TYPES.USER_LOGOUT,
        severityLevel: AUDIT_CONSTANTS.SEVERITY_LEVELS.INFO,
        action: AUDIT_CONSTANTS.ACTION_TYPES.LOGOUT,
        userId: eventData.userId,
        userRole: eventData.role,
        resourceType: AUDIT_CONSTANTS.RESOURCE_TYPES.USER_ACCOUNT,
        resourceId: eventData.userId,
        description: "User session expired",
        sessionId: eventData.sessionId,
        metadata: {
          expirationReason: "TIMEOUT",
          lastActivity: eventData.lastActivity,
        },
        success: true,
      });

      logger.info("Session expiration event logged", {
        userId: eventData.userId,
      });
    } catch (error) {
      logger.error("Failed to log session expiration event", {
        error,
        eventData,
      });
    }
  }

  private async handleSystemError(eventData: any): Promise<void> {
    try {
      await this.auditService.createAuditLog({
        eventType: AUDIT_CONSTANTS.EVENT_TYPES.SYSTEM_ERROR,
        severityLevel:
          eventData.severity || AUDIT_CONSTANTS.SEVERITY_LEVELS.HIGH,
        action: AUDIT_CONSTANTS.ACTION_TYPES.ERROR,
        userId: "SYSTEM",
        userRole: AUDIT_CONSTANTS.USER_ROLES.SYSTEM,
        resourceType: AUDIT_CONSTANTS.RESOURCE_TYPES.SYSTEM_CONFIG,
        description: `System error: ${eventData.message}`,
        metadata: {
          errorCode: eventData.code,
          stackTrace: eventData.stack,
          component: eventData.component,
        },
        success: false,
        errorMessage: eventData.message,
      });

      logger.error("System error event logged", {
        message: eventData.message,
        code: eventData.code,
      });
    } catch (error) {
      logger.error("Failed to log system error event", { error, eventData });
    }
  }

  private async handleMaintenanceEvent(eventData: any): Promise<void> {
    try {
      await this.auditService.createAuditLog({
        eventType: AUDIT_CONSTANTS.EVENT_TYPES.MAINTENANCE_SCHEDULED,
        severityLevel: AUDIT_CONSTANTS.SEVERITY_LEVELS.MEDIUM,
        action: AUDIT_CONSTANTS.ACTION_TYPES.UPDATE,
        userId: eventData.scheduledBy,
        userRole: AUDIT_CONSTANTS.USER_ROLES.ADMIN,
        resourceType: AUDIT_CONSTANTS.RESOURCE_TYPES.SYSTEM_CONFIG,
        description: `Maintenance ${eventData.action}: ${eventData.title}`,
        metadata: {
          startTime: eventData.startTime,
          endTime: eventData.endTime,
          affectedServices: eventData.affectedServices,
        },
        success: true,
      });

      logger.info("Maintenance event logged", {
        action: eventData.action,
        title: eventData.title,
      });
    } catch (error) {
      logger.error("Failed to log maintenance event", { error, eventData });
    }
  }

  private async handleBackupEvent(eventData: any): Promise<void> {
    try {
      await this.auditService.createAuditLog({
        eventType: eventData.success
          ? AUDIT_CONSTANTS.EVENT_TYPES.BACKUP_CREATED
          : AUDIT_CONSTANTS.EVENT_TYPES.SYSTEM_ERROR,
        severityLevel: eventData.success
          ? AUDIT_CONSTANTS.SEVERITY_LEVELS.INFO
          : AUDIT_CONSTANTS.SEVERITY_LEVELS.HIGH,
        action: AUDIT_CONSTANTS.ACTION_TYPES.CREATE,
        userId: eventData.initiatedBy || "SYSTEM",
        userRole: AUDIT_CONSTANTS.USER_ROLES.SYSTEM,
        resourceType: AUDIT_CONSTANTS.RESOURCE_TYPES.SYSTEM_CONFIG,
        description: `Backup ${eventData.success ? "completed" : "failed"}`,
        metadata: {
          backupType: eventData.type,
          filePath: eventData.filePath,
          fileSize: eventData.fileSize,
          duration: eventData.duration,
        },
        success: eventData.success,
        errorMessage: eventData.error,
      });

      logger.info("Backup event logged", {
        success: eventData.success,
        type: eventData.type,
      });
    } catch (error) {
      logger.error("Failed to log backup event", { error, eventData });
    }
  }

  private mapEventTypeToAction(eventType: string): string {
    const actionMap: Record<string, string> = {
      USER_LOGIN: AUDIT_CONSTANTS.ACTION_TYPES.LOGIN,
      USER_LOGOUT: AUDIT_CONSTANTS.ACTION_TYPES.LOGOUT,
      USER_CREATED: AUDIT_CONSTANTS.ACTION_TYPES.CREATE,
      USER_UPDATED: AUDIT_CONSTANTS.ACTION_TYPES.UPDATE,
      USER_DEACTIVATED: AUDIT_CONSTANTS.ACTION_TYPES.DELETE,
      PATIENT_CREATED: AUDIT_CONSTANTS.ACTION_TYPES.CREATE,
      PATIENT_UPDATED: AUDIT_CONSTANTS.ACTION_TYPES.UPDATE,
      PATIENT_ACCESSED: AUDIT_CONSTANTS.ACTION_TYPES.ACCESS,
      EHR_CREATED: AUDIT_CONSTANTS.ACTION_TYPES.CREATE,
      EHR_UPDATED: AUDIT_CONSTANTS.ACTION_TYPES.UPDATE,
      EHR_ACCESSED: AUDIT_CONSTANTS.ACTION_TYPES.ACCESS,
      DOCUMENT_UPLOADED: AUDIT_CONSTANTS.ACTION_TYPES.CREATE,
      DOCUMENT_ACCESSED: AUDIT_CONSTANTS.ACTION_TYPES.ACCESS,
      APPOINTMENT_CREATED: AUDIT_CONSTANTS.ACTION_TYPES.CREATE,
      APPOINTMENT_UPDATED: AUDIT_CONSTANTS.ACTION_TYPES.UPDATE,
      APPOINTMENT_CANCELLED: AUDIT_CONSTANTS.ACTION_TYPES.DELETE,
      PRESCRIPTION_CREATED: AUDIT_CONSTANTS.ACTION_TYPES.CREATE,
      PRESCRIPTION_UPDATED: AUDIT_CONSTANTS.ACTION_TYPES.UPDATE,
      ORDER_PLACED: AUDIT_CONSTANTS.ACTION_TYPES.CREATE,
      INVENTORY_UPDATED: AUDIT_CONSTANTS.ACTION_TYPES.UPDATE,
      INVOICE_CREATED: AUDIT_CONSTANTS.ACTION_TYPES.CREATE,
      BACKUP_CREATED: AUDIT_CONSTANTS.ACTION_TYPES.CREATE,
      SYSTEM_ERROR: AUDIT_CONSTANTS.ACTION_TYPES.ERROR,
    };

    return actionMap[eventType] || AUDIT_CONSTANTS.ACTION_TYPES.ACCESS;
  }

  private mapEventTypeToResourceType(eventType: string): string {
    const resourceMap: Record<string, string> = {
      PATIENT_CREATED: AUDIT_CONSTANTS.RESOURCE_TYPES.PATIENT_RECORD,
      PATIENT_UPDATED: AUDIT_CONSTANTS.RESOURCE_TYPES.PATIENT_RECORD,
      PATIENT_ACCESSED: AUDIT_CONSTANTS.RESOURCE_TYPES.PATIENT_RECORD,
      EHR_CREATED: AUDIT_CONSTANTS.RESOURCE_TYPES.PATIENT_RECORD,
      EHR_UPDATED: AUDIT_CONSTANTS.RESOURCE_TYPES.PATIENT_RECORD,
      EHR_ACCESSED: AUDIT_CONSTANTS.RESOURCE_TYPES.PATIENT_RECORD,
      APPOINTMENT_CREATED: AUDIT_CONSTANTS.RESOURCE_TYPES.APPOINTMENT,
      APPOINTMENT_UPDATED: AUDIT_CONSTANTS.RESOURCE_TYPES.APPOINTMENT,
      APPOINTMENT_CANCELLED: AUDIT_CONSTANTS.RESOURCE_TYPES.APPOINTMENT,
      PRESCRIPTION_CREATED: AUDIT_CONSTANTS.RESOURCE_TYPES.PRESCRIPTION,
      PRESCRIPTION_UPDATED: AUDIT_CONSTANTS.RESOURCE_TYPES.PRESCRIPTION,
      INVOICE_CREATED: AUDIT_CONSTANTS.RESOURCE_TYPES.BILLING_INFO,
    };

    return (
      resourceMap[eventType] || AUDIT_CONSTANTS.RESOURCE_TYPES.SYSTEM_CONFIG
    );
  }

  /**
   * Get processing statistics
   */
  getProcessingStats() {
    return {
      ...this.processingStats,
      isInitialized: this.isInitialized,
      activeProducers: this.producers.size,
      activeConsumers: this.consumers.size,
    };
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    try {
      logger.info("Shutting down EventBus...");

      for (const [hubName, consumer] of this.consumers) {
        await consumer.disconnect();
        logger.info("Consumer disconnected", { hubName });
      }

      for (const [hubName, producer] of this.producers) {
        await producer.disconnect();
        logger.info("Producer disconnected", { hubName });
      }

      await AzureEventHubConfig.disconnectAll();

      this.isInitialized = false;
      logger.info("EventBus shutdown completed");
    } catch (error) {
      logger.error("Error during EventBus shutdown", { error });
      throw error;
    }
  }
}

export const eventBus = new EventBus();
