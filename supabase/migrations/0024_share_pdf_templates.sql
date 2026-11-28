-- Shared 図面の帯替え images and signatures show up for every user; only the owner can edit or delete them.
alter table "pdfImages" add column if not exists "shared" boolean not null default false;
alter table "pdfSignatures" add column if not exists "shared" boolean not null default false;

create index if not exists "pdfImages_shared" on "pdfImages" ("shared") where "shared";
create index if not exists "pdfSignatures_shared" on "pdfSignatures" ("shared") where "shared";

-- The templates saved before sharing existed were made for everyone.
update "pdfImages" set "shared" = true;
update "pdfSignatures" set "shared" = true;
