import {
  Kafka,
  type Producer,
  type Consumer,
  type KafkaConfig,
  Partitioners,
  logLevel as KafkaLogLevel,
  type LogEntry,
} from "kafkajs";
import { logger } from "@/utils/logger";
import { AZURE_EVENT_HUB_CONSTANTS } from "@/constants/azureConstants";
import { AZURE_EVENT_HUB_CONFIG } from "./environments";

export interface EventHubConnection {
  producer?: Producer;
  consumer?: Consumer;
  isConnected: boolean;
}

/**
 * AzureEventHubConfig is a singleton class that manages connections to Azure Event Hubs using KafkaJS.
 * It provides methods to create producers and consumers, manage connections, and perform health checks.
 */
export class AzureEventHubConfig {
  private static kafka: Kafka | null = null;
  private static connections: Map<string, EventHubConnection> = new Map();
  private static shuttingDown = false;
  private static lastEconnresetLogAt = 0;
  private static lastHeartbeatLogAt = 0;
  private static lastSyncGroupLogAt = 0;

  static beginShutdown(): void {
    this.shuttingDown = true;
  }

  static getInstance(): Kafka {
    if (!this.kafka) {
      const connectionString = AZURE_EVENT_HUB_CONFIG.CONNECTION_STRING;
      const eventHubsNamespace = AZURE_EVENT_HUB_CONFIG.NAMESPACE;

      if (!connectionString || !eventHubsNamespace) {
        throw new Error("Azure Event Hub configuration is missing.");
      }

      const brokers = (AZURE_EVENT_HUB_CONFIG.BROKERS || []).filter(Boolean);
      if (brokers.length === 0) {
        throw new Error("AZURE_EVENT_HUB_BROKERS is not configured");
      }
      const servername = brokers[0].split(":")[0];

      const kafkaConfig: KafkaConfig = {
        clientId: AZURE_EVENT_HUB_CONFIG.CLIENT_ID,
        brokers,
        ssl: {
          servername,
          rejectUnauthorized: true,
          minVersion: "TLSv1.2",
        },
        sasl: {
          mechanism: "plain",
          username: "$ConnectionString",
          password: connectionString,
        },
        connectionTimeout: 30000,
        requestTimeout: 30000,
        authenticationTimeout: 15000,
        enforceRequestTimeout: true,
        retry: {
          initialRetryTime: 300,
          retries: 10,
          maxRetryTime: 30000,
          factor: 2,
          multiplier: 2,
          restartOnFailure: async (e) => {
            logger.warn("Kafka connection failed, restarting", {
              error: e.message,
            });
            return true;
          },
        },
        logLevel: KafkaLogLevel.ERROR,
        logCreator: () => (entry: LogEntry) => {
          const msg =
            typeof entry.log?.message === "string" ? entry.log.message : "";
          if (msg.includes("Connection error: read ECONNRESET")) {
            if (AzureEventHubConfig.shuttingDown) return;
            const now = Date.now();
            if (now - AzureEventHubConfig.lastEconnresetLogAt < 300000) return;
            AzureEventHubConfig.lastEconnresetLogAt = now;
          }

          if (msg.includes("Response Heartbeat")) {
            const now = Date.now();
            if (now - AzureEventHubConfig.lastHeartbeatLogAt < 60000) return;
            AzureEventHubConfig.lastHeartbeatLogAt = now;
            entry = { ...entry, level: KafkaLogLevel.WARN } as any;
          }
          if (msg.includes("Response SyncGroup")) {
            const now = Date.now();
            if (now - AzureEventHubConfig.lastSyncGroupLogAt < 60000) return;
            AzureEventHubConfig.lastSyncGroupLogAt = now;
            entry = { ...entry, level: KafkaLogLevel.WARN } as any;
          }

          const payload = {
            namespace: entry.namespace,
            message: msg,
            broker: (entry.log as any)?.broker,
            clientId: (entry.log as any)?.clientId,
            stack: (entry.log as any)?.stack,
          };

          switch (entry.level) {
            case KafkaLogLevel.ERROR:
              logger.error("[kafkajs]", payload);
              break;
            case KafkaLogLevel.WARN:
              logger.warn("[kafkajs]", payload);
              break;
            case KafkaLogLevel.INFO:
              logger.info("[kafkajs]", payload);
              break;
            case KafkaLogLevel.DEBUG:
              logger.debug("[kafkajs]", payload);
              break;
            default:
              break;
          }
        },
      };

      this.kafka = new Kafka(kafkaConfig);

      logger.info("Azure Event Hub Kafka client initialized", {
        namespace: eventHubsNamespace,
        clientId: kafkaConfig.clientId,
      });
    }

    return this.kafka;
  }
  static async createProducer(eventHubName: string): Promise<Producer> {
    const kafka = this.getInstance();

    const producer = kafka.producer({
      maxInFlightRequests: 5,
      idempotent: false,
      transactionTimeout: 30000,
      createPartitioner: Partitioners.DefaultPartitioner,
      retry: {
        initialRetryTime: 300,
        retries: 10,
        maxRetryTime: 30000,
        multiplier: 2,
        restartOnFailure: async (e) => {
          logger.warn("Producer connection failed, restarting", {
            error: e.message,
            eventHubName,
          });
          return true;
        },
      },
      allowAutoTopicCreation: false,
    });

    await producer.connect();
    logger.info("Producer connected to Event Hub", { eventHubName });

    return producer;
  }
  static async createConsumer(
    eventHubName: string,
    consumerGroup: string,
  ): Promise<Consumer> {
    const kafka = this.getInstance();

    const consumer = kafka.consumer({
      groupId: consumerGroup,
      sessionTimeout: AZURE_EVENT_HUB_CONFIG.CONSUMER_SESSION_TIMEOUT_MS,
      heartbeatInterval: AZURE_EVENT_HUB_CONFIG.CONSUMER_HEARTBEAT_INTERVAL_MS,
      maxWaitTimeInMs: AZURE_EVENT_HUB_CONFIG.MAX_WAIT_TIME_MS,
      rebalanceTimeout: AZURE_EVENT_HUB_CONFIG.REBALANCE_TIMEOUT_MS,
      retry: {
        initialRetryTime: 300,
        retries: 10,
        maxRetryTime: 30000,
        multiplier: 2,
        restartOnFailure: async (e) => {
          logger.warn("Consumer connection failed, restarting", {
            error: e.message,
            consumerGroup,
          });
          return true;
        },
      },
      allowAutoTopicCreation: false,
      readUncommitted: false,
      metadataMaxAge: AZURE_EVENT_HUB_CONFIG.METADATA_MAX_AGE_MS,
    });

    await consumer.connect();
    logger.info("Consumer connected to Event Hub", {
      eventHubName,
      consumerGroup,
    });

    await consumer.subscribe({
      topic: eventHubName,
      fromBeginning: false,
    });

    return consumer;
  }

