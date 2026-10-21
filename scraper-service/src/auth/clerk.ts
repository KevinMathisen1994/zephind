import type { NextFunction, Request, Response } from "express";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { logger } from "../logger";

/**
 * Verifies the Clerk session JWT the browser sends as `Authorization: Bearer`.
 *
 * Replaces convex/auth.config.js + ctx.auth.getUserIdentity().
 *
 * This checks Clerk's DEFAULT session token, not a named JWT template. The old
 * `convex` template was created by Clerk's Convex integration and disappears
 * with it; the default token needs no template to exist and no dashboard setup.
 * It carries no `aud` claim, so the audience check below only runs when
 * CLERK_JWT_AUDIENCE is explicitly set (i.e. if you do go back to a template).
 */
const issuer = process.env.CLERK_FRONTEND_API_URL || process.env.CLERK_JWT_ISSUER_DOMAIN;
if (!issuer) {
  throw new Error(
    "CLERK_FRONTEND_API_URL (or CLERK_JWT_ISSUER_DOMAIN) must be set — without it " +
      "every request fails closed as unauthenticated.",
  );
}

// Only enforced when set. Clerk's default session token has no `aud`, so a
// non-empty value here means "a custom JWT template is in use".
const audience = process.env.CLERK_JWT_AUDIENCE || undefined;

/**
 * Clerk puts the requesting origin in `azp`. Checking it stops a token minted
 * for a different app on the same Clerk instance from being replayed here.
 * Comma-separated; unset means no check, which is the right default for local
 * development against a dev Clerk instance.
 */
const allowedParties = (process.env.CLERK_ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const jwks = createRemoteJWKSet(new URL(`${issuer.replace(/\/$/, "")}/.well-known/jwks.json`));

export interface Identity {
  subject: string;
  email?: string;
  name?: string;
  nickname?: string;
  givenName?: string;
  familyName?: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      identity?: Identity;
    }
  }
}

export async function verifyBearer(token: string): Promise<Identity> {
  const { payload } = await jwtVerify(token, jwks, {
    issuer,
    ...(audience ? { audience } : {}),
  });
  if (!payload.sub) throw new Error("token has no subject");
  if (allowedParties.length > 0 && !allowedParties.includes(String(payload.azp))) {
    throw new Error(`token azp ${payload.azp} is not an allowed origin`);
  }
  // Which claims are present depends on the Clerk JWT template; the `convex`
  // template maps few of them, so callers fall through several.
  return {
    subject: payload.sub,
    email: (payload.email as string) || undefined,
    name: (payload.name as string) || undefined,
    nickname: (payload.nickname as string) || undefined,
    givenName: (payload.given_name as string) || undefined,
    familyName: (payload.family_name as string) || undefined,
  };
}

/**
 * The last few auth outcomes, for the dev-only /debug/auth-config probe. The
 * logger is console-only, so without this a rejected token is invisible to
 * anything but the terminal the server happens to be running in.
 */
export const recentAuthEvents: { at: string; route: string; outcome: string }[] = [];

function recordAuthEvent(route: string, outcome: string) {
  recentAuthEvents.unshift({ at: new Date().toISOString(), route, outcome });
  recentAuthEvents.length = Math.min(recentAuthEvents.length, 10);
}

/** Attaches req.identity when a valid token is present. Never rejects. */
export async function attachIdentity(req: Request, _res: Response, next: NextFunction) {
  const header = req.header("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (token) {
    try {
      req.identity = await verifyBearer(token);
      recordAuthEvent(`${req.method} ${req.path}`, `accepted sub=${req.identity.subject}`);
    } catch (err) {
      recordAuthEvent(`${req.method} ${req.path}`, `rejected: ${(err as Error).message}`);
      // Left unauthenticated; requireAuth turns that into a 401. The reason is
      // logged because a silently rejected token and a missing one produce the
      // same 401, which makes a misconfiguration impossible to tell apart from
      // a signed-out user.
      logger.warn(
        `[auth] rejected a bearer token on ${req.method} ${req.path}: ` +
          `${(err as Error).message} (expected issuer ${issuer}` +
          `${audience ? `, audience ${audience}` : ", no audience check"})`,
      );
    }
  } else if (req.path.startsWith("/api/") && !req.path.startsWith("/api/ingest")) {
    recordAuthEvent(`${req.method} ${req.path}`, "no Authorization header");
    logger.warn(`[auth] no Authorization header on ${req.method} ${req.path}`);
  }
  next();
}

/** Route guard. Mirrors convex/lib/authz.js requireUserId: fails loud, not quiet. */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.identity) {
    res.status(401).json({
      error:
        "未認証のリクエストです。ログインしてください。 (Not signed in — if you ARE signed in, " +
        "CLERK_FRONTEND_API_URL on the backend does not match your Clerk instance)",
    });
    return;
  }
  next();
}
