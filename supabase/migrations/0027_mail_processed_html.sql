-- Original HTML body, so the mail page can show the email as it was laid out (rendered sandboxed).
alter table "mailProcessed" add column if not exists "bodyHtml" text;
