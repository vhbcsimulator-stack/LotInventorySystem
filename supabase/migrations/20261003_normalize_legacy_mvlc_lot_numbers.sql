-- Normalize the legacy MVLC block/lot spellings already stored in mvlc_lots.

-- Excel date conversions: 21-Jan ... 21-Dec -> B21 L1 ... B21 L12.
WITH parsed AS (
  SELECT id,
         (regexp_match(trim(lot_no), '^([0-9]+)-(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)(?:-[0-9]{2,4})?$', 'i')) AS parts
    FROM public.mvlc_lots
)
UPDATE public.mvlc_lots AS lot
   SET lot_no = 'B' || parsed.parts[1]::bigint || ' L' ||
     array_position(
       ARRAY['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'],
       lower(left(parsed.parts[2], 3))
     )
  FROM parsed
 WHERE lot.id = parsed.id
   AND parsed.parts IS NOT NULL;

-- 21-13 / 21-32A -> B21 L13 / B21 L32A.
WITH parsed AS (
  SELECT id, regexp_match(trim(lot_no), '^([0-9]+)-([0-9]+[A-Za-z]?)$') AS parts
    FROM public.mvlc_lots
)
UPDATE public.mvlc_lots AS lot
   SET lot_no = 'B' || parsed.parts[1]::bigint || ' L' || upper(parsed.parts[2])
  FROM parsed
 WHERE lot.id = parsed.id
   AND parsed.parts IS NOT NULL;

-- 23-B-1 -> B23-B L1.
WITH parsed AS (
  SELECT id, regexp_match(trim(lot_no), '^([0-9]+)-([A-Za-z])-([0-9]+[A-Za-z]?)$') AS parts
    FROM public.mvlc_lots
)
UPDATE public.mvlc_lots AS lot
   SET lot_no = 'B' || parsed.parts[1]::bigint || '-' || upper(parsed.parts[2]) || ' L' || upper(parsed.parts[3])
  FROM parsed
 WHERE lot.id = parsed.id
   AND parsed.parts IS NOT NULL;

-- LOT 1 / L1 -> C L1: MVLC's block-less identifiers are commercial lots.
WITH parsed AS (
  SELECT id, regexp_match(trim(lot_no), '^(?:C\s*[- ]*\s*)?(?:LOT|L)\s*[- ]*\s*([0-9]+[A-Za-z]?)$', 'i') AS parts
    FROM public.mvlc_lots
)
UPDATE public.mvlc_lots AS lot
   SET lot_no = 'C L' || upper(parsed.parts[1])
  FROM parsed
 WHERE lot.id = parsed.id
   AND parsed.parts IS NOT NULL;

NOTIFY pgrst, 'reload schema';
