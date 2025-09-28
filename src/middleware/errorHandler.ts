import type { Request, Response, NextFunction } from "express";
import { logger } from "@/utils/logger";
import { AuditService } from "@/services/AuditService";
import { AUDIT_CONSTANTS } from "@/config/constants";

export interface CustomError extends Error {
  statusCode?: number;
  code?: string;
  details?: any;
}

/**
 * Centralized error handling middleware for Express.js applications.
 * Logs error details and creates an audit log entry for each error.
 * Sends a structured JSON response to the client with error information.
 */
export const errorHandler = async (
  error: CustomError,
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  logger.error("Request error", {
    error: error.message,
    stack: error.stack,
    url: req.url,
    method: req.method,
    userId: req.headers["x-user-id"],
    sessionId: req.headers["x-session-id"],
    userAgent: req.headers["user-agent"],
    ip: req.ip,
  });

  try {
    const auditService = new AuditService();
    const metadata: Record<string, any> = {};
    if (error.statusCode) metadata["statusCode"] = error.statusCode;
    if (error.code) metadata["errorCode"] = error.code;
    if (error.details) metadata["details"] = error.details;
    if (req.url) metadata["url"] = req.url;
    if (req.method) metadata["method"] = req.method;

    await auditService.createAuditLog({
      eventType: AUDIT_CONSTANTS.EVENT_TYPES.SYSTEM_ERROR,
      severityLevel:
        error.statusCode && error.statusCode < 500
          ? AUDIT_CONSTANTS.SEVERITY_LEVELS.MEDIUM
          : AUDIT_CONSTANTS.SEVERITY_LEVELS.HIGH,
      userId: req.headers["x-user-id"] as string,
      userRole: req.headers["x-user-role"] as string,
      action: AUDIT_CONSTANTS.ACTION_TYPES.ERROR,
      description: `API Error: ${error.message}`,
      resourceType: AUDIT_CONSTANTS.RESOURCE_TYPES.SYSTEM_CONFIG,
      resourceId: `${req.method} ${req.path}`,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
      sessionId: req.headers["x-session-id"] as string,
      metadata,
      success: false,
      errorMessage: error.message,
    });
  } catch (auditError) {
    logger.error("Failed to create audit log for error", {
      originalError: error.message,
      auditError:
        auditError instanceof Error
          ? auditError.message
          : "Unknown audit error",
    });
  }

  const statusCode = error.statusCode || 500;
  const errorResponse: any = {
    error: true,
    message: error.message || "Internal server error",
    timestamp: new Date().toISOString(),
    path: req.path,
    method: req.method,
  };

  if (error.code) {
    errorResponse.code = error.code;
  }

  if (process.env.NODE_ENV === "development") {
    errorResponse.stack = error.stack;
    errorResponse.details = error.details;
  }

  res.status(statusCode).json(errorResponse);
  next();
};

export class ValidationError extends Error {
  statusCode = 400;
  code = "VALIDATION_ERROR";

  constructor(
    message: string,
    public details?: any,
  ) {
    super(message);
    this.name = "ValidationError";
  }
}

export class AuthenticationError extends Error {
  statusCode = 401;
  code = "AUTHENTICATION_ERROR";

  constructor(message = "Authentication required") {
    super(message);
    this.name = "AuthenticationError";
  }
}

export class AuthorizationError extends Error {
  statusCode = 403;
  code = "AUTHORIZATION_ERROR";

  constructor(message = "Insufficient permissions") {
    super(message);
    this.name = "AuthorizationError";
  }
}

export class NotFoundError extends Error {
  statusCode = 404;
  code = "NOT_FOUND_ERROR";

  constructor(message = "Resource not found") {
    super(message);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends Error {
  statusCode = 409;
  code = "CONFLICT_ERROR";

  constructor(message = "Resource conflict") {
    super(message);
    this.name = "ConflictError";
  }
}

export class RateLimitError extends Error {
  statusCode = 429;
  code = "RATE_LIMIT_ERROR";

  constructor(message = "Rate limit exceeded") {
    super(message);
    this.name = "RateLimitError";
  }
}

export class InternalServerError extends Error {
  statusCode = 500;
  code = "INTERNAL_SERVER_ERROR";

  constructor(message = "Internal server error") {
    super(message);
    this.name = "InternalServerError";
  }
}
