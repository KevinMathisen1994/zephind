-- Live scrape progress per order: { runId, shards: { "<i>": { done, total, globalTotal, active, startedAt, updatedAt, finished } } }.
-- Each GitHub matrix shard writes its own key; a new runId replaces the old run's object.
alter table "orders" add column if not exists "scrapeProgress" jsonb;

-- One statement so concurrent shards never overwrite each other's key.
create or replace function merge_scrape_progress(p_order_id text, p_run_id text, p_shard text, p_data jsonb)
returns void
language sql
as $$
  update "orders"
     set "scrapeProgress" = case
       when "scrapeProgress"->>'runId' = p_run_id
         then jsonb_set("scrapeProgress", array['shards', p_shard], p_data)
       else jsonb_build_object('runId', p_run_id, 'shards', jsonb_build_object(p_shard, p_data))
     end
   where "_id" = p_order_id;
$$;
