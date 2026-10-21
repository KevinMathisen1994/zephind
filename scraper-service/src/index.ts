// Must precede every other import: it populates process.env, which several of
// the modules below read as they are evaluated. See src/loadEnv.ts.
import "./loadEnv";

import { createRequire } from "module";
const customRequire = createRequire(process.cwd() + "/package.json");
if (typeof (globalThis as any).require === "undefined") {
  (globalThis as any).require = customRequire;
}

import express from "express";
import cors from "cors";
import { logger } from "./logger";
import { scrapeRoutes } from "./services/scrapeRoutes";
import { localRunRoutes } from "./services/localRunRoutes";
import { proxyRoutes } from "./services/proxyRoutes";
import { checkAllScrapers, checkScraper } from "./services/healthCheck";
import { KNOWN_SOURCES, SOURCE_LABELS } from "./services/scraperRegistry";
import { attachIdentity, recentAuthEvents } from "./auth/clerk";
import { startCrons } from "./jobs/cron";
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

const app = express();
const PORT = process.env.PORT || 3001;

// Allow all origins for local development
app.use(cors());
// /scrape-run takes a JSON body; without this req.body is undefined. The limit
// is raised from the 100kb default because an ingest batch carries a whole
// source+area slice of a scrape run.
app.use(express.json({ limit: "25mb" }));
// Verifies the Clerk JWT when one is present. It never rejects — each router
// decides whether it needs an identity, so /scrape and /health stay open.
app.use(attachIdentity);

// Health check
app.get("/health", (_req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

// Scraper health board.
//   GET /health/scrapers                -> list of known sources (no scraping)
//   GET /health/scrapers?source=athome  -> check ONE scraper
//   GET /health/scrapers?sources=a,b    -> check a subset
//   GET /health/scrapers?all=1          -> check every scraper (slow: minutes)
//
// The frontend checks sources one at a time and persists each result to Convex
// as it lands, so the board fills in progressively instead of hanging on a
// single multi-minute request.
app.get("/health/scrapers", async (req, res) => {
  const { source, sources, all, areaCode } = req.query;
  const code = typeof areaCode === "string" && areaCode ? areaCode : undefined;

  try {
    if (source && typeof source === "string") {
      if (!KNOWN_SOURCES.includes(source)) {
        res.status(400).json({ error: `Unknown source: ${source}`, knownSources: KNOWN_SOURCES });
        return;
      }
      res.json({ results: [await checkScraper(source, code)] });
      return;
    }

    if (sources && typeof sources === "string") {
      const list = sources.split(",").map((s) => s.trim()).filter((s) => KNOWN_SOURCES.includes(s));
      if (list.length === 0) {
        res.status(400).json({ error: "No valid sources", knownSources: KNOWN_SOURCES });
        return;
      }
      res.json({ results: await checkAllScrapers(list, code) });
      return;
    }

    if (all === "1" || all === "true") {
      res.json({ results: await checkAllScrapers(KNOWN_SOURCES, code) });
      return;
    }

    // Default: cheap inventory so the UI can render the board before any run.
    res.json({
      sources: KNOWN_SOURCES.map((s) => ({ source: s, label: SOURCE_LABELS[s] || s })),
    });
  } catch (error) {
    logger.error("Health check error: " + ((error as Error).stack || error));
    res.status(500).json({ error: (error as Error).message || String(error) });
  }
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

// Scraper routes
app.use("/scrape", scrapeRoutes);
app.use("/proxy", proxyRoutes);
// Runs the WORKING TREE's scraper (same entrypoint GitHub Actions uses) and
// writes to Convex itself, so a local change can be tested without pushing.
app.use("/", localRunRoutes);

app.listen(PORT, () => {
  logger.info(`Zephind backend running on port ${PORT}`);
  startCrons();
});