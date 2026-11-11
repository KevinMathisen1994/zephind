/**
 * puppeteer-extra + the stealth plugin, applied ONCE here so every scraper can
 * import this instead of plain `puppeteer` without repeating the setup.
 *
 * Plain puppeteer's headless Chrome is trivially fingerprinted (e.g.
 * `navigator.webdriver === true`, missing plugins/mimeTypes, a headless-only
 * user agent string) — exactly what Akamai and similar bot-detection check
 * for, and what has been triggering the "認証にご協力ください" / 405 blocks on
 * athome/homes. The stealth plugin patches those tells. It does not defeat
 * every anti-bot system (IP-based rate limiting, e.g. hatomark's block today,
 * is a separate problem this does not touch), but it removes the cheapest,
 * most common signal.
 *
 * puppeteer-extra's `.launch()`/`.newPage()` API is drop-in compatible with
 * plain puppeteer, so every existing `puppeteer.launch({...})` call site needs
 * no other change — only the import.
 */
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

puppeteer.use(StealthPlugin());

// Sites read from server-rendered HTML: images, fonts, media AND scripts are skipped.
// Verified 2026-11-11 on 千代田区 (same or more listings than full load). Blocking
// images alone on other sites broke stepon (its JS retried them past networkidle2),
// so non-listed hosts get no blocking at all. "*" (test harness only) means every host.
const LEAN_TYPES = new Set(["image", "media", "font", "script"]);
export const LEAN_HOSTS = new Set<string>([
  "realestate.rakuten.co.jp",
  "www.nomu.com", // nomu + nomu_pro
  "www.hatomarksite.com",
  "www.stepon.co.jp",
  "www.livable.co.jp", // tokyu
  "www.odakyu-chukai.com",
  "suumo.jp",
  "www.homes.co.jp", // 34 listings without JS vs 0 (bot check) with it
]);

function isLean(frameUrl: string | undefined): boolean {
  if (LEAN_HOSTS.has("*")) return true;
  try {
    return LEAN_HOSTS.has(new URL(frameUrl ?? "").hostname);
  } catch {
    return false;
  }
}

// Wrap newPage (not targetcreated) so interception is on before the scraper's first goto.
const launch = puppeteer.launch.bind(puppeteer);
puppeteer.launch = (async (...args: Parameters<typeof launch>) => {
  const browser = await launch(...args);
  if (process.env.SCRAPE_BLOCK_RESOURCES === "0") return browser;
  const newPage = browser.newPage.bind(browser);
  browser.newPage = async (...pageArgs: Parameters<typeof newPage>) => {
    const page = await newPage(...pageArgs);
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      if (req.isInterceptResolutionHandled()) return;
      const block = LEAN_TYPES.has(req.resourceType()) && isLean(req.frame()?.url());
      (block ? req.abort() : req.continue()).catch(() => {}); // page may already be closed
    });
    return page;
  };
  return browser;
}) as typeof launch;

export default puppeteer;
