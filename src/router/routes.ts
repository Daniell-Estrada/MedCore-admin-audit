import { Router } from "express";
import { AuditController } from "@/controllers/AuditController";
import { auditRoutes } from "@/router/auditRoutes";
import { AuditService } from "@/services/AuditService";
import { authMiddleware } from "@/middleware/authMiddleware";
import { requireRole } from "@/middleware/rbac";

const auditService = new AuditService();

const auditController = new AuditController(auditService);

const router = Router();

router.use(
  "/audit",
  authMiddleware,
  requireRole(["admin", "auditor"]),
  auditRoutes(auditController),
);

router.get("/health", (_, res) => {
  res.status(200).json({
    status: "healthy",
    service: "ms-admin-audit",
    timestamp: new Date().toISOString(),
    version: "1.0.0",
  });
});

// 404 handler
router.use("/", (req, res) => {
  res.status(404).json({
    error: "Endpoint not found",
    path: req.originalUrl,
    method: req.method,
  });
});

export default router;
