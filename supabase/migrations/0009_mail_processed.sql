-- Messages the mail sync already ran extraction on, so re-syncs do not pay the AI again.
create table if not exists "mailProcessed" (
  "provider" text not null,
  "messageId" text not null,
  "userId" text not null,
  "processedAt" bigint not null,
  primary key ("provider", "messageId")
);
alter table public."mailProcessed" enable row level security;
alter table public."mailProcessed" force row level security;
