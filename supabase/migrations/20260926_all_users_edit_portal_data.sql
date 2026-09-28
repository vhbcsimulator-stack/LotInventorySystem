-- Every signed-in user can add, change, and delete the portal's shared data.
--
-- The tables below were made in the dashboard with policies that only let a
-- user change the rows they created. Once everyone could read every row
-- (20260925_all_users_read_all.sql), editing another user's row failed — e.g.
-- "The database did not accept the change to map #8": the update matched no
-- row the policy allowed, so nothing was written.
--
-- This adds INSERT, UPDATE, and DELETE policies for `authenticated` on the
-- tables the portal edits. Permissive policies are ORed, so the existing
-- owner-only ones stop mattering. Signed-out visitors get nothing new.
--
-- Left alone on purpose, since the portal does not edit them: projects, phases,
-- reservations, follow_ups, profiles. Tables made by this repo's own migrations
-- (announcements, annotated_images, featured/future projects, discounts, ...)
-- already allow this.
--
-- Safe to run more than once. A table missing from this database is skipped.

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    -- maps
    'uploads',
    -- lots, one table per project (see LOT_TABLES in src/data/projectsData.js)
    'lots', 'eblf_lots', 'erhd_lots', 'gls_lots', 'mscc_lots',
    -- category prices (see src/data/pricesData.js)
    'mvlc_price', 'eblf_price', 'erhd_price', 'gls_price', 'mscc_price',
    -- galleries (see src/data/devImagesData.js)
    'project_dev', 'future_dev', 'flyers'
  ]
  LOOP
    CONTINUE WHEN to_regclass(format('public.%I', tbl)) IS NULL;
    EXECUTE format('DROP POLICY IF EXISTS authenticated_insert_all ON public.%I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS authenticated_update_all ON public.%I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS authenticated_delete_all ON public.%I', tbl);
    EXECUTE format('CREATE POLICY authenticated_insert_all ON public.%I FOR INSERT TO authenticated WITH CHECK (true)', tbl);
    EXECUTE format('CREATE POLICY authenticated_update_all ON public.%I FOR UPDATE TO authenticated USING (true) WITH CHECK (true)', tbl);
    EXECUTE format('CREATE POLICY authenticated_delete_all ON public.%I FOR DELETE TO authenticated USING (true)', tbl);
  END LOOP;
END $$;

-- Files: replacing a map or gallery image deletes the old file, which belongs
-- to whoever uploaded it. Map buckets are named after the project code.
DROP POLICY IF EXISTS "portal_files_read" ON storage.objects;
CREATE POLICY "portal_files_read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id IN ('mvlc', 'eblf', 'erhd', 'gls', 'mscc', 'project_deve_updates', 'future_dev'));

DROP POLICY IF EXISTS "portal_files_insert" ON storage.objects;
CREATE POLICY "portal_files_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id IN ('mvlc', 'eblf', 'erhd', 'gls', 'mscc', 'project_deve_updates', 'future_dev'));

DROP POLICY IF EXISTS "portal_files_update" ON storage.objects;
CREATE POLICY "portal_files_update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id IN ('mvlc', 'eblf', 'erhd', 'gls', 'mscc', 'project_deve_updates', 'future_dev'))
  WITH CHECK (bucket_id IN ('mvlc', 'eblf', 'erhd', 'gls', 'mscc', 'project_deve_updates', 'future_dev'));

DROP POLICY IF EXISTS "portal_files_delete" ON storage.objects;
CREATE POLICY "portal_files_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id IN ('mvlc', 'eblf', 'erhd', 'gls', 'mscc', 'project_deve_updates', 'future_dev'));

-- Check: each table should list all three policies.
SELECT tablename, string_agg(policyname, ', ' ORDER BY policyname) AS shared_edit_policies
FROM pg_policies
WHERE schemaname = 'public' AND policyname LIKE 'authenticated\_%\_all'
GROUP BY tablename
ORDER BY tablename;
