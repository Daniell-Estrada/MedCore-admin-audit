import express from "express";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3013;

export const prisma = new PrismaClient({
  log: ["query", "info", "warn", "error"],
});

app.listen(PORT, async () => {
  await prisma.$connect();
  console.log(`Server is running on http://localhost:${PORT}`);
});
