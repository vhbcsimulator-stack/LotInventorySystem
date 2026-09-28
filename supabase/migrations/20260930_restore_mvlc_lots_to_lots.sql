-- Restore MVLC's working data to public.lots and leave public.mvlc_lots empty.
-- Existing rows are matched by id and updated; rows that only exist in
-- mvlc_lots are inserted. Rows that only exist in lots are preserved.
DO $$
DECLARE
  columns_sql text;
  updates_sql text;
BEGIN
  IF to_regclass('public.mvlc_lots') IS NULL THEN
    RAISE NOTICE 'public.mvlc_lots does not exist; nothing needs to be restored.';
    RETURN;
  END IF;

  SELECT
    string_agg(format('%I', a.attname), ', ' ORDER BY a.attnum),
    string_agg(format('%1$I = EXCLUDED.%1$I', a.attname), ', ' ORDER BY a.attnum)
      FILTER (WHERE a.attname <> 'id')
    INTO columns_sql, updates_sql
    FROM pg_attribute a
   WHERE a.attrelid = 'public.lots'::regclass
     AND a.attnum > 0
     AND NOT a.attisdropped
     AND a.attgenerated = '';

  EXECUTE format(
    'INSERT INTO public.lots (%1$s) OVERRIDING SYSTEM VALUE
       SELECT %1$s FROM public.mvlc_lots
     ON CONFLICT (id) DO UPDATE SET %2$s',
    columns_sql,
    updates_sql
  );
END $$;

-- Move the original table's identity sequence past every restored ID.
DO $$
DECLARE
  sequence_name text;
  last_id bigint;
  has_rows boolean;
BEGIN
  sequence_name := pg_get_serial_sequence('public.lots', 'id');
  IF sequence_name IS NOT NULL THEN
    SELECT COALESCE(MAX(id), 1), EXISTS (SELECT 1 FROM public.lots)
      INTO last_id, has_rows
      FROM public.lots;
    PERFORM setval(sequence_name::regclass, last_id, has_rows);
  END IF;
END $$;

-- The restore above must succeed before this statement is reached. Keep the
-- table itself and its schema, policies, and indexes, but remove all of its rows
-- and reset its identity for possible future use.
DO $$
BEGIN
  IF to_regclass('public.mvlc_lots') IS NOT NULL THEN
    TRUNCATE TABLE public.mvlc_lots RESTART IDENTITY;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

-- Verification after the migration:
-- SELECT
--   (SELECT count(*) FROM public.lots) AS lots_rows,
--   (SELECT count(*) FROM public.mvlc_lots) AS mvlc_lots_rows;
