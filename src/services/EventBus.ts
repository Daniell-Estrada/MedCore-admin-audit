import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import type { Producer, Consumer, EachMessagePayload } from "kafkajs";
import { logger, auditLogger, securityLogger } from "@/utils/logger";
import { AuditRepository } from "@/repositories/AuditRepository";
import { AUDIT_CONSTANTS } from "@/constants/auditConstants";
import { AzureEventHubConfig } from "@/config/AzureEventHubConfig";
import { DatabaseConfig } from "@/config/database";
import {
  mapEventTypeToAction,
  mapEventTypeToResourceType,
} from "@/utils/mappings";
import { AuditLog, AuditLogSchema } from "@/models/AuditLog";

export interface EventProcessingResult {
  success: boolean;
  id: string;
  processedAt: Date;
  error?: string;
  retryCount?: number;
}

/**
 * EventBus class to handle event-driven architecture across MedCore microservices
 * Integrates with Azure Event Hub for reliable message processing
 */
export class EventBus extends EventEmitter {
  private auditRepository: AuditRepository;
  private producers: Map<string, Producer> = new Map();
  private consumers: Map<string, Consumer> = new Map();
  private isInitialized = false;
  private connectionMonitoringInterval?: NodeJS.Timeout;
  private isRecovering = false;
  private processingStats = {
    totalProcessed: 0,
    totalErrors: 0,
    lastProcessedAt: new Date(),
  };

  constructor() {
    super();
    this.auditRepository = new AuditRepository();
  }

  /**
   * Initialize Event Hub connections and start consuming events
   */
  async initialize(): Promise<void> {
    logger.info("Initializing EventBus...");
    if (this.isInitialized) {
      logger.warn("EventBus already initialized");
      return;
    }

    try {
      await this.initializeProducers();
      await this.initializeConsumers();
      this.startConnectionMonitoring();
      this.isInitialized = true;

      logger.info("EventBus initialized successfully");
    } catch (error) {
      logger.error("Failed to initialize EventBus", { error });
      throw error;
    }
  }

  /**
   * Start connection monitoring to detect and recover from connection issues
   */
  private startConnectionMonitoring(): void {
    this.connectionMonitoringInterval = setInterval(async () => {
      if (this.isRecovering) return;

      try {
        const isHealthy = await AzureEventHubConfig.healthCheck();
        if (!isHealthy) {
          logger.warn("Event Hub health check failed, attempting recovery");
          await this.recoverConnections();
        }
      } catch (error) {
        logger.error("Connection monitoring error", { error });
      }
    }, 60000);
  }

