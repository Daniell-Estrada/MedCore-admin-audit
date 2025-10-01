import {
  Kafka,
  type Producer,
  type Consumer,
  type KafkaConfig,
  Partitioners,
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
        connectionTimeout: 30000,
        requestTimeout: 60000,
        retry: {
          initialRetryTime: 300,
          retries: 8,
          maxRetryTime: 30000,
          factor: 2,
          multiplier: 1.5,
          restartOnFailure: async (e) => {
            logger.error("Kafka connection failed, restarting", { error: e });
            return true;
          },
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
      createPartitioner: Partitioners.LegacyPartitioner,
      retry: {
        initialRetryTime: 100,
        retries: 5,
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
    const groupId = consumerGroup || AZURE_EVENT_HUB_CONFIG.CONSUMER_GROUP;

    const consumer = kafka.consumer({
      groupId: groupId,
      sessionTimeout: 45000,
      heartbeatInterval: 15000,
      maxWaitTimeInMs: 5000,
      retry: {
        initialRetryTime: 300,
        retries: 5,
        maxRetryTime: 30000,
      },
      allowAutoTopicCreation: false,
      readUncommitted: false,
    });

    await consumer.connect();
    await consumer.subscribe({
      topic: eventHubName,
      fromBeginning: false,
    });

    logger.info("Consumer connected to Event Hub", {
      eventHubName,
      consumerGroup: groupId,
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
        consumer = await this.createConsumer(eventHubName);
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
