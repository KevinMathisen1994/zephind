-- Operations that were a single Convex mutation (and therefore atomic) and
-- would otherwise become several round trips the caller could fail halfway
-- through.

/**
 * Deletes an order, its matches, and any listing left with no other match.
 *
 * `listings` is shared, unscoped inventory: the same scraped property can match
 * several orders, so a listing is only removed once THIS order held the last
 * reference to it. Ownership is checked by the caller before this runs.
 */
create or replace function delete_order(p_order_id text)
returns void
language plpgsql
as $$
declare
  v_listing_ids text[];
begin
  select coalesce(array_agg(distinct "listingId"), '{}')
    into v_listing_ids
    from "matching"
   where "orderId" = p_order_id and "listingId" is not null;

  delete from "matching" where "orderId" = p_order_id;

  delete from "listings"
   where "_id" = any(v_listing_ids)
     and not exists (select 1 from "matching" m where m."listingId" = "listings"."_id");

  delete from "orders" where "_id" = p_order_id;
end $$;

/**
 * Upserts a listing by url (the scrape dedup key) and returns its id.
 * Convex did read-then-insert inside one transaction; two concurrent scrape
 * runs doing that over HTTP would both miss and both insert.
 */
create unique index if not exists "listings_url_unique" on "listings" ("url") where "url" is not null;
