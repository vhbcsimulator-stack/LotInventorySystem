-- Let a user be deleted from Supabase Auth.
--
-- These tables recorded who created each row with a foreign key to auth.users
-- and no ON DELETE rule, so deleting any user who had ever added a lot, map,
-- announcement, price, etc. failed with "Database error deleting user".
--
-- Each key now uses ON DELETE SET NULL: the rows stay, and only their user_id
-- is cleared. (CASCADE would delete every lot, map, and announcement the user
-- ever added.) user_id must allow NULL for that, so NOT NULL is dropped too.
--
-- Safe to run more than once.

DO $$
DECLARE
  target record;
BEGIN
  FOR target IN
    SELECT * FROM (VALUES
      ('projects',      'projects_user_id_fkey'),
      ('phases',        'phases_user_id_fkey'),
      ('lots',          'lots_user_id_fkey'),
      ('reservations',  'reservations_user_id_fkey'),
      ('follow_ups',    'follow_ups_user_id_fkey'),
      ('announcements', 'announcements_user_id_fkey'),
      ('uploads',       'uploads_user_id_fkey'),
      ('eblf_price',    'eblf_price_user_id_fkey')
    ) AS t(tbl, con)
  LOOP
    -- A table missing from this database is skipped rather than failing the run.
    CONTINUE WHEN to_regclass(format('public.%I', target.tbl)) IS NULL;
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN user_id DROP NOT NULL', target.tbl);
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I', target.tbl, target.con);
    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL',
      target.tbl, target.con
    );
  END LOOP;
END $$;

-- Check: no row should say "blocks" any more.
SELECT c.conrelid::regclass AS table_name,
       c.conname            AS constraint_name,
       CASE c.confdeltype WHEN 'a' THEN 'NO ACTION (blocks)' WHEN 'r' THEN 'RESTRICT (blocks)'
                          WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL' ELSE 'SET DEFAULT' END AS on_delete
FROM pg_constraint c
WHERE c.contype = 'f' AND c.confrelid = 'auth.users'::regclass
ORDER BY 1;
