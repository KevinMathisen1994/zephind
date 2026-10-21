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

export default puppeteer;
