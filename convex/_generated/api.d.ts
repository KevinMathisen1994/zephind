/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as adminMaintenance from "../adminMaintenance.js";
import type * as customers from "../customers.js";
import type * as deals from "../deals.js";
import type * as evaluate from "../evaluate.js";
import type * as evaluateGH from "../evaluateGH.js";
import type * as evaluateGemini from "../evaluateGemini.js";
import type * as evaluateGroq from "../evaluateGroq.js";
import type * as http from "../http.js";
import type * as ingest from "../ingest.js";
import type * as lib_authz from "../lib/authz.js";
import type * as lib_scoring from "../lib/scoring.js";
import type * as listings from "../listings.js";
import type * as matching from "../matching.js";
import type * as orders from "../orders.js";
import type * as properties from "../properties.js";
import type * as proposals from "../proposals.js";
import type * as scrapeTrigger from "../scrapeTrigger.js";
import type * as scraperHealth from "../scraperHealth.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  adminMaintenance: typeof adminMaintenance;
  customers: typeof customers;
  deals: typeof deals;
  evaluate: typeof evaluate;
  evaluateGH: typeof evaluateGH;
  evaluateGemini: typeof evaluateGemini;
  evaluateGroq: typeof evaluateGroq;
  http: typeof http;
  ingest: typeof ingest;
  "lib/authz": typeof lib_authz;
  "lib/scoring": typeof lib_scoring;
  listings: typeof listings;
  matching: typeof matching;
  orders: typeof orders;
  properties: typeof properties;
  proposals: typeof proposals;
  scrapeTrigger: typeof scrapeTrigger;
  scraperHealth: typeof scraperHealth;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
