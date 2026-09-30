-- Let the portal read every client.
--
-- `clients` was made in the dashboard with its own policies, which let a broker
-- see only their own clients (broker_id). Portal staff are not the broker on
-- any row, so the Clients page came back empty.
--
-- This adds one read policy: a signed-in user who is NOT a broker (no row in
-- `brokers` with their login) may SELECT every client. Brokers signing in to the
-- app are unaffected and still see only what their existing policies allow.
-- Postgres ORs permissive policies together, so this only widens reading for
-- portal staff; insert, update, and delete rules are not touched. Safe to run
-- again.

DROP POLICY IF EXISTS portal_read_all_clients ON public.clients;
CREATE POLICY portal_read_all_clients ON public.clients
  FOR SELECT TO authenticated
  USING (NOT EXISTS (SELECT 1 FROM public.brokers b WHERE b.auth_user_id = auth.uid()));

NOTIFY pgrst, 'reload schema';

-- Check: the policies on clients. A RESTRICTIVE one would still narrow reads.
SELECT policyname, permissive, cmd, roles, qual
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'clients'
ORDER BY policyname;
