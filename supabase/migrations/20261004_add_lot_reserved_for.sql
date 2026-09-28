-- Temporary CSV-import support for the name in a reserved lot's Client column.
-- `reserve_type` says whether the reservation is for a client or the company;
-- `reserved_for` keeps the client's actual name for client reservations.
-- Safe to run more than once.

ALTER TABLE public.lots ADD COLUMN IF NOT EXISTS reserved_for TEXT;

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
    EXECUTE format('ALTER TABLE %s ADD COLUMN IF NOT EXISTS reserved_for TEXT', target.rel);
    RAISE NOTICE 'Ensured %.reserved_for', target.name;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
