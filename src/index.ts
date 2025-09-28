import cors from "cors";
import express from "express";
import margan from "morgan";
import compression from "compression";
import dotenv from "dotenv";
import helmet from "helmet";
import { PrismaClient } from "@prisma/client";
import { logger } from "@/utils/logger";
import routes from "@/router/routes";
import { errorHandler } from "@/middleware/errorHandler";
import { requestLogger } from "@/middleware/requestLogger";

// Load environment variables
dotenv.config();

const app = express();

const PORT = process.env.PORT || 3015;

export const prisma = new PrismaClient({
  log: ["query", "info", "warn", "error"],
});

// Middleware for security headers
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https:"],
      },
    },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
  }),
);

app.use(
  cors({
    origin: process.env.ALLOWED_ORIGINS?.split(",") || "*",
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-User-Id",
      "X-Event-Source",
      "X-User-Role",
    ],
  }),
);

app.use(compression());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

app.use(requestLogger);
app.use(errorHandler);

// Logging middleware
app.use(
  margan("combined", {
    stream: { write: (message) => logger.info(message.trim()) },
  }),
);

// API routes
app.use("/api/v1", routes);

process.on("SIGINT", async () => {
  logger.info("SIGINT received, shutting down gracefully");
  await prisma.$disconnect();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  logger.info("SIGTERM received, shutting down gracefully");
  await prisma.$disconnect();
  process.exit(0);
});

try {
  app.listen(PORT, async () => {
    await prisma.$connect();
    console.log(`Server is running on http://localhost:${PORT}`);
  });
} catch (error) {
  logger.error("Failed to start the server", { error });
  process.exit(1);
}
