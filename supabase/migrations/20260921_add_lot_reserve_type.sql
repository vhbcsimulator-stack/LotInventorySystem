-- Who a reserved lot is being held for: 'client' or 'company'. NULL is the
-- default reservation. The lot's status stays 'reserved' either way; this only
-- records the kind, and the portal clears it when the lot leaves reserved.
--
-- Applied to public.lots and every per-project lot table.
-- Safe to re-run. Run once in the Supabase SQL Editor.
ALTER TABLE public.lots ADD COLUMN IF NOT EXISTS reserve_type TEXT;

DO $$
DECLARE
  target record;
BEGIN
  FOR target IN
    SELECT c.oid::regclass AS rel, c.relname AS name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relname LIKE '%\_lots' ESCAPE '\'
      AND c.relname <> 'lots'
    ORDER BY c.relname
  LOOP
    EXECUTE format('ALTER TABLE %s ADD COLUMN IF NOT EXISTS reserve_type TEXT', target.rel);
    RAISE NOTICE 'Ensured %.reserve_type', target.name;
  END LOOP;
END $$;

-- Make the new column visible to the API immediately.
NOTIFY pgrst, 'reload schema';
