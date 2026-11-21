/**
 * Remote MCP endpoint for Claude custom connectors, plus the per-user keys that authorize it.
 * The connector URL is /api/mcp/<key>: Claude's connector UI can't send custom headers, so the key lives in the path.
 */
import { createHash, randomBytes } from "node:crypto";
import { Router } from "express";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { db } from "../db";
import { requireOwned, requireUserId } from "../auth/authz";
import { isAllowed } from "../auth/access";
import { logger } from "../logger";
import { createZephindMcpServer } from "../mcp/tools";
import { route } from "./handler";

const hashKey = (key: string) => createHash("sha256").update(key).digest("hex");

export const mcpKeysRouter = Router();

mcpKeysRouter.get("/", route(async (req) => {
  const userId = requireUserId(req);
  const rows = await db.list("mcpKeys", { where: { userId }, order: { by: "_creationTime", desc: true } });
  return rows.map(({ _id, _creationTime, label, keyPrefix, lastUsedAt }) => ({ _id, _creationTime, label, keyPrefix, lastUsedAt }));
}));

mcpKeysRouter.post("/", route(async (req) => {
  const userId = requireUserId(req);
  const key = `zk_${randomBytes(32).toString("base64url")}`;
  const label = String(req.body?.label ?? "").trim().slice(0, 60) || "Claude";
  const id = await db.insert("mcpKeys", { userId, email: req.identity?.email ?? null, label, keyHash: hashKey(key), keyPrefix: key.slice(0, 7) });
  // The raw key is returned once and never stored.
  return { id, key };
}));

mcpKeysRouter.delete("/:id", route(async (req) => {
  await requireOwned(req, "mcpKeys", req.params.id, "接続キー");
  await db.delete("mcpKeys", req.params.id);
  return null;
}));

export const mcpRouter = Router();

mcpRouter.post("/:key", async (req, res) => {
  try {
    const row = await db.first("mcpKeys", { where: { keyHash: hashKey(req.params.key) } });
    if (!row) {
      res.status(401).json({ jsonrpc: "2.0", error: { code: -32001, message: "Invalid or revoked Zephind key" }, id: null });
      return;
    }
    if (!(await isAllowed(row.email))) {
      res.status(403).json({ jsonrpc: "2.0", error: { code: -32001, message: "This Zephind account no longer has access" }, id: null });
      return;
    }
    db.patch("mcpKeys", row._id, { lastUsedAt: Date.now() }).catch(() => {});

    // Stateless: a fresh server per request, so it works on the edge function with no session store.
    const server = createZephindMcpServer(row.userId);
    // Web-standard transport: the Node one reads req.rawHeaders, which Supabase's edge runtime doesn't provide.
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
    const response = await transport.handleRequest(
      new Request(`http://localhost${req.originalUrl}`, { method: "POST", headers, body: JSON.stringify(req.body) }),
      { parsedBody: req.body },
    );
    res.status(response.status);
    response.headers.forEach((v, k) => res.setHeader(k, v));
    res.send(await response.text());
    void transport.close();
    void server.close();
  } catch (err) {
    logger.error(`mcp: ${(err as Error).stack || err}`);
    if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null });
  }
});

// Stateless server: no SSE stream (GET) or session to end (DELETE).
mcpRouter.all("/:key", (_req, res) => {
  res.status(405).set("Allow", "POST").json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null });
});
