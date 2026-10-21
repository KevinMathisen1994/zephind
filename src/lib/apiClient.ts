/**
 * HTTP client for the Zephind backend (scraper-service), which replaced Convex.
 *
 * The Clerk token is fetched per request rather than cached: Clerk rotates
 * short-lived session tokens, and a cached one starts failing with 401 a minute
 * into a long-lived tab.
 */
const BASE_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") || "";

type TokenGetter = () => Promise<string | null>;

let getToken: TokenGetter | null = null;

/**
 * Registered by ApiProvider from Clerk's useAuth(). Module-level rather than
 * context so plain functions (not just hooks) can authenticate.
 */
export function setTokenGetter(fn: TokenGetter | null) {
  getToken = fn;
}

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function apiFetch<T = unknown>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers["Content-Type"] = "application/json";

  const token = getToken ? await getToken() : null;
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${BASE_URL}${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

  const raw = await res.text();
  let parsed: any = null;
  if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      // A proxy's HTML error page, most often — surface it rather than a
      // "Unexpected token '<'" parse error with no context.
      throw new ApiError(res.status, `${path} returned non-JSON (HTTP ${res.status}): ${raw.slice(0, 200)}`);
    }
  }
  if (!res.ok) throw new ApiError(res.status, parsed?.error || `${path} failed (HTTP ${res.status})`);
  return parsed as T;
}