  /**
   * Recover from connection failures
   */
  private async recoverConnections(): Promise<void> {
    if (this.isRecovering) return;

    this.isRecovering = true;
    logger.info("Starting connection recovery");

    try {
      await AzureEventHubConfig.disconnectAll();
      await new Promise((resolve) => setTimeout(resolve, 5000));

      await this.initializeProducers();
      await this.initializeConsumers();

      logger.info("Connection recovery completed");
    } catch (error) {
      logger.error("Connection recovery failed", { error });
    } finally {
      this.isRecovering = false;
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
   * Initialize consumers for relevant event hubs with staggered startup to reduce rebalancing
   */
  private async initializeConsumers(): Promise<void> {
    const eventHubs = AzureEventHubConfig.getEventHubs();

    const subscriptions = [
      {
        hub: "SECURITY",
        handler: this.handleSecurityEvents.bind(this),
        topic: eventHubs.SECURITY,
      },
      {
        hub: "PATIENT",
        handler: this.handlePatientEvents.bind(this),
        topic: eventHubs.PATIENT,
      },
      {
        hub: "CLINICAL",
        handler: this.handleClinicalEvents.bind(this),
        topic: eventHubs.CLINICAL,
      },
      {
        hub: "SYSTEM",
        handler: this.handleSystemEvents.bind(this),
        topic: eventHubs.SYSTEM,
      },
    ];

    // Initialize consumers with staggered delays to reduce rebalancing storms
    for (let i = 0; i < subscriptions.length; i++) {
      const { hub, handler, topic } = subscriptions[i];

      try {
        if (i > 0) {
          const delay = 10000 + i * 5000; // 10s, 15s, 20s, 25s, 30s
          logger.info(`Delaying consumer initialization for ${hub}`, { delay });
          await new Promise((resolve) => setTimeout(resolve, delay));
        }

        const connection = await AzureEventHubConfig.getConnection(topic);

        if (connection.consumer) {
          await connection.consumer.run({
            eachMessage: async (payload: EachMessagePayload) => {
              await this.processMessage(payload, handler);
            },
          });

          logger.info("Consumer running for hub", { hub, topic });
        }
      } catch (error) {
        logger.error("Failed to initialize consumer", { hub, error });
        // Don't continue immediately, add a delay before next attempt
        await new Promise((resolve) => setTimeout(resolve, 3000));
        continue;
      }
    }
  }

  /**
   * Process incoming messages with error handling and retry logic
   */
  private async processMessage(
    payload: EachMessagePayload,
    handler: (event: AuditLog) => Promise<void>,
  ): Promise<void> {
    const { message, topic, partition } = payload;
    let eventData: AuditLog;

    try {
      try {
        eventData = JSON.parse(message.value?.toString() || "{}");
      } catch (parseError) {
        logger.error("Failed to parse message JSON", {
          topic,
          partition,
          parseError,
          rawMessage: message.value?.toString()?.substring(0, 200),
        });
        this.processingStats.totalErrors++;
        return;
      }

      if (!AuditLogSchema.parse(eventData)) {
        logger.error("Invalid event received", { eventData });

        await this.sendToDeadLetterQueue(
          eventData,
          new Error(`Validation errors for event ID ${eventData.id}`),
          topic,
        );
        this.processingStats.totalErrors++;
        return;
      }

      await this.trackEventProcessing(eventData, "PROCESSING", topic);

      const handlerPromise = handler(eventData);
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Handler timeout")), 30000),
      );

      await Promise.race([handlerPromise, timeoutPromise]);

      await this.trackEventProcessing(eventData, "COMPLETED", topic);

      this.processingStats.totalProcessed++;
      this.processingStats.lastProcessedAt = new Date();

      logger.debug("Event processed successfully", {
        id: eventData.id,
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
        id: eventData!.id,
      });

      await this.handleFailedEvent(eventData!, error as Error, topic);
    }
  }

  /**
   * Track event processing status in database
   */
  private async trackEventProcessing(
    eventData: AuditLog,
    status: string,
    source: string,
    error?: Error,
  ): Promise<void> {
    try {
      const prisma = DatabaseConfig.getInstance();

      await prisma.eventProcessingStatus.upsert({
        where: { eventId: eventData.id },
        update: {
          status,
          processedAt: status === "COMPLETED" ? new Date() : null,
          errorMessage: error?.message ?? null,
          lastError: error ? new Date() : null,
          retryCount: error ? { increment: 1 } : 0,
          updatedAt: new Date(),
        },
        create: {
          id: randomUUID(),
          eventId: eventData.id,
          eventType:
            eventData.eventType || AUDIT_CONSTANTS.EVENT_TYPES.SYSTEM_ERROR,
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
        id: eventData.id,
        error: dbError,
      });
    }
  }

  /**
   * Handle failed events with retry logic and dead letter queue
   */
  private async handleFailedEvent(
    event: AuditLog,
    error: Error,
    topic: string,
  ): Promise<void> {
    try {
      const prisma = DatabaseConfig.getInstance();

      const processingStatus = await prisma.eventProcessingStatus.findUnique({
        where: { eventId: event.id },
      });

      const retryCount = (processingStatus?.retryCount || 0) + 1;
      const maxRetries = processingStatus?.maxRetries || 3;

      if (retryCount >= maxRetries) {
        await this.sendToDeadLetterQueue(event, error, topic);

        await prisma.eventProcessingStatus.update({
          where: { eventId: event.id },
          data: {
            status: "FAILED",
            sentToDLQ: true,
            dlqReason: `Max retries exceeded: ${error.message}`,
            updatedAt: new Date(),
          },
        });

        logger.error("Event sent to dead letter queue", {
          id: event.id,
          retryCount,
          error: error.message,
        });
      } else {
        await this.scheduleRetry(event, retryCount);

        logger.warn("Event scheduled for retry", {
          id: event.id,
          retryCount,
          maxRetries,
        });
      }
    } catch (handlingError) {
      logger.error("Failed to handle failed event", {
        id: event.id,
        originalError: error.message,
        handlingError,
      });
    }
  }

  /**
   * Send failed events to dead letter queue
   */
  private async sendToDeadLetterQueue(
    event: AuditLog,
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
            key: event.id,
            value: JSON.stringify(dlqMessage),
            timestamp: Date.now().toString(),
          },
        ],
      });

      logger.info("Event sent to dead letter queue", {
        id: event.id,
      });
    } catch (dlqError) {
      logger.error("Failed to send event to dead letter queue", {
        id: event.id,
        error: dlqError,
      });
    }
  }

  private async scheduleRetry(
    event: AuditLog,
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
          default:
            await this.handleSystemEvents(event);
        }
      } catch (retryError) {
        logger.error("Event retry failed", {
          id: event.id,
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
    event: AuditLog,
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
            key: event.id,
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
        id: event.id,
        eventHubName,
        topic,
      });

      return {
        success: true,
        id: event.id,
        processedAt: new Date(),
      };
    } catch (error) {
      logger.error("Failed to publish event", {
        id: event.id,
        eventHubName,
        error,
      });

      return {
        success: false,
        id: event.id,
        processedAt: new Date(),
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  private async handleSecurityEvents(event: AuditLog): Promise<void> {
    try {
      let mappedEventType =
        event.eventType || AUDIT_CONSTANTS.EVENT_TYPES.SYSTEM_ERROR;

      if (
        !Object.values(AUDIT_CONSTANTS.EVENT_TYPES).includes(
          event.eventType as any,
        )
      ) {
        mappedEventType =
          (event.statusCode ?? 0) >= 400
            ? AUDIT_CONSTANTS.EVENT_TYPES.SECURITY_VIOLATION
            : AUDIT_CONSTANTS.EVENT_TYPES.SYSTEM_ERROR;
      }

      await this.auditRepository.createAuditLog({
        ...event,
        eventType: mappedEventType,
        action: event.action || mapEventTypeToAction(mappedEventType),
        source: event.source || "ms-security",
        statusCode: event.statusCode,
        metadata: {
          ...event.data,
          ...event.metadata,
          originalEventType: event.eventType || null,
        },
      });

      securityLogger.info("Security event processed", {
        id: event.id,
        eventType: event.eventType,
        userId: event.userId,
      });
    } catch (error) {
      logger.error("Failed to handle security event", { event, error });
      throw error;
    }
  }

  private async handlePatientEvents(event: AuditLog): Promise<void> {
    try {
      await this.auditRepository.createAuditLog({
        ...event,
        action:
          event.action ||
          mapEventTypeToAction(
            event.eventType || AUDIT_CONSTANTS.EVENT_TYPES.SYSTEM_ERROR,
          ),
        source: event.source || "ms-patientEHR",
        statusCode: event.statusCode,
        description: event.description || `Patient event: ${event.eventType}`,
      });

      auditLogger.info("Patient event processed", {
        id: event.id,
        eventType: event.eventType,
        patientId: event.targetUserId,
        hipaaCompliant: true,
      });
    } catch (error) {
      logger.error("Failed to handle patient event", { event, error });
      throw error;
    }
  }

  private async handleClinicalEvents(event: AuditLog): Promise<void> {
    try {
      await this.auditRepository.createAuditLog({
        ...event,
        action:
          event.action ||
          mapEventTypeToAction(
            event.eventType || AUDIT_CONSTANTS.EVENT_TYPES.SYSTEM_ERROR,
          ),
        resourceType:
          event.resourceType ||
          mapEventTypeToResourceType(
            event.eventType || AUDIT_CONSTANTS.EVENT_TYPES.SYSTEM_ERROR,
          ),
        source: event.source || "ms-clinical",
        statusCode: event.statusCode,
        description: event.description || `Clinical event: ${event.eventType}`,
      });

      logger.info("Clinical event processed", {
        id: event.id,
        eventType: event.eventType,
        patientId: event.targetUserId,
      });
    } catch (error) {
      logger.error("Failed to handle clinical event", { event, error });
      throw error;
    }
  }

  private async handleSystemEvents(event: AuditLog): Promise<void> {
    try {
      await this.auditRepository.createAuditLog({
        ...event,
        userId: event.userId || "SYSTEM",
        userRole: (event.userRole || "SISTEMA") as any,
        action:
          event.action ||
          mapEventTypeToAction(
            event.eventType || AUDIT_CONSTANTS.EVENT_TYPES.SYSTEM_ERROR,
          ),
        source: event.source || "ms-system",
        statusCode: event.statusCode,
        description: event.description || `System event: ${event.eventType}`,
        sessionId: event.sessionId,
      });

      logger.info("System event processed", {
        id: event.id,
        eventType: event.eventType,
      });
    } catch (error) {
      logger.error("Failed to handle system event", { event, error });
      throw error;
    }
  }

  getProcessingStats() {
    return {
      ...this.processingStats,
      isInitialized: this.isInitialized,
      activeProducers: this.producers.size,
      activeConsumers: this.consumers.size,
    };
  }

  async shutdown(): Promise<void> {
    try {
      logger.info("Shutting down EventBus...");

      if (this.connectionMonitoringInterval) {
        clearInterval(this.connectionMonitoringInterval);
      }

      AzureEventHubConfig.beginShutdown();

      for (const [hubName, consumer] of this.consumers) {
        try {
          await consumer.disconnect();
          logger.info("Consumer disconnected", { hubName });
        } catch (e) {
          logger.warn("Consumer disconnect warning", { hubName, error: e });
        }
      }

      for (const [hubName, producer] of this.producers) {
        try {
          await producer.disconnect();
          logger.info("Producer disconnected", { hubName });
        } catch (e) {
          logger.warn("Producer disconnect warning", { hubName, error: e });
        }
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
