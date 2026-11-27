-- One match per (order, listing). The scrape's duplicate check missed rows past PostgREST's
-- 1000-row cap and inserted the same pair on every run (33,155 duplicates, removed 2026-11-27;
-- copies kept in matching_duplicates_backup_20261127). Apply together with the code that
-- inserts through db.insertMatches, which skips existing pairs instead of failing.
create unique index if not exists "matching_order_listing_unique" on "matching" ("orderId", "listingId");
