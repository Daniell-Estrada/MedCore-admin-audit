import "module-alias/register";
import cors from "cors";
import express from "express";
import compression from "compression";
import dotenv from "dotenv";
import helmet from "helmet";
import { PrismaClient } from "@prisma/client";
import { logger } from "@/utils/logger";
import routes from "@/router/routes";
import { requestLogger } from "@/middleware/requestLogger";
import { eventBus } from "@/services/EventBus";
import rateLimit from "express-rate-limit";
import { errorHandler } from "@/middleware/errorHandler";
import { MS_ADMIN_AUDIT_CONFIG } from "./config/environments";

// Load environment variables
dotenv.config();

const app = express();

const PORT = MS_ADMIN_AUDIT_CONFIG.PORT;

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
    origin: MS_ADMIN_AUDIT_CONFIG.ALLOWED_ORIGINS,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000,
    message: "Too many requests from this IP, please try again later.",
  }),
);

app.use(compression());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

app.use(requestLogger);

// Simple status routes for serverless entry points and assets
app.get(["/", "/api"], (_req, res) => {
  res.status(200).json({
    status: "ok",
    service: "ms-admin-audit",
    message: "Service is up. See /api/v1/health for detailed health.",
    health: "/api/v1/health",
    timestamp: new Date().toISOString(),
  });
});

app.get("/favicon.ico", (_req, res) => {
  // Avoid noise and 404s on serverless for favicon requests
  res.status(204).end();
});

app.use("/api/v1", routes);

app.use(errorHandler);

async function startServer() {
  try {
    await eventBus.initialize();

    if (!MS_ADMIN_AUDIT_CONFIG.VERCEL) {
      app.listen(PORT, () => {
        logger.info(`ms-admin-audit service running on port ${PORT}`, {
          port: PORT,
          environment: MS_ADMIN_AUDIT_CONFIG.NODE_ENV,
        });
      });
    }
  } catch (error) {
    logger.error("Failed to start server", { error });
    if (!MS_ADMIN_AUDIT_CONFIG.VERCEL) {
      process.exit(1);
    }
  }
}

process.on("SIGINT", async () => {
  logger.info("SIGINT received, shutting down gracefully");
  await eventBus.shutdown();
  await prisma.$disconnect();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  logger.info("SIGTERM received, shutting down gracefully");
  await eventBus.shutdown();
  await prisma.$disconnect();
  process.exit(0);
});

if (!MS_ADMIN_AUDIT_CONFIG.VERCEL) {
  startServer();
}

export default app;
