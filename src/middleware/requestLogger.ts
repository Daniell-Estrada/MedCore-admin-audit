import type { Request, Response, NextFunction } from "express";
import { logger } from "@/utils/logger";
import { v4 as uuidv4 } from "uuid";

export interface RequestWithId extends Request {
  requestId?: string;
}

/**
 * Middleware to log incoming requests and their outcomes.
 * Assigns a unique request ID to each request for traceability.
 * Logs request start and completion details including method, URL, status code, duration, and user info.
 */
export const requestLogger = (
  req: RequestWithId,
  res: Response,
  next: NextFunction,
): void => {
  req.requestId = uuidv4();
  res.setHeader("X-Request-Id", req.requestId);
  const startTime = Date.now();

  logger.info("Request started", {
    requestId: req.requestId,
    method: req.method,
    url: req.url,
    userAgent: req.headers["user-agent"],
    ip: req.ip,
    userId: req.headers["x-user-id"],
    sessionId: req.headers["x-session-id"],
    contentLength: req.headers["content-length"],
  });

  const originalEnd = res.end;
  res.end = function (chunk?: any, encoding?: any) {
    const duration = Date.now() - startTime;

    logger.info("Request completed", {
      requestId: req.requestId,
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      userId: req.headers["x-user-id"],
      sessionId: req.headers["x-session-id"],
      contentLength: res.getHeader("content-length"),
    });

    return originalEnd.apply(this, [chunk, encoding]);
  };
  next();
};
