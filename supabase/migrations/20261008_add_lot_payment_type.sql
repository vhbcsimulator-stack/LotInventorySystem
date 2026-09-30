-- How a reserved or sold lot is being paid for: 'cash' or 'installment'.
-- NULL when the sales sheet did not say. Filled by the CSV import's payment
-- column and shown on the Clients page. Safe to run more than once.

ALTER TABLE public.lots ADD COLUMN IF NOT EXISTS payment_type TEXT
  CHECK (payment_type IN ('cash', 'installment'));

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
      'ALTER TABLE %s ADD COLUMN IF NOT EXISTS payment_type TEXT CHECK (payment_type IN (''cash'', ''installment''))',
      target.rel
    );
    RAISE NOTICE 'Ensured %.payment_type', target.name;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
