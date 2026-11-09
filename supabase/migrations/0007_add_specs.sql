-- Full label/value spec table scraped from a listing's detail page
-- (マンション名, 管理費, 修繕積立金, 向き, 土地権利, ...).
alter table "listings" add column if not exists "specs" jsonb;
