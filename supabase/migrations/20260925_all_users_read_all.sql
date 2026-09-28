-- Every signed-in user can read every row.
--
-- Tables made in the dashboard (projects, lots and the per-project lot tables,
-- uploads, the price tables, ...) only let a user read the rows they created,
-- so each person saw a different, partial portal. This adds one read policy per
-- table: any authenticated user may SELECT any row.
--
-- Postgres ORs permissive policies together, so this only widens reading.
-- Insert, update, and delete rules are not touched. Signed-out visitors (anon)
-- get nothing new.
--
-- Covers every table in `public` that has row-level security on, including
-- `profiles` — everyone signed in can then see every user's profile. Safe to
-- run again; run it again after creating a new table.

DO $$
DECLARE
  target record;
BEGIN
  FOR target IN
    SELECT c.relname AS tbl
    FROM pg_class c
    WHERE c.relnamespace = 'public'::regnamespace
      AND c.relkind IN ('r', 'p')
      AND c.relrowsecurity
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS authenticated_read_all ON public.%I', target.tbl);
    EXECUTE format('CREATE POLICY authenticated_read_all ON public.%I FOR SELECT TO authenticated USING (true)', target.tbl);
  END LOOP;
END $$;

-- Check 1: every RLS table should now list authenticated_read_all.
SELECT c.relname AS table_name,
       EXISTS (
         SELECT 1 FROM pg_policies p
         WHERE p.schemaname = 'public' AND p.tablename = c.relname AND p.policyname = 'authenticated_read_all'
       ) AS everyone_can_read
FROM pg_class c
WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p') AND c.relrowsecurity
ORDER BY 1;

-- Check 2: a RESTRICTIVE read policy still narrows what is seen, whatever is
-- added above. Any row here needs a look.
SELECT tablename, policyname, qual
FROM pg_policies
WHERE schemaname = 'public' AND permissive = 'RESTRICTIVE' AND cmd IN ('SELECT', 'ALL');
