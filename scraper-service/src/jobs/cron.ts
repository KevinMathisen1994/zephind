import { logger } from "../logger";
import { syncAllAccounts } from "../services/mailIngest";

/**
 * Scheduled mailbox sync. Ported from convex/crons.js.
 *
 * Every connected mailbox, checked for new 物件紹介 mail. 15 minutes balances
 * "new listings show up reasonably fast" against Gmail/Graph API quota and LLM
 * extraction cost (one call per new email, not per poll).
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
      logger.warn("[cron] previous mail sync still running, skipping this tick");
      return;
    }
    running = true;
    try {
      await syncAllAccounts();
    } catch (e) {
      logger.error("[cron] mail sync failed: " + ((e as Error).stack || e));
    } finally {
      running = false;
    }
  };

  setInterval(() => void tick(), INTERVAL_MS).unref();
  logger.info(`[cron] mail sync every ${INTERVAL_MS / 60000} minutes`);
}
