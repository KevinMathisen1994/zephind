-- LINE Messaging API: each account links its own LINE by sending a one-time code to the Zephind bot.
-- Unused for now: the LINE code was removed (LINE blocks Official Account creation for EU/EEA-region accounts). Kept because it is applied in production.
alter table "alertSettings" add column if not exists "lineUserId" text;
alter table "alertSettings" add column if not exists "lineLinkCode" text;
alter table "alertSettings" add column if not exists "lineLinkCodeAt" bigint;

create index if not exists "alertSettings_by_line_code" on "alertSettings" ("lineLinkCode");
