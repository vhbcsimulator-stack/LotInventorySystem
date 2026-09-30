-- Four more projects for the portal: RHN, RHM, LCN, and MCVC.
--
-- 1. A row in public.projects for each, so the project switcher lists it. The
--    name starts as the code; rename it in the Table Editor (the portal shows
--    `name` where it has one).
-- 2. A lot table for each (rhn_lots, rhm_lots, lcn_lots, mcvc_lots) with exactly
--    the columns of public.lots — LIKE ... INCLUDING ALL copies every column,
--    including the later ones (sold_by, reserve_type, reserved_for, payment_type,
--    contract_type, last_updated_precision) — plus its row-level security.
-- 3. The same shared-edit policies as 20260926_all_users_edit_portal_data.sql,
--    so every signed-in user can add, change, and delete their lots.
-- 4. A public map bucket for each (named after the lowercase code, as for the
--    other projects) and the storage policies extended to cover them.
--
-- These match src/data/projectsData.js (LOT_TABLES). Safe to re-run: anything
-- that already exists is left alone. Run once in the Supabase SQL Editor.

-- 1. Projects
INSERT INTO public.projects (code, name)
SELECT v.code, v.code
FROM (VALUES ('RHN'), ('RHM'), ('LCN'), ('MCVC')) AS v(code)
WHERE NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.code = v.code);

-- 2. Lot tables
CREATE TABLE IF NOT EXISTS public.rhn_lots (LIKE public.lots INCLUDING ALL);
CREATE TABLE IF NOT EXISTS public.rhm_lots (LIKE public.lots INCLUDING ALL);
CREATE TABLE IF NOT EXISTS public.lcn_lots (LIKE public.lots INCLUDING ALL);
CREATE TABLE IF NOT EXISTS public.mcvc_lots (LIKE public.lots INCLUDING ALL);

DO $$
DECLARE
  target text;
  pol record;
BEGIN
  FOREACH target IN ARRAY ARRAY['rhn_lots', 'rhm_lots', 'lcn_lots', 'mcvc_lots']
  LOOP
    -- Row-level security and policies, matching public.lots.
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

    -- 3. Shared editing, as for the other lot tables.
    EXECUTE format('DROP POLICY IF EXISTS authenticated_insert_all ON public.%I', target);
    EXECUTE format('DROP POLICY IF EXISTS authenticated_update_all ON public.%I', target);
    EXECUTE format('DROP POLICY IF EXISTS authenticated_delete_all ON public.%I', target);
    EXECUTE format('CREATE POLICY authenticated_insert_all ON public.%I FOR INSERT TO authenticated WITH CHECK (true)', target);
    EXECUTE format('CREATE POLICY authenticated_update_all ON public.%I FOR UPDATE TO authenticated USING (true) WITH CHECK (true)', target);
    EXECUTE format('CREATE POLICY authenticated_delete_all ON public.%I FOR DELETE TO authenticated USING (true)', target);
  END LOOP;
END $$;

-- 4. Map buckets and the storage policies, now listing every project's bucket.
INSERT INTO storage.buckets (id, name, public)
VALUES ('rhn', 'rhn', true), ('rhm', 'rhm', true), ('lcn', 'lcn', true), ('mcvc', 'mcvc', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "portal_files_read" ON storage.objects;
CREATE POLICY "portal_files_read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id IN ('mvlc', 'eblf', 'erhd', 'gls', 'mscc', 'rhn', 'rhm', 'lcn', 'mcvc', 'project_deve_updates', 'future_dev'));

DROP POLICY IF EXISTS "portal_files_insert" ON storage.objects;
CREATE POLICY "portal_files_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id IN ('mvlc', 'eblf', 'erhd', 'gls', 'mscc', 'rhn', 'rhm', 'lcn', 'mcvc', 'project_deve_updates', 'future_dev'));

DROP POLICY IF EXISTS "portal_files_update" ON storage.objects;
CREATE POLICY "portal_files_update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id IN ('mvlc', 'eblf', 'erhd', 'gls', 'mscc', 'rhn', 'rhm', 'lcn', 'mcvc', 'project_deve_updates', 'future_dev'))
  WITH CHECK (bucket_id IN ('mvlc', 'eblf', 'erhd', 'gls', 'mscc', 'rhn', 'rhm', 'lcn', 'mcvc', 'project_deve_updates', 'future_dev'));

DROP POLICY IF EXISTS "portal_files_delete" ON storage.objects;
CREATE POLICY "portal_files_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id IN ('mvlc', 'eblf', 'erhd', 'gls', 'mscc', 'rhn', 'rhm', 'lcn', 'mcvc', 'project_deve_updates', 'future_dev'));

-- Make the new tables visible to the API immediately.
NOTIFY pgrst, 'reload schema';

-- Check: the four projects and their lot tables.
SELECT p.code, p.name, to_regclass(format('public.%I', lower(p.code) || '_lots')) IS NOT NULL AS has_lot_table
FROM public.projects p
WHERE p.code IN ('RHN', 'RHM', 'LCN', 'MCVC')
ORDER BY p.code;
