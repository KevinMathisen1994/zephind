/**
 * Supabase Edge Function entry (bundled by `npm run build:edge`). Supabase hands
 * requests for .../functions/v1/api/* to this app with the "/api" prefix kept,
 * so the frontend's /api/* paths match as-is when VITE_API_URL=.../functions/v1.
 */
import { createApiApp } from "./app";
import { oauthRouter } from "./api/oauth";

const app = createApiApp();
// Only /api/* reaches this function, so OAuth callbacks live under it too:
// PUBLIC_BACKEND_URL=.../functions/v1/api.
app.use("/api/oauth", oauthRouter);
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});
app.listen(8000);
