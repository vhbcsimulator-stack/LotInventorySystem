-- Project Actions → Pause project: a paused flag on each project.
--
-- It is only a flag. The portal shows a Paused badge on the project and in the
-- project switcher, and the broker app can read the same column to hold the
-- project back; the project's lots stay fully editable.
--
-- public.projects was made in the dashboard and the portal never wrote to it
-- before (see 20260926_all_users_edit_portal_data.sql), so signed-in users are
-- also given an UPDATE policy — permissive policies are ORed, so this is what
-- lets the toggle save. Nothing else about the table changes.
--
-- Safe to re-run. Run once in the Supabase SQL Editor.
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS paused BOOLEAN NOT NULL DEFAULT false;

DROP POLICY IF EXISTS authenticated_update_all ON public.projects;
CREATE POLICY authenticated_update_all ON public.projects
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- Make the new column visible to the API immediately.
NOTIFY pgrst, 'reload schema';
