import { Kafka, type Producer, type Consumer, type KafkaConfig } from "kafkajs";
import { logger } from "@/utils/logger";
import {
  AZURE_EVENT_HUB_CONFIG,
  AZURE_EVENT_HUB_CONSTANTS,
} from "@/config/constants";

export interface EventHubConnection {
  producer: Producer;
  consumer: Consumer;
  isConnected: boolean;
}

export class AzureEventHubConfig {
  private static kafka: Kafka | null = null;
  private static connections: Map<string, EventHubConnection> = new Map();

  static getInstance(): Kafka {
    if (!this.kafka) {
      const connectionString = AZURE_EVENT_HUB_CONFIG.CONNECTION_STRING;
      const eventHubsNamespace = AZURE_EVENT_HUB_CONFIG.NAMESPACE;

      if (!connectionString || !eventHubsNamespace) {
        throw new Error("Azure Event Hub configuration is missing.");
      }

      const kafkaConfig: KafkaConfig = {
        clientId: AZURE_EVENT_HUB_CONFIG.CLIENT_ID || "ms-admin-audit",
        brokers: [`${eventHubsNamespace}.servicebus.windows.net:9093`],
        ssl: true,
        sasl: {
          mechanism: "plain",
          username: "$ConnectionString",
          password: connectionString,
        },
        connectionTimeout: 30000,
        requestTimeout: 60000,
        retry: {
          initialRetryTime: 300,
          retries: 10,
          maxRetryTime: 30000,
          factor: 2,
          multiplier: 1.5,
          restartOnFailure: async (e) => {
            logger.error("Kafka connection failed, restarting", { error: e });
            return true;
          },
        },
        logLevel: process.env.NODE_ENV === "production" ? 1 : 2,
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
      idempotent: true,
      transactionTimeout: 30000,
      retry: {
        initialRetryTime: 100,
        retries: 8,
        maxRetryTime: 30000,
      },
    });

    await producer.connect();

    logger.info("Producer connected to Event Hub", { eventHubName });
    return producer;
  }

  static async createConsumer(
    eventHubName: string,
    consumerGroup?: string,
  ): Promise<Consumer> {
    const kafka = this.getInstance();
    const consumer = kafka.consumer({
      groupId: consumerGroup || AZURE_EVENT_HUB_CONFIG.CONSUMER_GROUP,
      sessionTimeout: 60000,
      heartbeatInterval: 5000,
      maxWaitTimeInMs: AZURE_EVENT_HUB_CONFIG.MAX_WAIT_TIME_MS,
      retry: {
        initialRetryTime: 100,
        retries: 8,
        maxRetryTime: 30000,
      },
    });

    await consumer.connect();
    await consumer.subscribe({ topic: eventHubName, fromBeginning: false });

    logger.info("Consumer connected to Event Hub", {
      eventHubName,
      consumerGroup: consumerGroup || AZURE_EVENT_HUB_CONFIG.CONSUMER_GROUP,
    });

    return consumer;
  }

  static async getConnection(
    eventHubName: string,
  ): Promise<EventHubConnection> {
    if (!this.connections.has(eventHubName)) {
      const producer = await this.createProducer(eventHubName);
      const consumer = await this.createConsumer(eventHubName);

      const connection: EventHubConnection = {
        producer,
        consumer,
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
    const disconnectPromises: Promise<void>[] = [];

    for (const [eventHubName, connection] of this.connections) {
      if (connection.isConnected) {
        disconnectPromises.push(
          connection.producer.disconnect(),
          connection.consumer.disconnect(),
        );
        connection.isConnected = false;

        logger.info("Disconnecting from Event Hub", { eventHubName });
      }
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
