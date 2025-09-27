import { Router } from "express";

const router = Router();

// 404 handler
router.use("*", (req, res) => {
  res.status(404).json({
    error: "Endpoint not found",
    path: req.originalUrl,
    method: req.method,
  });
});

export default router;

