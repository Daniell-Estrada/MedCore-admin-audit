import { Router } from "express";
import { AuditController } from "@/controllers/AuditController";
import { auditRoutes } from "@/router/auditRoutes";
import { AuditService } from "@/services/AuditService";
import { EventBus } from "@/services/EventBus";

const auditService = new AuditService();
const eventBus = new EventBus();

const auditController = new AuditController(auditService, eventBus);

const router = Router();

router.use("/audit", auditRoutes(auditController));

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
