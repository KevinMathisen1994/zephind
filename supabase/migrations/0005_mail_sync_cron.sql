-- Mail sync + server evaluation every 15 minutes, calling the `api` Edge Function (replaces the
-- Node server's setInterval in scraper-service/src/jobs/cron.ts).
-- Needs two Vault secrets, created once by hand so they stay out of git:
--   select vault.create_secret('https://<ref>.supabase.co/functions/v1', 'api_url');
--   select vault.create_secret('<SCRAPER_INGEST_SECRET>', 'ingest_secret');
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'background',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'api_url') || '/api/ingest/background',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-ingest-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'ingest_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000
  );
  $$
);
