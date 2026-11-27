-- Saved 帯 signatures for 図面の帯替え; the browser renders them to an image from these fields.
create table if not exists "pdfSignatures" (
  "_id" text primary key default gen_random_uuid()::text,
  "_creationTime" double precision not null default zephind_now_ms(),
  "userId" text not null,
  "name" text not null,
  "fields" jsonb not null
);

create index if not exists "pdfSignatures_by_user" on "pdfSignatures" ("userId");

alter table public."pdfSignatures" enable row level security;
alter table public."pdfSignatures" force row level security;
