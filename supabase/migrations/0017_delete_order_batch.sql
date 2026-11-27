-- delete_order cascaded every match in one statement; an order with 85k matches
-- hit the statement timeout. This deletes one batch per call (each its own
-- transaction, so no orphans if a later batch fails) and removes the order row
-- once no matches remain. Returns matches deleted; the caller loops until 0.
create or replace function delete_order_batch(p_order_id text, p_limit int default 5000)
returns int
language plpgsql
as $$
declare
  v_listing_ids text[];
  v_n int;
begin
  with gone as (
    delete from "matching"
     where "_id" in (select "_id" from "matching" where "orderId" = p_order_id limit p_limit)
    returning "listingId"
  )
  select coalesce(array_agg(distinct "listingId") filter (where "listingId" is not null), '{}'), count(*)
    into v_listing_ids, v_n
    from gone;

  delete from "listings"
   where "_id" = any(v_listing_ids)
     and not exists (select 1 from "matching" m where m."listingId" = "listings"."_id");

  if v_n = 0 then
    delete from "orders" where "_id" = p_order_id;
  end if;
  return v_n;
end $$;
