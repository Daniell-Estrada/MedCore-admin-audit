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
  producer: Producer;
  consumer: Consumer;
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

      const kafkaConfig: KafkaConfig = {
        clientId: AZURE_EVENT_HUB_CONFIG.CLIENT_ID,
        brokers: AZURE_EVENT_HUB_CONFIG.BROKERS,
        ssl: true,
        sasl: {
          mechanism: "plain",
          username: "$ConnectionString",
          password: connectionString,
        },
        connectionTimeout: 60000,
        requestTimeout: 120000,
        enforceRequestTimeout: false,
        retry: {
          initialRetryTime: 1000,
          retries: 8,
          maxRetryTime: 60000,
          factor: 2,
          multiplier: 1.5,
          restartOnFailure: async (e) => {
            logger.error("Kafka connection failed, restarting", { error: e });
            return true;
          },
        },
        logLevel: KafkaLogLevel.ERROR,
        logCreator: () => (entry: LogEntry) => {
          if (
            AzureEventHubConfig.shuttingDown &&
            typeof entry.log?.message === "string" &&
            entry.log.message.includes("Connection error: read ECONNRESET")
          ) {
            return;
          }

          const payload = {
            namespace: entry.namespace,
            message: entry.log?.message,
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
      transactionTimeout: 6000,
      createPartitioner: Partitioners.DefaultPartitioner,
      retry: {
        initialRetryTime: 1000,
        retries: 5,
        maxRetryTime: 6000,
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
      sessionTimeout: 15000,
      heartbeatInterval: 3000,
      maxWaitTimeInMs: AZURE_EVENT_HUB_CONFIG.MAX_WAIT_TIME_MS,
      rebalanceTimeout: 18000,
      retry: {
        initialRetryTime: 100,
        retries: 5,
        maxRetryTime: 6000,
      },
      allowAutoTopicCreation: false,
      readUncommitted: false,
      metadataMaxAge: 3000,
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
  ): Promise<EventHubConnection> {
    if (!this.connections.has(eventHubName)) {
      const producer = await this.createProducer(eventHubName);
      const shouldCreateConsumer = [
        AZURE_EVENT_HUB_CONSTANTS.SECURITY,
        AZURE_EVENT_HUB_CONSTANTS.PATIENT,
        AZURE_EVENT_HUB_CONSTANTS.CLINICAL,
        AZURE_EVENT_HUB_CONSTANTS.INVENTORY,
        AZURE_EVENT_HUB_CONSTANTS.SYSTEM,
      ].includes(eventHubName as any);

      let consumer;
      if (shouldCreateConsumer) {
        const topicSuffix = eventHubName
          .replace("medcore-", "")
          .replace("-events", "");
        const uniqueConsumerGroup = `${AZURE_EVENT_HUB_CONFIG.CONSUMER_GROUP}-${topicSuffix}`;
        consumer = await this.createConsumer(eventHubName, uniqueConsumerGroup);
      }

      const connection: EventHubConnection = {
        producer,
        consumer: consumer!,
        isConnected: true,
      };

      this.connections.set(eventHubName, connection);
      logger.info("New Event Hub connection established", { eventHubName });
    }

    return this.connections.get(eventHubName)!;
  }

  static getEventHubs() {
    return {
      AUDIT: AZURE_EVENT_HUB_CONSTANTS.AUDIT,
      SECURITY: AZURE_EVENT_HUB_CONSTANTS.SECURITY,
      PATIENT: AZURE_EVENT_HUB_CONSTANTS.PATIENT,
      CLINICAL: AZURE_EVENT_HUB_CONSTANTS.CLINICAL,
      INVENTORY: AZURE_EVENT_HUB_CONSTANTS.INVENTORY,
      SYSTEM: AZURE_EVENT_HUB_CONSTANTS.SYSTEM,
      COMPLIANCE: AZURE_EVENT_HUB_CONSTANTS.COMPLIANCE,
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
            await connection.producer.disconnect();
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
