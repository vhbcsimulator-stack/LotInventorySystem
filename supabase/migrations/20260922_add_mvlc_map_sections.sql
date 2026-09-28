-- Keep MVLC's Phase 1 and Phase 2 map sections in separate upload slots.
-- Existing unsectioned residential maps for these phases are the East maps.
ALTER TABLE public.uploads ADD COLUMN IF NOT EXISTS map_section TEXT;

UPDATE public.uploads
   SET map_section = 'East'
 WHERE project ILIKE 'MVLC%'
   AND kind = 'map'
   AND "Phase" IN (1, 2)
   AND (type IS NULL OR type <> 'commercial')
   AND map_section IS NULL;

-- Existing MVLC annotations belong to those same East map tabs.
UPDATE public.annotated_images
   SET slot = slot || '-east'
 WHERE project = 'MVLC'
   AND slot IN ('phase-1', 'phase-2');

NOTIFY pgrst, 'reload schema';
