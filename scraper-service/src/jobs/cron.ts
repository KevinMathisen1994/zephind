import { logger } from "../logger";
import { syncAllAccounts } from "../services/mailIngest";
import { evaluateUnevaluatedMatches } from "../api/evaluate";

/**
 * Scheduled mailbox sync and server-side match evaluation. Ported from convex/crons.js.
 *
 * Every connected mailbox, checked for new 物件紹介 mail. 15 minutes balances
 * "new listings show up reasonably fast" against Gmail/Graph API quota and LLM
 * extraction cost (one call per new email, not per poll).
 *
 * Also checks for unevaluated matches (from scrapes or mail) and evaluates them on
 * the server, keeping the UI fast and removing the need to keep the Orders tab open.
 *
 * setInterval, not a cron table: this service is a single long-lived process, so
 * there is no scheduler to register with. Running two instances would double the
 * sync, hence MAIL_SYNC_ENABLED for the replicas that should not run it.
 */
const INTERVAL_MS = 15 * 60 * 1000;

export function startCrons() {
  if (process.env.MAIL_SYNC_ENABLED === "false") {
    logger.info("[cron] mail sync disabled (MAIL_SYNC_ENABLED=false)");
    return;
  }

  let running = false;
  const tick = async () => {
    // A sync that outruns the interval must not overlap itself: two passes over
    // the same mailbox would double every LLM call.
    if (running) {
      logger.warn("[cron] previous background job still running, skipping this tick");
      return;
    }
    running = true;
    try {
      await runBackgroundTasks();
    } finally {
      running = false;
    }
  };

  setInterval(() => void tick(), INTERVAL_MS).unref();
  logger.info(`[cron] background tasks scheduled every ${INTERVAL_MS / 60000} minutes`);
}

/** One pass of the background work. Also called by pg_cron via POST /api/ingest/background. */
export async function runBackgroundTasks() {
  try {
    await syncAllAccounts();
  } catch (e) {
    logger.error("[cron] mail sync failed: " + ((e as Error).stack || e));
  }

  try {
    const evaluated = await evaluateUnevaluatedMatches(15);
    if (evaluated > 0) {
      logger.info(`[cron] evaluated ${evaluated} match(es) on server`);
    }
  } catch (e) {
    logger.error("[cron] server auto-evaluation failed: " + ((e as Error).stack || e));
  }
}
