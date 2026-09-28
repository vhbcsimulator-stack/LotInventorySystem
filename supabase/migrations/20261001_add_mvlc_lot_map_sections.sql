-- Preserve the section encoded in MVLC CSV phase codes: A, B, C, or East.
-- It uses the same column name and values as uploads and annotated_images.
ALTER TABLE public.mvlc_lots
  ADD COLUMN IF NOT EXISTS map_section TEXT;

ALTER TABLE public.mvlc_lots
  DROP CONSTRAINT IF EXISTS mvlc_lots_map_section_check;

ALTER TABLE public.mvlc_lots
  ADD CONSTRAINT mvlc_lots_map_section_check
  CHECK (map_section IS NULL OR map_section IN ('A', 'B', 'C', 'East'));

CREATE INDEX IF NOT EXISTS mvlc_lots_phase_section_idx
  ON public.mvlc_lots (phase, map_section);

NOTIFY pgrst, 'reload schema';
