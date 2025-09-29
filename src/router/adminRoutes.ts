import { Router } from "express";
import type { AdminController } from "@/controllers/AdminController";

export function adminRoutes(_: AdminController): Router {
  const router = Router();

  // router.get("/policies", adminController.getPolicies.bind(adminController));

  return router;
}
