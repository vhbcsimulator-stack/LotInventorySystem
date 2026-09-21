-- How much of `last_updated` is actually known.
--
-- The sales sheets record when a lot last moved as a MONTH and YEAR only
-- ("MARCH", "2025") with no day. `last_updated` stays a real timestamp — the
-- dashboard sorts and does date arithmetic on it — so an imported month is stored
-- as midnight on the first of that month and this column records that only the
-- month is meaningful,
-- letting the portal show "March 2025" instead of inventing "March 1, 2025".
--
-- NULL means the whole date is known, which is every row written by the portal
-- itself. Existing rows therefore need no backfill: they are already full dates.
-- Anything imported from a month/year sheet is marked 'month', and any later edit
-- in the portal clears it back to NULL along with writing a full date.
--
-- Applied to public.lots and every per-project lot table.
-- Safe to re-run. Run once in the Supabase SQL Editor.
ALTER TABLE public.lots ADD COLUMN IF NOT EXISTS last_updated_precision TEXT;

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
    EXECUTE format('ALTER TABLE %s ADD COLUMN IF NOT EXISTS last_updated_precision TEXT', target.rel);
    RAISE NOTICE 'Ensured %.last_updated_precision', target.name;
  END LOOP;
END $$;

-- Make the new column visible to the API immediately.
NOTIFY pgrst, 'reload schema';
