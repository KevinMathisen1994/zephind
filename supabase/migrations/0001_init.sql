-- Zephind schema, ported from convex/schema.js.
--
-- Naming: tables and columns keep the exact camelCase identifiers Convex used,
-- and every row carries `_id` / `_creationTime`. That is deliberately
-- unidiomatic SQL. It means a supabase-js row is shape-identical to a Convex
-- document, so ~7k lines of ported backend and all frontend render code work
-- unchanged. Every hand-written SQL statement must double-quote identifiers.
--
-- `_id` is text, not uuid, so Convex's opaque ids survive a data import
-- alongside uuids minted from here on.

create extension if not exists pgcrypto;

-- Epoch ms as a float. Convex's _creationTime carries sub-millisecond precision
-- (every exported row has a fractional part), so the column it defaults into is
-- double precision, not bigint — rounding would change stored values on import.
create or replace function zephind_now_ms() returns double precision
  language sql stable as $$ select extract(epoch from now()) * 1000 $$;

-- listings ---------------------------------------------------------------
create table "listings" (
  "_id" text primary key default gen_random_uuid()::text,
  "_creationTime" double precision not null default zephind_now_ms(),
  "address" text,
  "ward" text,
  "price" double precision,
  "area" double precision,
  "landSize" double precision,
  "buildYear" integer,
  "source" text,
  "status" text,
  "url" text,
  "description" text,
  "rooms" double precision,
  "layout" text,
  "station" text,
  "stationName" text,
  "walkMinutes" double precision,
  "walkingMinutes" double precision,
  "mlitBenchmark" double precision,
  "score" double precision,
  "latitude" double precision,
  "longitude" double precision,
  "title" text,
  "images" text[],
  "buildingCoverageRatio" double precision,
  "floorAreaRatio" double precision,
  "propertyType" text,
  "roadWidth" double precision,
  "frontage" double precision,
  "zoning" text,
  "pdfUrl" text,
  "yield" double precision,
  "structure" text,
  "structureType" text,
  "totalUnits" double precision,
  "postedAt" bigint,
  "postedDateKind" text,
  "isNew" boolean,
  "dealType" text,
  "rent" double precision,
  "managementFee" double precision,
  "deposit" double precision,
  "keyMoney" double precision,
  "petsAllowed" boolean,
  "emailFrom" text,
  "emailReceivedAt" bigint,
  "emailSubject" text,
  "emailBody" text,
  "emailAttachments" jsonb
);
create index "listings_by_ward" on "listings" ("ward");
create index "listings_by_price" on "listings" ("price");
create index "listings_by_source" on "listings" ("source");
-- Every scrape run dedupes by url; without this it is a seq scan per listing.
create index "listings_by_url" on "listings" ("url");
create index "listings_by_postedAt" on "listings" ("postedAt");

-- orders -----------------------------------------------------------------
create table "orders" (
  "_id" text primary key default gen_random_uuid()::text,
  "_creationTime" double precision not null default zephind_now_ms(),
  "name" text,
  "ward" text,
  "wards" text[],
  "dealType" text,
  "priceMin" double precision,
  "priceMax" double precision,
  "rentMin" double precision,
  "rentMax" double precision,
  "maxDeposit" double precision,
  "maxKeyMoney" double precision,
  "petsRequired" boolean,
  "areaMin" double precision,
  "areaMax" double precision,
  "status" text,
  "userId" text,
  "criteria" jsonb,
  "walkMinutes" double precision,
  "minBuildingCoverageRatio" double precision,
  "minFloorAreaRatio" double precision,
  "propertyTypes" text[],
  "ownerChange" boolean,
  "landSizeMin" double precision,
  "landSizeMax" double precision,
  "buildingSizeMin" double precision,
  "buildingSizeMax" double precision,
  "maxBuildAge" double precision,
  "minBuildYear" integer,
  "minYield" double precision,
  "maxYield" double precision,
  "minRoadWidth" double precision,
  "minTotalUnits" double precision,
  "maxFloor" double precision,
  "excludeFirstFloor" boolean,
  "minElevators" double precision,
  "structureTypes" text[],
  "layoutTypes" text[],
  "customerId" text,
  "isScraping" boolean,
  "scrapingStatus" text,
  "activeSource" text,
  "scrapeRunId" double precision,
  "lastScrapeAt" bigint,
  "lastScrapeBy" text
);
create index "orders_by_status" on "orders" ("status");
create index "orders_by_user" on "orders" ("userId");

