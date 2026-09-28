-- Normalize existing MVLC identifiers that already contain both a B (block)
-- and L (lot), accepting spaces or a dash between them. Examples:
-- B1L1, B1-L1, and B 1 L 1 all become B1 L1.
UPDATE public.mvlc_lots AS lot
   SET lot_no = 'B' || parsed.parts[1]::bigint || ' L' || parsed.parts[2]::bigint
  FROM (
    SELECT id, regexp_match(trim(lot_no), '^B\s*([0-9]+)\s*[- ]*\s*L\s*([0-9]+)$', 'i') AS parts
      FROM public.mvlc_lots
  ) AS parsed
 WHERE lot.id = parsed.id
   AND parsed.parts IS NOT NULL
   AND parsed.parts[1]::bigint > 0
   AND parsed.parts[2]::bigint > 0;

NOTIFY pgrst, 'reload schema';
