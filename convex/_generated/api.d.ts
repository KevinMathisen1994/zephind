/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as evaluate from "../evaluate.js";
import type * as evaluateGH from "../evaluateGH.js";
import type * as evaluateGemini from "../evaluateGemini.js";
import type * as evaluateGroq from "../evaluateGroq.js";
import type * as http from "../http.js";
import type * as listings from "../listings.js";
import type * as matching from "../matching.js";
import type * as orders from "../orders.js";
import type * as properties from "../properties.js";
import type * as proposals from "../proposals.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  evaluate: typeof evaluate;
  evaluateGH: typeof evaluateGH;
  evaluateGemini: typeof evaluateGemini;
  evaluateGroq: typeof evaluateGroq;
  http: typeof http;
  listings: typeof listings;
  matching: typeof matching;
  orders: typeof orders;
  properties: typeof properties;
  proposals: typeof proposals;
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
