/**
 * Tells Convex how to validate the Clerk JWT the browser sends.
 *
 * Without this file `ctx.auth.getUserIdentity()` always returns null, which is
 * why every query was serving the same shared pool to every account.
 *
 * SETUP (dashboard step cannot be done from code):
 *   1. Open https://dashboard.clerk.com/apps/setup/convex and click
 *      "Activate Convex integration". This replaces the old manual
 *      "JWT Templates → new template named convex" flow — Clerk now creates the
 *      template and pre-maps the aud=convex claim for you.
 *   2. Copy the "Frontend API URL" shown there, then:
 *        npx convex env set CLERK_FRONTEND_API_URL https://<your>.clerk.accounts.dev
 *
 * Both env names are accepted below: CLERK_FRONTEND_API_URL is what Clerk's
 * current docs use, CLERK_JWT_ISSUER_DOMAIN is the older Convex name. They hold
 * the same value (the issuer origin), so reading either avoids a silent
 * fail-closed if only one is set.
 */
const issuer =
  process.env.CLERK_FRONTEND_API_URL || process.env.CLERK_JWT_ISSUER_DOMAIN;

export default {
  providers: [
    {
      domain: issuer,
      // Must match the token's `aud` claim. The Convex integration sets aud=convex.
      applicationID: "convex",
    },
  ],
};
