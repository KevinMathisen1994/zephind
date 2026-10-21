import type { NextFunction, Request, RequestHandler, Response } from "express";
import { HttpError } from "../auth/authz";
import { logger } from "../logger";

/**
 * Wraps an async route so a thrown HttpError becomes its status and anything
 * else becomes a 500. Without this an async throw is an unhandled rejection
 * that hangs the request instead of answering it.
 */
export function route(fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res)
      .then((body) => {
        if (!res.headersSent) res.json(body ?? null);
      })
      .catch((err: unknown) => {
        if (res.headersSent) return next(err);
        if (err instanceof HttpError) {
          res.status(err.status).json({ error: err.message });
          return;
        }
        logger.error(`${req.method} ${req.originalUrl}: ${(err as Error).stack || err}`);
        res.status(500).json({ error: (err as Error).message || String(err) });
      });
  };
}
