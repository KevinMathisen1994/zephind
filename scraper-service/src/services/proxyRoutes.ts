import { Router, Request, Response } from "express";

export const proxyRoutes = Router();

proxyRoutes.get("/", (_req: Request, res: Response) => {
  res.json({ ok: true, message: "Proxy service running" });
});

proxyRoutes.get("/health", (_req: Request, res: Response) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});