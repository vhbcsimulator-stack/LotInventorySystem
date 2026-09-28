-- Link Future Projects entries to the portal's existing project records.
ALTER TABLE public.future_projects
  ADD COLUMN IF NOT EXISTS project_code TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'future_projects' AND column_name = 'project_name'
  ) THEN
    EXECUTE 'UPDATE public.future_projects SET project_code = COALESCE(NULLIF(project_code, ''''), NULLIF(project_name, ''''))';
  END IF;
END $$;

UPDATE public.future_projects
SET project_code = COALESCE(NULLIF(project_code, ''), NULLIF(name, ''), 'UNKNOWN');

ALTER TABLE public.future_projects
  ALTER COLUMN project_code SET NOT NULL;

CREATE INDEX IF NOT EXISTS future_projects_project_code_idx
  ON public.future_projects (project_code);

NOTIFY pgrst, 'reload schema';
