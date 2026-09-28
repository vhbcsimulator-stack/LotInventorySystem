-- Keep the most recently updated feature when upgrading an existing database.
DELETE FROM public.featured_projects
WHERE project_code NOT IN (
  SELECT project_code
  FROM public.featured_projects
  ORDER BY updated_at DESC, project_code
  LIMIT 1
);

-- A constant unique key allows exactly one row while retaining project_code as the PK.
ALTER TABLE public.featured_projects
  ADD COLUMN singleton_key SMALLINT NOT NULL DEFAULT 1
  CONSTRAINT featured_projects_singleton_key_check CHECK (singleton_key = 1);

CREATE UNIQUE INDEX featured_projects_singleton_key_idx
  ON public.featured_projects (singleton_key);

NOTIFY pgrst, 'reload schema';
