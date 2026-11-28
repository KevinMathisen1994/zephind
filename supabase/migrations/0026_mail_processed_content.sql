-- Store what the sync read from each message so the inspector reads the DB instead of Gmail.
alter table "mailProcessed" add column if not exists "subject" text;
alter table "mailProcessed" add column if not exists "from" text;
alter table "mailProcessed" add column if not exists "receivedAt" bigint;
alter table "mailProcessed" add column if not exists "bodyText" text;
alter table "mailProcessed" add column if not exists "attachments" jsonb;
alter table "mailProcessed" add column if not exists "pdfTexts" text[];
-- 'listings' | 'none' | 'filtered'. NULL = processed before this migration (no content yet).
alter table "mailProcessed" add column if not exists "verdict" text;
alter table "mailProcessed" add column if not exists "reason" text;
alter table "mailProcessed" add column if not exists "engine" text;
alter table "mailProcessed" add column if not exists "listings" jsonb;

-- Message ids are only unique per mailbox; two users sharing a mailbox must not share rows.
alter table "mailProcessed" drop constraint if exists "mailProcessed_pkey";
alter table "mailProcessed" add primary key ("userId", "provider", "messageId");

create index if not exists "mailProcessed_by_user_received" on "mailProcessed" ("userId", "receivedAt" desc);
