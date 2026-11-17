-- Add sources column to orders table for website-specific scraping preferences
alter table "orders" add column if not exists "sources" text[];
