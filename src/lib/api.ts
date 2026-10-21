/**
 * Endpoint descriptors, shaped like the old convex/_generated/api object so
 * call sites read the same: `useQuery(api.orders.list)`,
 * `useMutation(api.orders.create)`.
 *
 * Each descriptor carries its HTTP method, how to build the path and body from
 * the call's arguments, a cache key, and — for writes — which query keys the
 * write makes stale. Invalidation is explicit here because Convex's reactivity
 * is gone: a mutation that names no key leaves the screen showing old data.
 */
export interface Endpoint<Args = any, Result = any> {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  key: string;
  path: (args: Args) => string;
  body?: (args: Args) => unknown;
  /** Query keys made stale by this write. */
  invalidates?: string[];
  /** Poll interval in ms for reads that must notice out-of-band writes. */
  refetchInterval?: number;
  /** Phantom, for inference at call sites. */
  __result?: Result;
}

function endpoint<Args = any, Result = any>(e: Endpoint<Args, Result>): Endpoint<Args, Result> {
  return e;
}

const id = (a: any) => encodeURIComponent(a.id);
/** Everything except `id`, which is already in the path. */
const withoutId = (a: any) => {
  const { id: _drop, ...rest } = a ?? {};
  return rest;
};

export const api = {
  orders: {
    list: endpoint({ method: "GET", key: "orders", path: () => "/api/orders" }),
    get: endpoint({ method: "GET", key: "orders.get", path: (a) => `/api/orders/${id(a)}` }),
    create: endpoint({
      method: "POST", key: "orders.create", path: () => "/api/orders",
      body: (a) => a, invalidates: ["orders"],
    }),
    update: endpoint({
      method: "PATCH", key: "orders.update", path: (a) => `/api/orders/${id(a)}`,
      body: withoutId, invalidates: ["orders", "orders.get"],
    }),
    remove: endpoint({
      method: "DELETE", key: "orders.remove", path: (a) => `/api/orders/${id(a)}`,
      // Deleting an order cascades to its matches and to listings no other
      // order references, so both lists go stale with it.
      invalidates: ["orders", "matching", "listings"],
    }),
  },

  customers: {
    list: endpoint({ method: "GET", key: "customers", path: () => "/api/customers" }),
    create: endpoint({
      method: "POST", key: "customers.create", path: () => "/api/customers",
      body: (a) => a, invalidates: ["customers"],
    }),
    update: endpoint({
      method: "PATCH", key: "customers.update", path: (a) => `/api/customers/${id(a)}`,
      body: withoutId, invalidates: ["customers"],
    }),
    remove: endpoint({
      method: "DELETE", key: "customers.remove", path: (a) => `/api/customers/${id(a)}`,
      invalidates: ["customers"],
    }),
  },

  deals: {
    list: endpoint({ method: "GET", key: "deals", path: () => "/api/deals" }),
    create: endpoint({
      method: "POST", key: "deals.create", path: () => "/api/deals",
      body: (a) => a, invalidates: ["deals"],
    }),
    updateStatus: endpoint({
      method: "PATCH", key: "deals.updateStatus", path: (a) => `/api/deals/${id(a)}/status`,
      body: (a) => ({ status: a.status }), invalidates: ["deals"],
    }),
    remove: endpoint({
      method: "DELETE", key: "deals.remove", path: (a) => `/api/deals/${id(a)}`,
      invalidates: ["deals"],
    }),
  },

  listings: {
    list: endpoint({
      method: "GET", key: "listings",
      path: (a) => {
        const p = new URLSearchParams();
        if (a?.ward) p.set("ward", a.ward);
        if (a?.priceMin != null) p.set("priceMin", String(a.priceMin));
        if (a?.priceMax != null) p.set("priceMax", String(a.priceMax));
        if (a?.limit != null) p.set("limit", String(a.limit));
        const qs = p.toString();
        return `/api/listings${qs ? `?${qs}` : ""}`;
      },
    }),
    // POST because a match set can hold hundreds of ids, past any URL length
    // that proxies reliably accept.
    getByIds: endpoint({
      method: "POST", key: "listings.getByIds", path: () => "/api/listings/by-ids",
      body: (a) => ({ ids: a.ids }),
    }),
    remove: endpoint({
      method: "DELETE", key: "listings.remove", path: (a) => `/api/listings/${id(a)}`,
      invalidates: ["listings", "listings.getByIds"],
    }),
  },

  matching: {
    // Polled: a scrape run writes matches from a GitHub Actions runner, so they
    // appear with no action in this tab to trigger a refetch.
    list: endpoint({ method: "GET", key: "matching", path: () => "/api/matching", refetchInterval: 30_000 }),
    saveScore: endpoint({
      method: "PATCH", key: "matching.saveScore", path: (a) => `/api/matching/${encodeURIComponent(a.matchId)}/score`,
      body: (a) => ({ score: a.score }), invalidates: ["matching"],
    }),
  },

  savedListings: {
    list: endpoint({ method: "GET", key: "savedListings", path: () => "/api/saved-listings" }),
    savedListingIds: endpoint({ method: "GET", key: "savedListings.ids", path: () => "/api/saved-listings/ids" }),
    toggle: endpoint({
      method: "POST", key: "savedListings.toggle", path: () => "/api/saved-listings/toggle",
      body: (a) => a, invalidates: ["savedListings", "savedListings.ids"],
    }),
    setNote: endpoint({
      method: "PATCH", key: "savedListings.setNote", path: (a) => `/api/saved-listings/${id(a)}/note`,
      body: (a) => ({ note: a.note }), invalidates: ["savedListings"],
    }),
    remove: endpoint({
      method: "DELETE", key: "savedListings.remove", path: (a) => `/api/saved-listings/${id(a)}`,
      invalidates: ["savedListings", "savedListings.ids"],
    }),
  },

  emailSettings: {
    get: endpoint({ method: "GET", key: "emailSettings", path: () => "/api/email-settings" }),
    save: endpoint({
      method: "PUT", key: "emailSettings.save", path: () => "/api/email-settings",
      body: (a) => a, invalidates: ["emailSettings"],
    }),
  },

  scraperHealth: {
    list: endpoint({ method: "GET", key: "scraperHealth", path: () => "/api/scraper-health" }),
    record: endpoint({
      method: "POST", key: "scraperHealth.record", path: () => "/api/scraper-health",
      body: (a) => a, invalidates: ["scraperHealth"],
    }),
  },

  evaluate: {
    evaluateListing: endpoint({
      method: "POST", key: "evaluate", path: () => "/api/evaluate",
      body: (a) => a, invalidates: ["matching"],
    }),
  },

  scrapeTrigger: {
    triggerScrape: endpoint({
      method: "POST", key: "scrapeTrigger.trigger", path: () => "/api/scrape-trigger/trigger",
      body: (a) => a, invalidates: ["orders"],
    }),
    getRecentRuns: endpoint({
      method: "GET", key: "scrapeTrigger.runs", path: () => "/api/scrape-trigger/runs",
    }),
    cancelScrape: endpoint({
      method: "POST", key: "scrapeTrigger.cancel", path: () => "/api/scrape-trigger/cancel",
      body: (a) => a, invalidates: ["orders"],
    }),
  },

  // Read-only mailbox connection — a DIFFERENT feature from the removed
  // proposal-SEND integration: it reads broker emails, it never sends.
  mailIngest: {
    startOAuth: endpoint({
      method: "POST", key: "mail.oauthStart", path: () => "/api/mail/oauth/start", body: (a) => a,
    }),
    syncNow: endpoint({
      method: "POST", key: "mail.sync", path: () => "/api/mail/sync",
      body: (a) => a, invalidates: ["matching", "listings", "mail.accounts"],
    }),
    inspectRecentMail: endpoint({
      method: "POST", key: "mail.inspect", path: () => "/api/mail/inspect", body: (a) => a,
    }),
    getAttachmentData: endpoint({
      method: "POST", key: "mail.attachment", path: () => "/api/mail/attachment", body: (a) => a,
    }),
    getEmailDetailsForListing: endpoint({
      method: "GET", key: "mail.listingEmail",
      path: (a) => `/api/mail/listing/${encodeURIComponent(a.listingId)}/email`,
    }),
  },

  mailIngestData: {
    availableProviders: endpoint({ method: "GET", key: "mail.providers", path: () => "/api/mail/providers" }),
    myAccounts: endpoint({ method: "GET", key: "mail.accounts", path: () => "/api/mail/accounts" }),
    disconnect: endpoint({
      method: "DELETE", key: "mail.disconnect", path: (a) => `/api/mail/accounts/${id(a)}`,
      invalidates: ["mail.accounts"],
    }),
    getIngestSettings: endpoint({ method: "GET", key: "mail.settings", path: () => "/api/mail/settings" }),
    saveIngestSettings: endpoint({
      method: "PUT", key: "mail.settings.save", path: () => "/api/mail/settings",
      body: (a) => a, invalidates: ["mail.settings"],
    }),
  },

  proposals: {
    list: endpoint({ method: "GET", key: "proposals", path: () => "/api/proposals" }),
    create: endpoint({
      method: "POST", key: "proposals.create", path: () => "/api/proposals",
      body: (a) => a, invalidates: ["proposals"],
    }),
    remove: endpoint({
      method: "DELETE", key: "proposals.remove", path: (a) => `/api/proposals/${id(a)}`,
      invalidates: ["proposals"],
    }),
  },
};