-- properties -------------------------------------------------------------
create table "properties" (
  "_id" text primary key default gen_random_uuid()::text,
  "_creationTime" double precision not null default zephind_now_ms(),
  "userId" text,
  "address" text,
  "ward" text,
  "price" double precision,
  "area" double precision,
  "landSize" double precision,
  "buildYear" integer,
  "mlitBenchmark" double precision,
  "score" double precision,
  "listingId" text,
  "source" text,
  "status" text,
  "enrichedAt" bigint,
  "title" text,
  "description" text,
  "sourceUrl" text,
  "images" text[],
  "latitude" double precision,
  "longitude" double precision,
  "stationName" text,
  "walkingMinutes" double precision,
  "buildingCoverageRatio" double precision,
  "floorAreaRatio" double precision,
  "roadWidth" double precision,
  "frontage" double precision,
  "hotelsCount" double precision,
  "attractionsCount" double precision,
  "restaurantsCount" double precision,
  "inboundScore" double precision,
  "inboundStars" double precision,
  "hardFiltersPassed" boolean,
  "isMatch" boolean,
  "createdAt" bigint,
  "updatedAt" bigint,
  "aiRecommendation" text,
  "aiSummary" text,
  "aiStrengths" text[],
  "aiWeaknesses" text[],
  "discountPercent" double precision,
  "expectedMarketValue" double precision
);
create index "properties_by_ward" on "properties" ("ward");
create index "properties_by_score" on "properties" ("score");
create index "properties_by_user" on "properties" ("userId");

-- proposals --------------------------------------------------------------
create table "proposals" (
  "_id" text primary key default gen_random_uuid()::text,
  "_creationTime" double precision not null default zephind_now_ms(),
  "propertyId" text,
  "orderId" text,
  "status" text,
  "score" double precision,
  "notes" text,
  "userId" text
);
create index "proposals_by_status" on "proposals" ("status");
create index "proposals_by_user" on "proposals" ("userId");

-- users ------------------------------------------------------------------
create table "users" (
  "_id" text primary key default gen_random_uuid()::text,
  "_creationTime" double precision not null default zephind_now_ms(),
  "clerkId" text,
  "email" text,
  "name" text,
  "role" text
);
create index "users_by_clerkId" on "users" ("clerkId");

-- savedSearches ----------------------------------------------------------
create table "savedSearches" (
  "_id" text primary key default gen_random_uuid()::text,
  "_creationTime" double precision not null default zephind_now_ms(),
  "userId" text,
  "name" text,
  "criteria" jsonb,
  "createdAt" bigint,
  "maxLandSize" double precision,
  "maxPrice" double precision,
  "maxWalkingMinutes" double precision,
  "minFrontage" double precision,
  "minInboundStars" double precision,
  "minLandSize" double precision,
  "minPrice" double precision,
  "minRoadWidth" double precision,
  "wards" text[]
);
create index "savedSearches_by_user" on "savedSearches" ("userId");

-- historicalData ---------------------------------------------------------
create table "historicalData" (
  "_id" text primary key default gen_random_uuid()::text,
  "_creationTime" double precision not null default zephind_now_ms(),
  "ward" text,
  "year" integer,
  "quarter" integer,
  "avgPrice" double precision,
  "avgArea" double precision,
  "transactionCount" double precision,
  "comparables" jsonb,
  "fetchedAt" bigint
);
create index "historicalData_by_ward_year" on "historicalData" ("ward", "year");

-- placesCache ------------------------------------------------------------
create table "placesCache" (
  "_id" text primary key default gen_random_uuid()::text,
  "_creationTime" double precision not null default zephind_now_ms(),
  "address" text not null,
  "nearbyTotalCount" double precision,
  "nearbyInfo" text,
  "fetchedAt" bigint not null
);
create index "placesCache_by_address" on "placesCache" ("address");

-- criteria ---------------------------------------------------------------
create table "criteria" (
  "_id" text primary key default gen_random_uuid()::text,
  "_creationTime" double precision not null default zephind_now_ms(),
  "orderId" text,
  "userId" text,
  "criteria" jsonb
);
create index "criteria_by_order" on "criteria" ("orderId");
create index "criteria_by_user" on "criteria" ("userId");

