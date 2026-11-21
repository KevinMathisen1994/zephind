-- Sign-in allowlist managed from the admin page. Empty table = not enforced.
create table if not exists "allowedEmails" (
  "_id" text primary key default gen_random_uuid()::text,
  "_creationTime" double precision not null default zephind_now_ms(),
  "email" text not null unique,
  "addedBy" text
);

alter table public."allowedEmails" enable row level security;
alter table public."allowedEmails" force row level security;

-- Connector keys remember their owner's email so a removed user's keys stop working too.
alter table "mcpKeys" add column if not exists "email" text;
