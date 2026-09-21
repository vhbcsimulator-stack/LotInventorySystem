-- Records which sales agent sold a lot. Filled when a lot's status is set to
-- 'sold' from the portal, and cleared when the lot is moved off 'sold'.
-- Run once in the Supabase SQL Editor.
ALTER TABLE public.lots ADD COLUMN IF NOT EXISTS sold_by TEXT;

-- Make the new column visible to the API immediately.
NOTIFY pgrst, 'reload schema';
