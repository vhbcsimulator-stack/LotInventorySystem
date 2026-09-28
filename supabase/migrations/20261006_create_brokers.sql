-- Broker accounts created from the Add Brokers page.
-- Run once in the Supabase SQL Editor. Safe to run more than once.
CREATE TABLE IF NOT EXISTS public.brokers (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name     TEXT NOT NULL,
  last_name      TEXT NOT NULL,
  mobile_number  TEXT NOT NULL,
  email          TEXT NOT NULL,
  user_id        UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The broker's own login for the app (Authentication → Users). `user_id` is
-- the portal user who created the account.
ALTER TABLE public.brokers
  ADD COLUMN IF NOT EXISTS auth_user_id UUID UNIQUE REFERENCES auth.users (id) ON DELETE SET NULL;

-- One account per email, whatever its case.
CREATE UNIQUE INDEX IF NOT EXISTS brokers_email_key ON public.brokers (lower(email));
CREATE INDEX IF NOT EXISTS brokers_created_at_idx ON public.brokers (created_at DESC);

ALTER TABLE public.brokers ENABLE ROW LEVEL SECURITY;

-- Signed-in users can read and change brokers. There are no INSERT or DELETE
-- policies on purpose: a broker is a row *and* an app login, so rows are added
-- and removed only by the create-broker and delete-broker Edge Functions,
-- which handle both (supabase/functions).
DROP POLICY IF EXISTS "brokers_read" ON public.brokers;
CREATE POLICY "brokers_read" ON public.brokers
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "brokers_insert" ON public.brokers;

DROP POLICY IF EXISTS "brokers_update" ON public.brokers;
CREATE POLICY "brokers_update" ON public.brokers
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "brokers_delete" ON public.brokers;

-- Make the new table visible to the API immediately.
NOTIFY pgrst, 'reload schema';
