-- Payment options per project: Cash, 50%, 30%, 20% and 0% down, each with its
-- own discount and interest rate. The portal reads and writes these from
-- "Update Discount" in Project Actions.
--
-- One row per project and option. The rates are shared: the rows under the
-- sentinel project_code '*' are the set every project uses. A project that
-- prices differently gets rows of its own under its real code, which then win
-- over the shared set for that project alone; deleting them puts it back on the
-- shared set. An option with no row either way reads as 0 in the portal.
--
-- Safe to re-run. Run once in the Supabase SQL Editor.
CREATE TABLE IF NOT EXISTS public.project_discounts (
  project_code TEXT NOT NULL,
  option       TEXT NOT NULL,
  discount     NUMERIC NOT NULL DEFAULT 0 CHECK (discount >= 0 AND discount <= 100),
  interest     NUMERIC NOT NULL DEFAULT 0 CHECK (interest >= 0 AND interest <= 100),
  user_id      UUID,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_code, option)
);

ALTER TABLE public.project_discounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "project_discounts_read" ON public.project_discounts;
CREATE POLICY "project_discounts_read" ON public.project_discounts FOR SELECT USING (true);

DROP POLICY IF EXISTS "project_discounts_insert" ON public.project_discounts;
CREATE POLICY "project_discounts_insert" ON public.project_discounts FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "project_discounts_update" ON public.project_discounts;
CREATE POLICY "project_discounts_update" ON public.project_discounts FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "project_discounts_delete" ON public.project_discounts;
CREATE POLICY "project_discounts_delete" ON public.project_discounts FOR DELETE TO authenticated USING (true);

NOTIFY pgrst, 'reload schema';
