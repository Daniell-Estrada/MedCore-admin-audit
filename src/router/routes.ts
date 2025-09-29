import { Router } from "express";
import { AuditController } from "@/controllers/AuditController";
import { auditRoutes } from "@/router/auditRoutes";
import { AuditService } from "@/services/AuditService";
import { EventBus } from "@/services/EventBus";
import { authMiddleware } from "@/middleware/auth";
import { requireRole } from "@/middleware/rbac";

const auditService = new AuditService();
// const policyService = new PolicyService();
// const sessionService = new SessionService();
// const backupService = new BackupService();
// const alertService = new AlertService();
const eventBus = new EventBus();

const auditController = new AuditController(auditService, eventBus);
// const adminController = new AdminController(
//   policyService,
//   sessionService,
//   backupSerice,
//   alertService,
// );

const router = Router();

router.use(
  "/audit",
  authMiddleware,
  requireRole(["admin", "auditor"]),
  auditRoutes(auditController),
);

// router.use(
//   "/admin",
//   authMiddleware,
//   requireRole(["admin"]),
//   adminRoutes(adminController),
// );
//

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
