-- Match MVLC's commercial map labels by storing block-less lots as "C L1".
-- Safe to run more than once; already-prefixed and block-based identifiers are untouched.
UPDATE public.mvlc_lots
   SET lot_no = 'C L' || upper((regexp_match(trim(lot_no), '^L\s*([0-9]+[A-Za-z]?)$', 'i'))[1])
 WHERE trim(lot_no) ~* '^L\s*[0-9]+[A-Za-z]?$';

NOTIFY pgrst, 'reload schema';
