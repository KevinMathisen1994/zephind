/**
 * Run a scrape on THIS machine instead of on GitHub Actions.
 *
 * WHY
 * ---
 * 手動検索 in the UI dispatches .github/workflows/scrape.yml, which does
 * `actions/checkout` and runs `npm run scrape:cron` from the repo's default
 * branch. That means the cloud run always executes COMMITTED code: while
 * iterating on a scraper, every change has to be pushed before it can be tested,
 * and a local fix appears to do nothing.
 *
 * This endpoint runs the same sweep from the working tree, writing to the same
 * backend, so the UI fills in exactly as it does for a cloud run.
 *
 * IT SPAWNS THE CLI RATHER THAN IMPORTING IT
 * ------------------------------------------
 * `npm run scrape:cron` is the same entrypoint GitHub uses, so local and cloud
 * cannot drift in argument handling, env defaults, or ingest behaviour. Importing
 * main() would also mean a scrape crash takes the dev server down with it, and
 * Chrome instances would share this process's memory.
 *
 * LOCAL ONLY, DELIBERATELY UNAUTHENTICATED
 * ----------------------------------------
 * This server is a developer tool bound to localhost with permissive CORS. It
 * must never be exposed publicly: anything that can reach it can spend hours of
 * scraping and write to the database via the ingest secret in this process's env.
 */
import { Router } from "express";
import { spawn, type ChildProcess } from "child_process";
import path from "path";
import { KNOWN_SOURCES } from "./scraperRegistry";
import { logger } from "../logger";

export const localRunRoutes = Router();

/** Package root (this file lives in src/services). tsconfig targets CommonJS
 *  here, so __dirname is the portable choice — import.meta is a compile error. */
const PACKAGE_ROOT = path.resolve(__dirname, "../..");

/** Last lines of output, so the UI can show what the run is doing. */
const LOG_LIMIT = 60;

type RunState = {
  child: ChildProcess | null;
  startedAt: number | null;
  finishedAt: number | null;
  exitCode: number | null;
  orderId: string | null;
  lines: string[];
};

const run: RunState = {
  child: null,
  startedAt: null,
  finishedAt: null,
  exitCode: null,
  orderId: null,
  lines: [],
};

const isRunning = () => run.child !== null && run.child.exitCode === null;

/**
 * Same rule src/api/scrapeTrigger.ts applies to workflow inputs: these strings become
 * CLI arguments, so anything outside [alphanumeric _ , -] is either useless or an
 * attempt to smuggle something in. Reject rather than strip, so a typo is visible.
 */
function cleanList(raw: unknown, label: string): string {
  if (raw === undefined || raw === null) return "";
  const value = String(raw).trim();
  if (value === "") return "";
  if (!/^[A-Za-z0-9_,-]+$/.test(value)) {
    throw new Error(`${label} に使用できない文字が含まれています: ${value}`);
  }
  return value;
}

function record(line: string) {
  for (const part of line.split(/\r?\n/)) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    run.lines.push(trimmed);
    if (run.lines.length > LOG_LIMIT) run.lines.shift();
  }
}

