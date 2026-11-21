import winston from "winston";

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      // The stdio MCP server (src/mcp.ts) owns stdout, so it routes every level to stderr.
      stderrLevels: process.env.LOG_TO_STDERR ? ["error", "warn", "info", "http", "verbose", "debug", "silly"] : undefined,
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          const metaStr = Object.keys(meta).length ? JSON.stringify(meta) : "";
          return `${timestamp} [${level}] ${message} ${metaStr}`;
        })
      ),
    }),
  ],
});