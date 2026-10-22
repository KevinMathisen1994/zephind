import express from "express";
import cors from "cors";
import { attachIdentity, recentAuthEvents } from "./auth/clerk";
import { customersRouter } from "./api/customers";
import { dealsRouter } from "./api/deals";
import { emailSettingsRouter } from "./api/emailSettings";
import { evaluateRouter } from "./api/evaluate";
import { ingestRouter } from "./api/ingest";
import { listingsRouter } from "./api/listings";
import { mailRouter } from "./api/mail";
import { matchingRouter } from "./api/matching";
import { oauthRouter } from "./api/oauth";
import { ordersRouter } from "./api/orders";
import { propertiesRouter } from "./api/properties";
import { proposalsRouter } from "./api/proposals";
import { savedListingsRouter } from "./api/savedListings";
import { scrapeTriggerRouter } from "./api/scrapeTrigger";
import { scraperHealthRouter } from "./api/scraperHealth";

/**
 * The application API without the scrapers (no Puppeteer), shared by the Node
 * server (src/index.ts) and the Supabase Edge Function (supabase/functions/api).
 */
export function createApiApp() {
  const app = express();

  // Allow all origins for local development
  app.use(cors());
  // The limit is raised from the 100kb default because an ingest batch carries
  // a whole source+area slice of a scrape run.
  app.use(express.json({ limit: "25mb" }));
  // Verifies the Clerk JWT when one is present. It never rejects — each router
  // decides whether it needs an identity, so /scrape and /health stay open.
  app.use(attachIdentity);

  app.get("/health", (_req, res) => {
    res.json({ ok: true, timestamp: new Date().toISOString() });
  });

  // Reports what THIS process actually loaded, so a stale restart or an unloaded
  // .env is distinguishable from a genuinely bad token. Nothing secret: the
  // issuer already ships in the frontend bundle. Disabled in production.
  if (process.env.NODE_ENV !== "production") {
    app.get("/debug/auth-config", (_req, res) => {
      res.json({
        issuer: process.env.CLERK_FRONTEND_API_URL || process.env.CLERK_JWT_ISSUER_DOMAIN || null,
        audienceEnforced: process.env.CLERK_JWT_AUDIENCE || null,
        allowedOrigins: process.env.CLERK_ALLOWED_ORIGINS || null,
        supabaseConfigured: Boolean(process.env.SUPABASE_URL),
        recentAuthEvents,
      });
    });
  }

  // Application API, ported from convex/. Every router here enforces its own
  // per-user access control; see src/auth/authz.ts.
  app.use("/api/orders", ordersRouter);
  app.use("/api/customers", customersRouter);
  app.use("/api/deals", dealsRouter);
  app.use("/api/listings", listingsRouter);
  app.use("/api/matching", matchingRouter);
  app.use("/api/saved-listings", savedListingsRouter);
  app.use("/api/proposals", proposalsRouter);
  app.use("/api/properties", propertiesRouter);
  app.use("/api/email-settings", emailSettingsRouter);
  app.use("/api/evaluate", evaluateRouter);
  app.use("/api/mail", mailRouter);
  app.use("/api/scraper-health", scraperHealthRouter);
  app.use("/api/scrape-trigger", scrapeTriggerRouter);
  // Machine-to-machine, guarded by SCRAPER_INGEST_SECRET rather than Clerk — the
  // scheduled runner has no browser session.
  app.use("/api/ingest", ingestRouter);
  // Providers redirect the browser here; no Clerk session, the OAuth state is the
  // identity check.
  app.use("/oauth", oauthRouter);

  return app;
}
