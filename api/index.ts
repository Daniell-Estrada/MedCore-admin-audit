import type { VercelRequest, VercelResponse } from "@vercel/node";

let app: any;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!app) {
    const { default: expressApp } = await import("../dist/index");
    app = expressApp;
  }

  if (!req.url) {
    req.url = "/";
  }

  return app(req, res);
}
