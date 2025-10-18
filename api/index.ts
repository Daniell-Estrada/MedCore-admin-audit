import type { VercelRequest, VercelResponse } from "@vercel/node";

let app: any;
let isInitialized = false;

async function initializeApp() {
  if (!isInitialized) {
    const moduleAlias = require("module-alias");
    const path = require("path");

    moduleAlias.addAlias("@", path.join(__dirname, "../dist"));

    require("module-alias/register");

    isInitialized = true;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    await initializeApp();

    if (!app) {
      const { default: expressApp } = await import("../dist/index");
      app = expressApp;
    }

    if (!req.url) {
      req.url = "/";
    }

    return app(req, res);
  } catch (error) {
    console.error("Handler error:", error);
    return res.status(500).json({
      error: "Internal server error",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
