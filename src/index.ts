import express from "express";
import dotenv from "dotenv";
import helmet from "helmet";
import { PrismaClient } from "@prisma/client";
import routes from "./router/routes";

// Load environment variables
dotenv.config();

const app = express();

app.use("/api/v1", routes);

const PORT = process.env.PORT || 3013;

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

app.listen(PORT, async () => {
  await prisma.$connect();
  console.log(`Server is running on http://localhost:${PORT}`);
});
