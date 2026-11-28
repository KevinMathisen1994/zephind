-- Items saved from the 図面の帯替え editor (right-click → 保存): a placed text box, box or image with its styling, to drag in again later.
create table if not exists "pdfItems" (
  "_id" text primary key default gen_random_uuid()::text,
  "_creationTime" double precision not null default zephind_now_ms(),
  "userId" text not null,
  "name" text not null,
  "item" jsonb not null
);

create index if not exists "pdfItems_by_user" on "pdfItems" ("userId");

alter table public."pdfItems" enable row level security;
alter table public."pdfItems" force row level security;
