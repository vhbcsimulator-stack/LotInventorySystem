-- Keep an annotation row's phase section in step with the map row in uploads.
-- New COCO uploads write A, B, C, or East here; whole, commercial, and
-- unsectioned phase maps leave it null.
ALTER TABLE public.annotated_images
  ADD COLUMN IF NOT EXISTS map_section TEXT;

-- Normalize MVLC rows written before its section tabs were introduced. Those
-- unsectioned Phase 1/2 rows represented the East maps.
UPDATE public.annotated_images
   SET slot = slot || '-east'
 WHERE project ILIKE 'MVLC%'
   AND phase IN (1, 2)
   AND slot IN ('phase-1', 'phase-2');

-- Backfill the section from the canonical slot without disturbing values that
-- were already entered directly in the table.
UPDATE public.annotated_images
   SET map_section = CASE
     WHEN lower(slot) LIKE '%-east' THEN 'East'
     WHEN lower(slot) LIKE '%-a' THEN 'A'
     WHEN lower(slot) LIKE '%-b' THEN 'B'
     WHEN lower(slot) LIKE '%-c' THEN 'C'
     ELSE NULL
   END
 WHERE map_section IS NULL;

NOTIFY pgrst, 'reload schema';
