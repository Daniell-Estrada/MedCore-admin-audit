import { Request, Response, NextFunction } from "express";

interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    username: string;
    role: string;
    department?: string;
  };
}

/**
 * Middleware to enforce role-based access control.
 */
export const requireRole = (allowedRoles: string[]) => {
  return (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
  ): void => {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    if (!allowedRoles.includes(req.user.role.toLowerCase())) {
      res.status(403).json({ error: "Insufficient permissions" });
      return;
    }

    next();
  };
};
