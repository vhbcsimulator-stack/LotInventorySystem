-- Per-unit details for MSCC condominium units: unit type, floor level, view, and
-- whether the unit is an end unit. Only mscc_lots gets these — the land projects
-- (MVLC, EBLF, ERHD, GLS) sell lots and have no use for them.
--
-- All four are stored as TEXT holding exactly the label the portal shows
-- ('2 Bedroom Deluxe', '3rd Floor', 'Nature View', 'Yes'), so the picker, the
-- table, and a CSV export all read the same value with nothing to translate.
-- `view` is a reserved word in SQL, so the column is named unit_view.
--
-- Every column is nullable: units added before this migration keep empty values
-- rather than being forced to a guessed default.
--
-- Safe to re-run. Run once in the Supabase SQL Editor.
ALTER TABLE public.mscc_lots ADD COLUMN IF NOT EXISTS unit_type   TEXT;
ALTER TABLE public.mscc_lots ADD COLUMN IF NOT EXISTS floor_level TEXT;
ALTER TABLE public.mscc_lots ADD COLUMN IF NOT EXISTS unit_view   TEXT;
ALTER TABLE public.mscc_lots ADD COLUMN IF NOT EXISTS end_unit    TEXT;

-- Make the new columns visible to the API immediately.
NOTIFY pgrst, 'reload schema';
