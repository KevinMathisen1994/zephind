-- Daily email with a PDF of new listings per order, sent after the first scheduled scrape of the day (JST).
alter table "alertSettings" add column if not exists "dailyDigest" boolean default false;
-- When the last digest went out; also the cutoff for "new" in the next one.
alter table "alertSettings" add column if not exists "lastDigestAt" bigint;