-- evaluations ------------------------------------------------------------
create table "evaluations" (
  "_id" text primary key default gen_random_uuid()::text,
  "_creationTime" double precision not null default zephind_now_ms(),
  "propertyId" text,
  "orderId" text,
  "score" double precision,
  "breakdown" jsonb,
  "userId" text,
  "createdAt" bigint,
  "recommendation" text,
  "strengths" text[],
  "summary" text,
  "weaknesses" text[]
);
create index "evaluations_by_property" on "evaluations" ("propertyId");

-- enrichment -------------------------------------------------------------
create table "enrichment" (
  "_id" text primary key default gen_random_uuid()::text,
  "_creationTime" double precision not null default zephind_now_ms(),
  "propertyId" text,
  "data" jsonb,
  "source" text,
  "enrichedAt" bigint
);
create index "enrichment_by_property" on "enrichment" ("propertyId");

-- market -----------------------------------------------------------------
create table "market" (
  "_id" text primary key default gen_random_uuid()::text,
  "_creationTime" double precision not null default zephind_now_ms(),
  "ward" text,
  "data" jsonb,
  "period" text
);
create index "market_by_ward" on "market" ("ward");

-- matching ---------------------------------------------------------------
create table "matching" (
  "_id" text primary key default gen_random_uuid()::text,
  "_creationTime" double precision not null default zephind_now_ms(),
  "userId" text,
  "orderId" text,
  "listingId" text,
  "score" double precision,
  "status" text,
  "evaluation" text,
  "scoreDetail" jsonb
);
create index "matching_by_order" on "matching" ("orderId");
create index "matching_by_user" on "matching" ("userId");
-- Order deletion asks "does any OTHER order still match this listing".
create index "matching_by_listing" on "matching" ("listingId");

-- propertySources --------------------------------------------------------
create table "propertySources" (
  "_id" text primary key default gen_random_uuid()::text,
  "_creationTime" double precision not null default zephind_now_ms(),
  "name" text,
  "url" text,
  "type" text,
  "lastScraped" bigint,
  "lastScrapeTime" bigint,
  "failures" double precision,
  "newListingsFound" double precision,
  "status" text
);

-- tourism ----------------------------------------------------------------
create table "tourism" (
  "_id" text primary key default gen_random_uuid()::text,
  "_creationTime" double precision not null default zephind_now_ms(),
  "ward" text,
  "data" jsonb
);

-- mlitEnrichment ---------------------------------------------------------
create table "mlitEnrichment" (
  "_id" text primary key default gen_random_uuid()::text,
  "_creationTime" double precision not null default zephind_now_ms(),
  "propertyId" text,
  "data" jsonb,
  "source" text
);

-- ingestEvents -----------------------------------------------------------
create table "ingestEvents" (
  "_id" text primary key default gen_random_uuid()::text,
  "_creationTime" double precision not null default zephind_now_ms(),
  "type" text,
  "data" jsonb,
  "processedAt" bigint
);

-- customers --------------------------------------------------------------
create table "customers" (
  "_id" text primary key default gen_random_uuid()::text,
  "_creationTime" double precision not null default zephind_now_ms(),
  "userId" text,
  "name" text not null,
  "email" text,
  "phone" text,
  "company" text,
  "address" text,
  "notes" text,
  "createdAt" bigint
);
create index "customers_by_name" on "customers" ("name");
create index "customers_by_user" on "customers" ("userId");

-- deals ------------------------------------------------------------------
create table "deals" (
  "_id" text primary key default gen_random_uuid()::text,
  "_creationTime" double precision not null default zephind_now_ms(),
  "userId" text,
  "title" text not null,
  "customerId" text,
  "customerName" text,
  "customerEmail" text,
  "customerPhone" text,
  "orderId" text,
  "orderName" text,
  "listings" jsonb,
  "customMessage" text,
  "status" text,
  "createdAt" bigint,
  "updatedAt" bigint
);
create index "deals_by_status" on "deals" ("status");
create index "deals_by_customer" on "deals" ("customerId");
create index "deals_by_user" on "deals" ("userId");

