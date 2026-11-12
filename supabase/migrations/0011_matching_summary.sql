-- Per-order match counts. Orders hold 20k+ matches, more than any list response
-- (PostgREST caps at 1000 rows), so counts are aggregated here instead of in the browser.
-- High score mirrors Orders.tsx matchScore: score column, else "評価: NN" in the evaluation text.
create or replace function matching_summary(p_user_id text)
returns table("orderId" text, total bigint, "new24h" bigint, "high" bigint, "new24hHigh" bigint)
language sql
stable
as $$
  with m as (
    select "orderId",
           "_creationTime" > extract(epoch from now()) * 1000 - 86400000 as fresh,
           coalesce("score", substring("evaluation" from '評価[：:\s]*(\d+)')::double precision) >= 80 as hi
      from "matching"
     where "userId" = p_user_id
  )
  select "orderId",
         count(*),
         count(*) filter (where fresh),
         count(*) filter (where hi),
         count(*) filter (where fresh and hi)
    from m
   group by "orderId";
$$;
