import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { logger } from "@/utils/logger";
import { MS_ADMIN_AUDIT_CONFIG } from "@/config/environments";

interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    username: string;
    role: string;
    department?: string;
  };
}

/**
 * Middleware to authenticate requests using JWT tokens.
 * Attaches the decoded user information to the request object.
 */
export const authMiddleware = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): void => {
  try {
    const token = req.header("Authorization")?.replace("Bearer ", "");

    if (!token) {
      res.status(401).json({ error: "No token provided" });
      return;
    }

    const jwtSecret = MS_ADMIN_AUDIT_CONFIG.JWT_SECRET;
    if (!jwtSecret) {
      logger.error("JWT_SECRET not configured");
      res.status(500).json({ error: "Server configuration error" });
      return;
    }

    const decoded = jwt.verify(token, jwtSecret) as any;
    req.user = decoded;
    next();
  } catch (error) {
    logger.error("Authentication failed", { error });
    res.status(401).json({ error: "Invalid token" });
  }
};
