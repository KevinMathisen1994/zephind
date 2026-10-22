-- Add floor and elevators to listings
alter table "listings" add column if not exists "floor" double precision;
alter table "listings" add column if not exists "elevators" double precision;

create index if not exists "listings_by_floor" on "listings" ("floor");
