/**
 * Local stdio MCP server (dev / single machine). Users normally connect via the remote endpoint, src/api/mcp.ts.
 * stdout is the MCP channel, so log to stderr only.
 */
import { resolve } from "node:path";
import dotenv from "dotenv";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

// Claude Desktop starts us from an arbitrary cwd, so load .env by path, not cwd.
dotenv.config({ path: resolve(__dirname, "../.env") });
process.env.LOG_TO_STDERR = "1";

async function main() {
  // Dynamic import: supabase.ts reads env at load time, after dotenv above.
  const { createZephindMcpServer } = await import("./mcp/tools");
  const server = createZephindMcpServer(process.env.ZEPHIND_USER_ID ?? null);
  await server.connect(new StdioServerTransport());
  console.error("zephind MCP ready");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
