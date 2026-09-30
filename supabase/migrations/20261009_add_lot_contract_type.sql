-- The sale document a reserved or sold lot is under: 'cts' (Contract to Sell)
-- or 'doas' (Deed of Absolute Sale). NULL when the sales sheet did not say; the
-- portal shows that as Unknown. Filled by the CSV import's CTS/DOAS column and
-- shown on the Clients page. Safe to run more than once.

ALTER TABLE public.lots ADD COLUMN IF NOT EXISTS contract_type TEXT
  CHECK (contract_type IN ('cts', 'doas'));

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
    EXECUTE format(
      'ALTER TABLE %s ADD COLUMN IF NOT EXISTS contract_type TEXT CHECK (contract_type IN (''cts'', ''doas''))',
      target.rel
    );
    RAISE NOTICE 'Ensured %.contract_type', target.name;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
