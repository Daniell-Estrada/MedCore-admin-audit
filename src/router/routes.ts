import { Router } from "express";
import { AuditController } from "@/controllers/AuditController";
import { auditRoutes } from "@/router/auditRoutes";
import { AuditRepository } from "@/repositories/AuditRepository";
import { authMiddleware } from "@/middleware/authMiddleware";
import { requireRole } from "@/middleware/rbac";

const auditRepository = new AuditRepository();

const auditController = new AuditController(auditRepository);

const router = Router();

router.use(
  "/audit",
  authMiddleware,
  requireRole(["administrador", "auditor"]),
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
