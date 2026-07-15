import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import { logger } from "./logger";
import { scrapeRoutes } from "./services/scrapeRoutes";
import { proxyRoutes } from "./services/proxyRoutes";

const app = express();
const PORT = process.env.PORT || 3001;

// Allow all origins for local development
app.use(cors());

// Health check
app.get("/health", (_req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

// Routes
app.use("/scrape", scrapeRoutes);
app.use("/proxy", proxyRoutes);

app.listen(PORT, () => {
  logger.info(`Scraper service running on port ${PORT}`);
});