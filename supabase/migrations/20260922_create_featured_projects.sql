-- The follow-up singleton migration limits this table to one featured project.
CREATE TABLE IF NOT EXISTS public.featured_projects (
  project_code TEXT PRIMARY KEY,
  location TEXT NOT NULL,
  image_url TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  user_id UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.featured_projects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "featured_projects_read" ON public.featured_projects;
CREATE POLICY "featured_projects_read" ON public.featured_projects FOR SELECT USING (true);

DROP POLICY IF EXISTS "featured_projects_insert" ON public.featured_projects;
CREATE POLICY "featured_projects_insert" ON public.featured_projects FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "featured_projects_update" ON public.featured_projects;
CREATE POLICY "featured_projects_update" ON public.featured_projects FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "featured_projects_delete" ON public.featured_projects;
CREATE POLICY "featured_projects_delete" ON public.featured_projects FOR DELETE TO authenticated USING (true);

INSERT INTO storage.buckets (id, name, public)
VALUES ('featured-projects', 'featured-projects', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "featured_projects_bucket_read" ON storage.objects;
CREATE POLICY "featured_projects_bucket_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'featured-projects');

DROP POLICY IF EXISTS "featured_projects_bucket_insert" ON storage.objects;
CREATE POLICY "featured_projects_bucket_insert" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'featured-projects');

DROP POLICY IF EXISTS "featured_projects_bucket_delete" ON storage.objects;
CREATE POLICY "featured_projects_bucket_delete" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'featured-projects');

NOTIFY pgrst, 'reload schema';
