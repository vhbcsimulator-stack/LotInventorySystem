-- Give every per-project lot table (public.*_lots — e.g. erhd_lots) the same
-- columns as public.lots: same names, types (including numeric precision),
-- defaults, and NOT NULLs, then the same row-level security policies. The
-- structure is read from public.lots itself, so nothing is guessed.
--
-- Safe to re-run: columns and policies that already exist are left alone.
-- The tables' existing id and created_at columns are kept as they are.
-- Run once in the Supabase SQL Editor; the Messages tab lists what was added.
DO $$
DECLARE
  target record;
  col record;
  pol record;
  stmt text;
  has_rows boolean;
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
    -- Columns, in the same order as public.lots.
    FOR col IN
      SELECT
        a.attname AS name,
        format_type(a.atttypid, a.atttypmod) AS type,
        pg_get_expr(d.adbin, d.adrelid) AS default_expr,
        a.attnotnull AS not_null,
        a.attgenerated AS generated
      FROM pg_attribute a
      LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE a.attrelid = 'public.lots'::regclass
        AND a.attnum > 0
        AND NOT a.attisdropped
      ORDER BY a.attnum
    LOOP
      CONTINUE WHEN EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = target.rel AND attname = col.name AND NOT attisdropped
      );

      stmt := format('ALTER TABLE %s ADD COLUMN %I %s', target.rel, col.name, col.type);

      -- A generated column (total = size_sqm * price_per_sqm) keeps its formula; its
      -- source columns come earlier in public.lots, so they already exist here.
      IF col.generated = 's' THEN
        stmt := stmt || ' GENERATED ALWAYS AS (' || col.default_expr || ') STORED';
      -- A sequence default belongs to public.lots' own id; never share it.
      ELSIF col.default_expr IS NOT NULL AND col.default_expr NOT LIKE 'nextval(%' THEN
        stmt := stmt || ' DEFAULT ' || col.default_expr;
      END IF;

      -- NOT NULL can only be added without a default when the table is still empty.
      IF col.not_null THEN
        EXECUTE format('SELECT EXISTS (SELECT 1 FROM %s)', target.rel) INTO has_rows;
        IF NOT has_rows OR (col.default_expr IS NOT NULL AND col.default_expr NOT LIKE 'nextval(%') THEN
          stmt := stmt || ' NOT NULL';
        ELSE
          RAISE NOTICE '%.% added without NOT NULL: the table already has rows and the column has no default.',
            target.name, col.name;
        END IF;
      END IF;

      EXECUTE stmt;
      RAISE NOTICE 'Added column %.% (%)', target.name, col.name, col.type;
    END LOOP;

    -- Row-level security, matching public.lots.
    IF (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.lots'::regclass) THEN
      EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', target.rel);
    END IF;

    FOR pol IN
      SELECT * FROM pg_policies WHERE schemaname = 'public' AND tablename = 'lots'
    LOOP
      CONTINUE WHEN EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = target.name AND policyname = pol.policyname
      );

      EXECUTE format(
        'CREATE POLICY %I ON %s AS %s FOR %s TO %s%s%s',
        pol.policyname,
        target.rel,
        pol.permissive,
        pol.cmd,
        (SELECT string_agg(CASE WHEN role = 'public' THEN 'public' ELSE quote_ident(role) END, ', ')
         FROM unnest(pol.roles) AS role),
        COALESCE(' USING (' || pol.qual || ')', ''),
        COALESCE(' WITH CHECK (' || pol.with_check || ')', '')
      );
      RAISE NOTICE 'Added policy "%" to %', pol.policyname, target.name;
    END LOOP;
  END LOOP;
END $$;

-- Make the new columns visible to the API immediately.
NOTIFY pgrst, 'reload schema';
