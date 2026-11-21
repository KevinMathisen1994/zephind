-- Per-user keys for the Claude connector (/api/mcp/<key>). Only the sha256 hash is stored.
create table if not exists "mcpKeys" (
  "_id" text primary key default gen_random_uuid()::text,
  "_creationTime" double precision not null default zephind_now_ms(),
  "userId" text not null,
  "label" text,
  "keyHash" text not null unique,
  "keyPrefix" text,
  "lastUsedAt" bigint
);

create index if not exists "mcpKeys_by_user" on "mcpKeys" ("userId");

alter table public."mcpKeys" enable row level security;
alter table public."mcpKeys" force row level security;
