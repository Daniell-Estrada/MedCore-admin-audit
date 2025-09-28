import { PrismaClient } from "@prisma/client";
import { logger } from "@/utils/logger";

export class DatabaseConfig {
  private static instance: PrismaClient;

  public static getInstance(): PrismaClient {
    if (!DatabaseConfig.instance) {
      DatabaseConfig.instance = new PrismaClient({
        errorFormat: "pretty",
      });

      if (process.env.NODE_ENV === "development") {
        DatabaseConfig.instance.$on("query", (e: any) => {
          console.log("Query: " + e.query);
          console.log("Params: " + e.params);
          console.log("Duration: " + e.duration + "ms");
        });
      }

      DatabaseConfig.instance.$on("error", (e) => {
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
