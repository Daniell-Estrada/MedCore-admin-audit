import { PrismaClient } from "@prisma/client";
import { logger } from "@/utils/logger";
import { MS_ADMIN_AUDIT_CONFIG } from "./environments";

/**
 * DatabaseConfig is a singleton class that manages the PrismaClient instance.
 * It provides methods to get the instance and disconnect from the database.
 */
export class DatabaseConfig {
  private static instance: PrismaClient;

  public static getInstance(): PrismaClient {
    if (!DatabaseConfig.instance) {
      DatabaseConfig.instance = new PrismaClient({
        log: [
          { level: "query", emit: "event" },
          { level: "error", emit: "event" },
          { level: "info", emit: "event" },
          { level: "warn", emit: "event" },
        ],
        errorFormat: "pretty",
      });

      if (MS_ADMIN_AUDIT_CONFIG.NODE_ENV === "development") {
        DatabaseConfig.instance.$on("query" as never, (e: any) => {
          logger.debug("Database query executed", {
            query: e.query,
            params: e.params,
            duration: `${e.duration}ms`
          });
        });
      }

      DatabaseConfig.instance.$on("error" as never, (e) => {
        logger.error("Database error: ", e);
      });
    }

    return DatabaseConfig.instance;
  }

  public static async disconnect(): Promise<void> {
    if (DatabaseConfig.instance) {
      await DatabaseConfig.instance.$disconnect();
    }
  }
}
