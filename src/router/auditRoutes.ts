import { Router } from "express";
import type { AuditController } from "@/controllers/AuditController";

export function auditRoutes(auditController: AuditController): Router {
  const router = Router();

  router.get("/logs", auditController.getAuditLogs.bind(auditController));

  return router;
}
