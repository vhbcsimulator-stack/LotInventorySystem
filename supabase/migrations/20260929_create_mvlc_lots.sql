-- Give MVLC its own lot table while preserving public.lots as an untouched
-- backup. LIKE INCLUDING ALL clones the columns, defaults, generated columns,
-- identity, checks, and indexes from public.lots.
CREATE TABLE IF NOT EXISTS public.mvlc_lots
  (LIKE public.lots INCLUDING ALL);

-- Copy the original MVLC data only when the new table is empty. Generated
-- columns are omitted because PostgreSQL calculates them from their source
-- columns; identity values are retained so existing row IDs and references stay
-- stable. Re-running this migration never overwrites newer mvlc_lots data.
DO $$
DECLARE
  columns_sql text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.mvlc_lots) THEN
    SELECT string_agg(format('%I', a.attname), ', ' ORDER BY a.attnum)
      INTO columns_sql
      FROM pg_attribute a
     WHERE a.attrelid = 'public.lots'::regclass
       AND a.attnum > 0
       AND NOT a.attisdropped
       AND a.attgenerated = '';

    EXECUTE format(
      'INSERT INTO public.mvlc_lots (%1$s) OVERRIDING SYSTEM VALUE SELECT %1$s FROM public.lots',
      columns_sql
    );
  END IF;
END $$;

-- Move the new table's identity sequence past the copied IDs so the next lot
-- inserted by the portal cannot collide with an existing row.
DO $$
DECLARE
  sequence_name text;
  last_id bigint;
  has_rows boolean;
BEGIN
  sequence_name := pg_get_serial_sequence('public.mvlc_lots', 'id');
  IF sequence_name IS NOT NULL THEN
    SELECT COALESCE(MAX(id), 1), EXISTS (SELECT 1 FROM public.mvlc_lots)
      INTO last_id, has_rows
      FROM public.mvlc_lots;
    PERFORM setval(sequence_name::regclass, last_id, has_rows);
  END IF;
END $$;

-- Match public.lots row-level security and policies. Policies are schema
-- objects, so CREATE TABLE ... LIKE does not copy them automatically.
DO $$
DECLARE
  pol record;
BEGIN
  IF (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.lots'::regclass) THEN
    ALTER TABLE public.mvlc_lots ENABLE ROW LEVEL SECURITY;
  END IF;

  FOR pol IN
    SELECT * FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'lots'
  LOOP
    CONTINUE WHEN EXISTS (
      SELECT 1
        FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename = 'mvlc_lots'
         AND policyname = pol.policyname
    );

    EXECUTE format(
      'CREATE POLICY %I ON public.mvlc_lots AS %s FOR %s TO %s%s%s',
      pol.policyname,
      pol.permissive,
      pol.cmd,
      (SELECT string_agg(
         CASE WHEN role = 'public' THEN 'public' ELSE quote_ident(role) END,
         ', '
       ) FROM unnest(pol.roles) AS role),
      COALESCE(' USING (' || pol.qual || ')', ''),
      COALESCE(' WITH CHECK (' || pol.with_check || ')', '')
    );
  END LOOP;
END $$;

-- Standard Supabase API privileges. RLS policies still decide which rows each
-- role may access.
GRANT SELECT ON public.mvlc_lots TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.mvlc_lots TO authenticated;
GRANT ALL ON public.mvlc_lots TO service_role;

DO $$
DECLARE
  sequence_name text;
BEGIN
  sequence_name := pg_get_serial_sequence('public.mvlc_lots', 'id');
  IF sequence_name IS NOT NULL THEN
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO authenticated', sequence_name::regclass);
    EXECUTE format('GRANT ALL ON SEQUENCE %s TO service_role', sequence_name::regclass);
  END IF;
END $$;

-- Make the table available through PostgREST immediately.
NOTIFY pgrst, 'reload schema';

-- Optional verification after running this migration:
-- SELECT
--   (SELECT count(*) FROM public.lots) AS backup_rows,
--   (SELECT count(*) FROM public.mvlc_lots) AS mvlc_rows;
