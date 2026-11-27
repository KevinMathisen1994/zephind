-- Saved images (company logos etc.) for 図面の帯替え. Stored as data URLs so the browser can draw them on the export canvas without CORS.
create table if not exists "pdfImages" (
  "_id" text primary key default gen_random_uuid()::text,
  "_creationTime" double precision not null default zephind_now_ms(),
  "userId" text not null,
  "name" text not null,
  "src" text not null,
  "w" integer not null,
  "h" integer not null
);

create index if not exists "pdfImages_by_user" on "pdfImages" ("userId");

alter table public."pdfImages" enable row level security;
alter table public."pdfImages" force row level security;