-- savedListings ----------------------------------------------------------
-- Stores a SNAPSHOT of the displayed fields, not just listingId: a starred
-- property must survive deletion of the order that surfaced it.
create table "savedListings" (
  "_id" text primary key default gen_random_uuid()::text,
  "_creationTime" double precision not null default zephind_now_ms(),
  "userId" text,
  "listingId" text,
  "orderId" text,
  "orderName" text,
  "note" text,
  "savedAt" bigint,
  "address" text,
  "ward" text,
  "price" double precision,
  "area" double precision,
  "landSize" double precision,
  "source" text,
  "url" text,
  "propertyType" text,
  "station" text,
  "walkMinutes" double precision,
  "score" double precision,
  "postedAt" bigint,
  "postedDateKind" text
);
create index "savedListings_by_user" on "savedListings" ("userId");
create index "savedListings_by_user_and_listing" on "savedListings" ("userId", "listingId");

-- emailSettings ----------------------------------------------------------
create table "emailSettings" (
  "_id" text primary key default gen_random_uuid()::text,
  "_creationTime" double precision not null default zephind_now_ms(),
  "userId" text,
  "signature" text,
  "updatedAt" bigint
);
create index "emailSettings_by_user" on "emailSettings" ("userId");

-- mailAccounts -----------------------------------------------------------
-- Holds live OAuth credentials. Never returned to the browser.
create table "mailAccounts" (
  "_id" text primary key default gen_random_uuid()::text,
  "_creationTime" double precision not null default zephind_now_ms(),
  "userId" text,
  "provider" text,
  "email" text,
  "accessToken" text,
  "refreshToken" text,
  "expiresAt" bigint,
  "scope" text,
  "connectedAt" bigint,
  "needsReconnect" boolean,
  "lastError" text,
  "syncCursor" text,
  "lastSyncedAt" bigint
);
create index "mailAccounts_by_user" on "mailAccounts" ("userId");
create index "mailAccounts_by_user_and_provider" on "mailAccounts" ("userId", "provider");

-- mailIngestSettings -----------------------------------------------------
create table "mailIngestSettings" (
  "_id" text primary key default gen_random_uuid()::text,
  "_creationTime" double precision not null default zephind_now_ms(),
  "userId" text,
  "requiredKeywords" text[],
  "blockedKeywords" text[],
  "allowedSenders" text[],
  "blockedSenders" text[],
  "requireAttachment" boolean,
  "updatedAt" bigint
);
create index "mailIngestSettings_by_user" on "mailIngestSettings" ("userId");

-- oauthStates ------------------------------------------------------------
-- Single-use CSRF state: the provider redirects the BROWSER to our callback,
-- which carries no Clerk session, so this row is the only link back to who is
-- connecting.
create table "oauthStates" (
  "_id" text primary key default gen_random_uuid()::text,
  "_creationTime" double precision not null default zephind_now_ms(),
  "state" text,
  "userId" text,
  "provider" text,
  "redirectTo" text,
  "expiresAt" bigint
);
create index "oauthStates_by_state" on "oauthStates" ("state");

-- scraperHealth ----------------------------------------------------------
create table "scraperHealth" (
  "_id" text primary key default gen_random_uuid()::text,
  "_creationTime" double precision not null default zephind_now_ms(),
  "source" text not null,
  "label" text,
  "status" text not null,
  "listingCount" double precision,
  "durationMs" double precision,
  "areaCode" text,
  "checkedAt" bigint not null,
  "issues" text[],
  "coverage" jsonb,
  "sample" jsonb,
  "error" text
);
create index "scraperHealth_by_source" on "scraperHealth" ("source");

-- Access control ---------------------------------------------------------
-- Nothing but the backend (service role, which bypasses RLS) touches these
-- tables. RLS on with zero policies means anon/authenticated keys read nothing,
-- so a leaked publishable key is inert.
do $$
declare t text;
begin
  -- Named explicitly, not "every table in public": this statement must never
  -- switch RLS on for a table this migration did not create.
  for t in select unnest(array[
    'listings','orders','properties','proposals','users','savedSearches',
    'historicalData','placesCache','criteria','evaluations','enrichment',
    'market','matching','propertySources','tourism','mlitEnrichment',
    'ingestEvents','customers','deals','savedListings','emailSettings',
    'mailAccounts','mailIngestSettings','oauthStates','scraperHealth'
  ])
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
  end loop;
end $$;
