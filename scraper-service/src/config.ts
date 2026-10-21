export const config = {
  port: parseInt(process.env.PORT || "3001"),
  backendUrl: process.env.BACKEND_URL || "",
  scraperSource: process.env.SCRAPER_SOURCE || "athome",
  maxConcurrent: parseInt(process.env.MAX_CONCURRENT || "3"),
  maxPagesPerSite: parseInt(process.env.MAX_PAGES_PER_SITE || "5"),
  requestDelay: parseInt(process.env.REQUEST_DELAY || "2000"),
  userAgent:
    process.env.USER_AGENT ||
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
};