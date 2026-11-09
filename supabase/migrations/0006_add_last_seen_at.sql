-- Epoch ms of the last scrape that saw this listing; used to hide ended listings.
alter table "listings" add column if not exists "lastSeenAt" bigint;
-- Existing rows get a fresh clock so they are not all hidden on deploy.
update "listings" set "lastSeenAt" = (extract(epoch from now()) * 1000)::bigint where "lastSeenAt" is null;
