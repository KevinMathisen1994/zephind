// Must precede every other import: it populates process.env, which several of
// the modules below read as they are evaluated. See src/loadEnv.ts.
import "./loadEnv";

import { createRequire } from "module";
const customRequire = createRequire(process.cwd() + "/package.json");
if (typeof (globalThis as any).require === "undefined") {
  (globalThis as any).require = customRequire;
}

import { createApiApp } from "./app";
import { logger } from "./logger";
import { scrapeRoutes } from "./services/scrapeRoutes";
import { localRunRoutes } from "./services/localRunRoutes";
import { proxyRoutes } from "./services/proxyRoutes";
import { checkAllScrapers, checkScraper } from "./services/healthCheck";
import { KNOWN_SOURCES, SOURCE_LABELS } from "./services/scraperRegistry";
import { startCrons } from "./jobs/cron";

const app = createApiApp();
const PORT = process.env.PORT || 3001;

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

// Scraper routes
app.use("/scrape", scrapeRoutes);
app.use("/proxy", proxyRoutes);
// Runs the WORKING TREE's scraper (same entrypoint GitHub Actions uses) and
// writes to Convex itself, so a local change can be tested without pushing.
app.use("/", localRunRoutes);

app.listen(PORT, () => {
  logger.info(`Zephind backend running on port ${PORT}`);
  // Print the exact OAuth callback URLs. These must appear byte-for-byte in the
  // Google / Azure app registrations, or the provider answers
  // "redirect_uri is not valid" before the user ever reaches our callback.
  const base = (process.env.PUBLIC_BACKEND_URL || "").replace(/\/$/, "");
  logger.info(
    `Mail OAuth callbacks: ${process.env.OUTLOOK_OAUTH_REDIRECT_URI || `${base}/oauth/outlook/callback`} | ${process.env.GMAIL_OAUTH_REDIRECT_URI || `${base}/oauth/gmail/callback`}`,
  );
  startCrons();
});