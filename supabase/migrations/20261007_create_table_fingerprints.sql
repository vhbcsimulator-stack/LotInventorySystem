-- A cheap "has this table changed?" check for the portal's Refresh buttons.
--
-- table_fingerprints(['announcements', 'mvlc_lots']) returns one row per table
-- that exists: its row count and an md5 over every row's contents. The portal
-- remembers the fingerprints from the last refresh and only downloads a section
-- again when one of its tables' fingerprints moved, so a refresh with nothing
-- new costs one small request instead of every row.
--
-- Hashing whole rows (not max(updated_at)) also catches edits made in the
-- Supabase dashboard or by a sheet sync that leave updated_at alone, and deletes.
--
-- SECURITY INVOKER: row-level security still applies, so the hash covers exactly
-- the rows the caller could read anyway. Only tables in `public` are hashed, and
-- names are quoted with %I, so a table name cannot inject SQL.
--
-- Until this is run, the Refresh buttons still work — they just always refetch.

CREATE OR REPLACE FUNCTION public.table_fingerprints(table_names text[])
RETURNS TABLE (table_name text, fingerprint text)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  target text;
BEGIN
  FOREACH target IN ARRAY table_names LOOP
    CONTINUE WHEN to_regclass(format('public.%I', target)) IS NULL;
    table_name := target;
    EXECUTE format(
      'SELECT count(*)::text || '':'' || coalesce(md5(string_agg(md5(t::text), '''' ORDER BY md5(t::text))), '''') FROM public.%I t',
      target
    ) INTO fingerprint;
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.table_fingerprints(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.table_fingerprints(text[]) TO authenticated;

-- Check: returns a count:hash row for each existing table.
SELECT * FROM public.table_fingerprints(ARRAY['projects', 'announcements']);