  static async getConnection(
    eventHubName: string,
    options?: {
      mode?: "producer" | "consumer" | "both";
      consumerGroup?: string;
    },
  ): Promise<EventHubConnection> {
    const mode = options?.mode || "both";

    let existing = this.connections.get(eventHubName);
    if (!existing) {
      existing = { isConnected: false };
      this.connections.set(eventHubName, existing);
    }

    if ((mode === "producer" || mode === "both") && !existing.producer) {
      existing.producer = await this.createProducer(eventHubName);
      existing.isConnected = true;
    }

    const shouldCreateConsumer = [
      AZURE_EVENT_HUB_CONSTANTS.SECURITY,
      AZURE_EVENT_HUB_CONSTANTS.PATIENT,
      AZURE_EVENT_HUB_CONSTANTS.CLINICAL,
      AZURE_EVENT_HUB_CONSTANTS.SYSTEM,
    ].includes(eventHubName as any);

    if (
      (mode === "consumer" || mode === "both") &&
      shouldCreateConsumer &&
      !existing.consumer
    ) {
      const consumerGroup =
        options?.consumerGroup || eventHubName.replace("events", "consumer");
      existing.consumer = await this.createConsumer(
        eventHubName,
        consumerGroup,
      );
      existing.isConnected = true;
    }

    logger.info("New Event Hub connection established", { eventHubName });
    return existing;
  }

  static getEventHubs() {
    return {
      AUDIT: AZURE_EVENT_HUB_CONSTANTS.AUDIT,
      SECURITY: AZURE_EVENT_HUB_CONSTANTS.SECURITY,
      PATIENT: AZURE_EVENT_HUB_CONSTANTS.PATIENT,
      CLINICAL: AZURE_EVENT_HUB_CONSTANTS.CLINICAL,
      SYSTEM: AZURE_EVENT_HUB_CONSTANTS.SYSTEM,
      DEAD_LETTER: AZURE_EVENT_HUB_CONSTANTS.DLQ,
    };
  }

  static async disconnectAll(): Promise<void> {
    this.beginShutdown();

    const disconnectPromises: Promise<void>[] = [];

    for (const [eventHubName, connection] of this.connections) {
      if (!connection.isConnected) continue;

      logger.info("Disconnecting from Event Hub", { eventHubName });

      disconnectPromises.push(
        (async () => {
          try {
            if (connection.producer) {
              await connection.producer.disconnect();
            }
          } catch (e: any) {
            const msg = e?.message || String(e);
            if (!this.shuttingDown || !msg.includes("ECONNRESET")) {
              logger.warn("Producer disconnect warning", {
                eventHubName,
                error: e,
              });
            }
          }
        })(),
      );

      if (connection.consumer) {
        disconnectPromises.push(
          (async () => {
            try {
              await connection.consumer!.disconnect();
            } catch (e: any) {
              const msg = e?.message || String(e);
              if (!this.shuttingDown || !msg.includes("ECONNRESET")) {
                logger.warn("Consumer disconnect warning", {
                  eventHubName,
                  error: e,
                });
              }
            }
          })(),
        );
      }

      connection.isConnected = false;
    }

    await Promise.all(disconnectPromises);
    this.connections.clear();

    logger.info("All Event Hub connections disconnected");
  }

  static async healthCheck(): Promise<boolean> {
    try {
      const kafka = this.getInstance();
      const admin = kafka.admin();
      await admin.connect();

      const topics = await admin.listTopics();
      await admin.disconnect();

      logger.debug("Event Hub health check passed", {
        topicsCount: topics.length,
      });
      return true;
    } catch (error) {
      logger.error("Event Hub health check failed", { error });
      return false;
    }
  }
}
