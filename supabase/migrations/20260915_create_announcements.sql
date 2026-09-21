-- Company bulletins shown on the Announcements & Memo Hub page.
-- Run once in the Supabase SQL Editor.
CREATE TABLE IF NOT EXISTS public.announcements (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT NOT NULL,
  body        TEXT NOT NULL DEFAULT '',
  category    TEXT NOT NULL DEFAULT 'news' CHECK (category IN ('news', 'activity')),
  author      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS announcements_created_at_idx ON public.announcements (created_at DESC);

ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;

-- Signed-in portal users can read and post announcements.
DROP POLICY IF EXISTS "announcements_read" ON public.announcements;
CREATE POLICY "announcements_read" ON public.announcements
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "announcements_insert" ON public.announcements;
CREATE POLICY "announcements_insert" ON public.announcements
  FOR INSERT TO authenticated WITH CHECK (true);

-- Make the new table visible to the API immediately.
NOTIFY pgrst, 'reload schema';
