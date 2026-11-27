-- Per-order 自動検索の頻度: "3" | "2" | "1" | "off" times per day. NULL = every scheduled sweep (3x/day).
alter table "orders" add column if not exists "autoScrape" text;
