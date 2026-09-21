-- Per-project lot tables with exactly the same columns as public.lots.
--
-- LIKE ... INCLUDING ALL copies every column of public.lots in the same order —
-- id, lot_no, size_sqm, price_per_sqm, total (generated as size_sqm *
-- price_per_sqm), category, updated_by, last_updated, created_at, updated_at,
-- user_id, phase, status, sold_by — with the same types, defaults, NOT NULLs,
-- check constraints, identity, and indexes. The row-level security policies are
-- then copied from public.lots too.
--
-- Safe to re-run: tables and policies that already exist are left alone.
-- erhd_lots already exists, so it is not recreated here; run
-- 20260915_copy_lots_columns_to_project_lot_tables.sql to give it the columns.
CREATE TABLE IF NOT EXISTS public.eblf_lots (LIKE public.lots INCLUDING ALL);
CREATE TABLE IF NOT EXISTS public.gls_lots (LIKE public.lots INCLUDING ALL);
CREATE TABLE IF NOT EXISTS public.mscc_lots (LIKE public.lots INCLUDING ALL);

-- Row-level security and policies, matching public.lots.
DO $$
DECLARE
  target text;
  pol record;
BEGIN
  FOREACH target IN ARRAY ARRAY['eblf_lots', 'gls_lots', 'mscc_lots']
  LOOP
    IF (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.lots'::regclass) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', target);
    END IF;

    FOR pol IN
      SELECT * FROM pg_policies WHERE schemaname = 'public' AND tablename = 'lots'
    LOOP
      CONTINUE WHEN EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = target AND policyname = pol.policyname
      );

      EXECUTE format(
        'CREATE POLICY %I ON public.%I AS %s FOR %s TO %s%s%s',
        pol.policyname,
        target,
        pol.permissive,
        pol.cmd,
        (SELECT string_agg(CASE WHEN role = 'public' THEN 'public' ELSE quote_ident(role) END, ', ')
         FROM unnest(pol.roles) AS role),
        COALESCE(' USING (' || pol.qual || ')', ''),
        COALESCE(' WITH CHECK (' || pol.with_check || ')', '')
      );
      RAISE NOTICE 'Added policy "%" to %', pol.policyname, target;
    END LOOP;
  END LOOP;
END $$;

-- Make the new tables visible to the API immediately.
NOTIFY pgrst, 'reload schema';