/** POST /scrape-run { areas, sources, orderId } — start a local sweep. */
localRunRoutes.post("/scrape-run", (req, res) => {
  if (isRunning()) {
    // One at a time: concurrent sweeps mean concurrent Chrome fleets, and the
    // scrapers are already sequential for exactly that reason.
    res.status(409).json({
      error: "ローカルスクレイパーは既に実行中です。完了を待つか中止してください。",
      startedAt: run.startedAt,
    });
    return;
  }

  let areas: string;
  let sources: string;
  try {
    areas = cleanList(req.body?.areas, "エリアコード");
    sources = cleanList(req.body?.sources, "取得サイト");
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
    return;
  }

  const unknown = sources
    .split(",")
    .filter(Boolean)
    .filter((s) => !KNOWN_SOURCES.includes(s));
  if (unknown.length > 0) {
    res.status(400).json({ error: `不明な取得サイト: ${unknown.join(", ")}` });
    return;
  }

  const orderId =
    // Hyphens allowed: ids are uuids now, not Convex's alphanumeric-only ones.
    typeof req.body?.orderId === "string" && /^[a-z0-9-]+$/i.test(req.body.orderId)
      ? req.body.orderId
      : "";

  if (!process.env.BACKEND_URL || !process.env.SCRAPER_INGEST_SECRET) {
    // Fail loudly here rather than letting the child exit with the same message
    // into a log nobody is watching.
    res.status(500).json({
      error:
        "scraper-service/.env に BACKEND_URL と SCRAPER_INGEST_SECRET を設定してください（.env.example を参照）。",
    });
    return;
  }

  const args = ["run", "scrape:cron", "--"];
  if (areas) args.push(`--areas=${areas}`);
  if (sources) args.push(`--sources=${sources}`);

  const child = spawn("npm", args, {
    cwd: PACKAGE_ROOT,
    env: { ...process.env, SCRAPE_ORDER_ID: orderId },
    stdio: ["ignore", "pipe", "pipe"],
    // Own process group, so cancelling can signal the WHOLE tree. `npm run` does
    // not forward SIGTERM to the tsx child it spawns (verified: cancel returned ok
    // while the scrape kept running), and the scrape is what holds the Chrome
    // instances.
    detached: true,
  });

  run.child = child;
  run.startedAt = Date.now();
  run.finishedAt = null;
  run.exitCode = null;
  run.orderId = orderId || null;
  run.lines = [];

  child.stdout?.on("data", (d) => {
    record(String(d));
    process.stdout.write(d);
  });
  child.stderr?.on("data", (d) => {
    record(String(d));
    process.stderr.write(d);
  });
  child.on("error", (err) => {
    record(`spawn error: ${err.message}`);
    run.exitCode = -1;
    run.finishedAt = Date.now();
    run.child = null;
  });
  child.on("close", (code) => {
    logger.info(`[local run] finished with exit code ${code}`);
    run.exitCode = code ?? -1;
    run.finishedAt = Date.now();
    run.child = null;
  });

  logger.info(
    `[local run] started: areas=${areas || "(orders)"} sources=${sources || "(all known)"} order=${orderId || "(all)"}`,
  );
  res.json({ ok: true, startedAt: run.startedAt, pid: child.pid });
});

/** GET /scrape-run/status — is it still going, and what has it said. */
localRunRoutes.get("/scrape-run/status", (_req, res) => {
  res.json({
    running: isRunning(),
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    exitCode: run.exitCode,
    orderId: run.orderId,
    // Newest last, matching how a terminal reads.
    lines: run.lines.slice(-LOG_LIMIT),
  });
});

/** POST /scrape-run/cancel — stop the local sweep. */
localRunRoutes.post("/scrape-run/cancel", (_req, res) => {
  if (!isRunning() || !run.child?.pid) {
    res.json({ ok: true, alreadyFinished: true });
    return;
  }
  const pid = run.child.pid;

  /** Signal the whole process group (see `detached` above). */
  const killGroup = (signal: NodeJS.Signals) => {
    try {
      process.kill(-pid, signal);
      return true;
    } catch {
      // Group already gone, or never created — fall back to the direct child.
      try {
        run.child?.kill(signal);
        return true;
      } catch {
        return false;
      }
    }
  };

  killGroup("SIGTERM");
  // Puppeteer can sit in a navigation that ignores SIGTERM; escalate rather than
  // leaving a headless Chrome fleet running behind a UI that says "cancelled".
  setTimeout(() => {
    if (isRunning()) {
      logger.warn("[local run] still alive after SIGTERM — sending SIGKILL");
      killGroup("SIGKILL");
    }
  }, 5000);

  res.json({ ok: true });
});
