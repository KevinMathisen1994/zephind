-- Email-ingested listings belong to the mailbox owner; scraped listings stay shared (userId null).
alter table "listings" add column if not exists "userId" text;
create index if not exists listings_user_id_idx on "listings" ("userId");

-- Mail sync used to match every user's orders, so email matches may belong to the wrong user.
-- Owners recreate theirs with 「今すぐ同期」, which also stamps userId on the existing listing rows.
delete from "matching"
where "listingId" in (select "_id" from "listings" where "source" = 'email');
