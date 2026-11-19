-- Deal-finding score, Japanese signal reasons, and red-flag warnings on listings
alter table "listings" add column if not exists "dealScore" double precision;
alter table "listings" add column if not exists "dealSignals" jsonb;
alter table "listings" add column if not exists "dealFlags" text[];
alter table "listings" add column if not exists "dealScoredAt" bigint;

create index if not exists "listings_by_deal_score" on "listings" ("dealScore" desc nulls last);
