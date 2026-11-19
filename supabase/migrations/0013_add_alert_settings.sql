-- Alert settings table for automated LINE, Webhook and Email alerts on hot matches
create table if not exists "alertSettings" (
  "_id" text primary key default gen_random_uuid()::text,
  "_creationTime" double precision not null default zephind_now_ms(),
  "userId" text not null,
  "webhookUrl" text,
  "emailAddress" text,
  "minScore" integer default 80,
  "notifyHighScores" boolean default true,
  "notifyPriceDrops" boolean default true,
  "enabled" boolean default true,
  "updatedAt" bigint
);

create index if not exists "alertSettings_by_user" on "alertSettings" ("userId");
