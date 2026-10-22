-- Track price changes and price drops
alter table "listings" add column if not exists "previousPrice" double precision;
alter table "listings" add column if not exists "initialPrice" double precision;
alter table "listings" add column if not exists "priceDropPct" double precision;
alter table "listings" add column if not exists "priceDropped" boolean default false;
alter table "listings" add column if not exists "priceChangedAt" bigint;

create index if not exists "listings_by_price_dropped" on "listings" ("priceDropped");
