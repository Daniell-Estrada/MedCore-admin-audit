import type { Request, Response, NextFunction } from "express";
import { logger } from "@/utils/logger";

/**
 * Interface representing the expected structure of the event payload
 */
interface EventPayload {
  eventType: string;
  eventData: {
    userId?: string;
    timestamp?: string;
    ipAddrress?: string;
    userAgent?: string;
    [key: string]: any;
  };
}
/**
 * Middleware to validate the event payload
 * Ensures required fields are present and correctly formatted
 * Adds missing fields like timestamp, ipAddress, and userAgent if not provided
 * Removes sensitive information from eventData
 */
export const validateEventPayload = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  try {
    const { eventType, eventData } = req.body as EventPayload;

    if (!eventType) {
      res.status(400).json({ error: "eventType is required" });
    }

    if (!eventData) {
      res.status(400).json({ error: "eventData is required" });
    }

    if (!eventData.timestamp) {
      eventData.timestamp = new Date().toISOString();
    }

    if (!eventData.ipAddrress) {
      eventData.ipAddrress = req.ip || req.socket.remoteAddress || "Unknown";
    }

    if (!eventData.userAgent) {
      eventData.userAgent = req.get("User-Agent") || "Unknown";
    }

    const validEventtypePattern = /^[a-z_]+\.[a-z_]+$/;
    if (!validEventtypePattern.test(eventType)) {
      res.status(400).json({ error: "Invalid eventType format" });
    }

    if (eventData.password || eventData.token) {
      delete eventData.password;
      delete eventData.token;
    }

    next();
  } catch (error) {
    logger.error("Event validation failed", { error, body: req.body });
    res.status(400).json({ error: "Invalid event payload" });
  }
};

/**
 * Middleware to validate the X-Event-Source header
 * Ensures the event source is one of the allowed values
 */
export const validateEventSource = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const allowedSources = [
    "ms-security",
    "ms-patientEHR",
    "ms-clinical",
    "ms-inventory-billing",
    "ms-communication",
    "frontend",
  ];

  const eventSource = req.get("X-Event-Source");

  if (!eventSource || !allowedSources.includes(eventSource)) {
    res.status(400).json({ error: "Invalid event source" });
  }

  next();
};
