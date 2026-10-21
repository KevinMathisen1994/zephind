-- Clears out a previous, unrelated app that shared this database (a jobs /
-- salary tool). Confirmed empty before dropping except `profiles`, which held
-- one Supabase Auth profile row.
--
-- Numbered 0000 so it runs before 0001 creates the Zephind schema.
--
-- CASCADE because `profiles` is the usual target of an auth.users insert
-- trigger; without it the drop fails on the dependency, and leaving the trigger
-- behind would error on the next sign-up.
drop table if exists public.saved_jobs cascade;
drop table if exists public.job_listings_cache cascade;
drop table if exists public.ssyk_salary_cache cascade;
drop table if exists public.ssyk_codes cascade;
drop table if exists public.profiles cascade;
