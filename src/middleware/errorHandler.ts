import type { Request, Response, NextFunction } from "express";
import { logger } from "@/utils/logger";
import { AuditRepository } from "@/repositories/AuditRepository";
import { eventBus } from "@/services/EventBus";
import { AUDIT_CONSTANTS } from "@/constants/auditConstants";
import { MS_ADMIN_AUDIT_CONFIG } from "@/config/environments";

export interface CustomError extends Error {
  statusCode?: number;
  code?: string;
  details?: any;
  isOperational?: boolean;
}

/**
 * errorHandler is an Express middleware that handles errors occurring in the application.
 * It logs the error, creates an audit log, publishes an error event, and sends a sanitized response to the client.
 */
export const errorHandler = async (
  error: CustomError,
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  if (res.headersSent) {
    return next(error);
  }

  const errorId = generateErrorId();
  const statusCode = error.statusCode || 500;
  const isOperational = error.isOperational ?? statusCode < 500;

  // Log estructurado del error
  logger.error("Request error", {
    errorId,
    error: error.message,
    stack: error.stack,
    url: req.url,
    method: req.method,
    userId: req.headers["x-user-id"],
    sessionId: req.headers["x-session-id"],
    userAgent: req.headers["user-agent"],
    ip: req.ip,
    statusCode,
    isOperational,
  });

  // Crear audit log y evento en paralelo
  await Promise.allSettled([
    createAuditLog(error, req, errorId, statusCode),
    publishErrorEvent(error, req, errorId, statusCode, isOperational),
  ]);

  // Respuesta al cliente
  const errorResponse = buildErrorResponse(error, req, errorId, statusCode);
  res.status(statusCode).json(errorResponse);
};

async function createAuditLog(
  error: CustomError,
  req: Request,
  errorId: string,
  statusCode: number,
): Promise<void> {
  try {
    const auditRepository = new AuditRepository();
    const metadata: Record<string, any> = {
      errorId,
      statusCode,
      url: req.url,
      method: req.method,
    };

    if (error.code) metadata["errorCode"] = error.code;
    if (error.details) metadata["details"] = error.details;

    await auditRepository.createAuditLog({
      eventType: AUDIT_CONSTANTS.EVENT_TYPES.SYSTEM_ERROR,
      severityLevel:
        statusCode < 500
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
}

async function publishErrorEvent(
  error: CustomError,
  req: Request,
  errorId: string,
  statusCode: number,
  isOperational: boolean,
): Promise<void> {
  try {
    // Publicar evento para sistema de alertas y monitoreo
    await eventBus.publishEvent("SYSTEM", {
      eventId: errorId,
      eventType: "SYSTEM_ERROR",
      source: "ms-admin-audit",
      timestamp: new Date(),
      userId: req.headers["x-user-id"] as string,
      sessionId: req.headers["x-session-id"] as string,
      severityLevel: statusCode < 500 ? "MEDIUM" : "HIGH",
      data: {
        error: error.message,
        statusCode,
        method: req.method,
        url: req.url,
        userAgent: req.headers["user-agent"],
        ip: req.ip,
        isOperational,
        stack:
          MS_ADMIN_AUDIT_CONFIG.NODE_ENV === "development"
            ? error.stack
            : undefined,
      },
      metadata: {
        errorCode: error.code,
        details: error.details,
      },
    });

    logger.debug("Error event published", { errorId, statusCode });
  } catch (eventError) {
    logger.error("Failed to publish error event", {
      originalError: error.message,
      eventError:
        eventError instanceof Error
          ? eventError.message
          : "Unknown event error",
    });
  }
}

function buildErrorResponse(
  error: CustomError,
  req: Request,
  errorId: string,
  statusCode: number,
): any {
  const errorResponse: any = {
    error: true,
    message: getClientMessage(error, statusCode),
    errorId,
    timestamp: new Date().toISOString(),
    path: req.path,
    method: req.method,
  };

  if (error.code) {
    errorResponse.code = error.code;
  }

  // Solo incluir detalles sensibles en desarrollo
  if (MS_ADMIN_AUDIT_CONFIG.NODE_ENV === "development") {
    errorResponse.stack = error.stack;
    errorResponse.details = error.details;
    errorResponse.originalMessage = error.message;
  }

  return errorResponse;
}

function getClientMessage(error: CustomError, statusCode: number): string {
  // Sanitizar mensajes para producción
  if (MS_ADMIN_AUDIT_CONFIG.NODE_ENV === "production") {
    if (statusCode >= 500) {
      return "Internal server error occurred. Please contact support.";
    }
  }

  return error.message || "An unexpected error occurred";
}

function generateErrorId(): string {
  return `ERR_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Error classes existentes...
export class ValidationError extends Error {
  statusCode = 400;
  code = "VALIDATION_ERROR";
  isOperational = true;

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
  isOperational = true;

  constructor(message = "Authentication required") {
    super(message);
    this.name = "AuthenticationError";
  }
}

export class AuthorizationError extends Error {
  statusCode = 403;
  code = "AUTHORIZATION_ERROR";
  isOperational = true;

  constructor(message = "Insufficient permissions") {
    super(message);
    this.name = "AuthorizationError";
  }
}

export class NotFoundError extends Error {
  statusCode = 404;
  code = "NOT_FOUND_ERROR";
  isOperational = true;

  constructor(message = "Resource not found") {
    super(message);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends Error {
  statusCode = 409;
  code = "CONFLICT_ERROR";
  isOperational = true;

  constructor(message = "Resource conflict") {
    super(message);
    this.name = "ConflictError";
  }
}

export class RateLimitError extends Error {
  statusCode = 429;
  code = "RATE_LIMIT_ERROR";
  isOperational = true;

  constructor(message = "Rate limit exceeded") {
    super(message);
    this.name = "RateLimitError";
  }
}

export class InternalServerError extends Error {
  statusCode = 500;
  code = "INTERNAL_SERVER_ERROR";
  isOperational = false;

  constructor(message = "Internal server error") {
    super(message);
    this.name = "InternalServerError";
  }
}
