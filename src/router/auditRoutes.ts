import { Router } from "express";
import type { AuditController } from "@/controllers/AuditController";
import {
  validateEventPayload,
  validateEventSource,
} from "@/middleware/eventValidator";

export function auditRoutes(auditController: AuditController): Router {
  console.log("Setting up audit routes");
  const router = Router();

  router.post(
    "/events",
    validateEventSource,
    validateEventPayload,
    auditController.receiveEvent.bind(auditController),
  );

  router.get("/logs", auditController.getAuditLogs.bind(auditController));

  return router;
}
