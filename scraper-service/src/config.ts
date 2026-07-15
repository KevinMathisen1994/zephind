export const config = {
  port: parseInt(process.env.PORT || "3001"),
  convexUrl: process.env.CONVEX_URL || "",
  convexSiteUrl: process.env.CONVEX_SITE_URL || "",
  scraperSource: process.env.SCRAPER_SOURCE || "athome",
  maxConcurrent: parseInt(process.env.MAX_CONCURRENT || "3"),
  requestDelay: parseInt(process.env.REQUEST_DELAY || "2000"),
  userAgent:
    process.env.USER_AGENT ||
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
};