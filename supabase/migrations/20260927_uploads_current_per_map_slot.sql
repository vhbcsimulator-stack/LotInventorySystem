-- One current map per map SLOT, not per phase_id.
--
-- uploads_set_current() (the uploads_flip_current AFTER INSERT trigger) turned
-- off every other current row with the same project_id, kind and phase_id. The
-- MVLC section maps (Phase 1A, 1B, 1C, 2A, 2B) are all saved with phase_id
-- NULL, so each new one switched the one before it off — and the portal and
-- the app only show current = true maps, so 1A, 1B, 1C and 2A vanished.
--
-- For maps the slot is now what the portal's map tabs use (sameSlot in
-- src/data/projectMapsData.js): the project, the Phase, commercial or not, and
-- — for a non-commercial map — its section (A, B, C, East). Every other kind of
-- upload keeps the phase_id rule it had.

CREATE OR REPLACE FUNCTION public.uploads_set_current()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
begin
  if new.kind = 'map' then
    update public.uploads u
       set current = false
     where u.kind = 'map'
       and u.id <> new.id
       and u.current = true
       and (u.project_id = new.project_id or (new.project_id is null and u.project = new.project))
       and u."Phase" is not distinct from new."Phase"
       and (lower(coalesce(u.type, '')) = 'commercial') = (lower(coalesce(new.type, '')) = 'commercial')
       and (
         lower(coalesce(new.type, '')) = 'commercial'
         or lower(nullif(u.map_section, '')) is not distinct from lower(nullif(new.map_section, ''))
       );
  else
    update public.uploads u
       set current = false
     where u.project_id = new.project_id
       and coalesce(u.phase_id, -1) = coalesce(new.phase_id, -1)
       and u.kind = new.kind
       and u.id <> new.id
       and u.current = true;
  end if;
  return new;
end $function$;

-- Repair: every map slot left with no current row gets its newest row back.
-- (The trigger fires on INSERT only, so this update switches nothing off.)
WITH keyed AS (
  SELECT id,
         current,
         uploaded_at,
         coalesce(project_id::text, project) AS slot_project,
         "Phase" AS slot_phase,
         lower(coalesce(type, '')) = 'commercial' AS slot_commercial,
         CASE WHEN lower(coalesce(type, '')) = 'commercial' THEN NULL ELSE lower(nullif(map_section, '')) END AS slot_section
    FROM public.uploads
   WHERE kind = 'map'
),
ranked AS (
  SELECT id,
         bool_or(current) OVER slot AS slot_has_current,
         row_number() OVER (slot ORDER BY uploaded_at DESC NULLS LAST, id DESC) AS newest
    FROM keyed
  WINDOW slot AS (PARTITION BY slot_project, slot_phase, slot_commercial, slot_section)
)
UPDATE public.uploads u
   SET current = true
  FROM ranked r
 WHERE u.id = r.id
   AND r.newest = 1
   AND NOT r.slot_has_current;

-- Check: every MVLC map slot should now have exactly one current row.
SELECT id, current, "Phase", map_section, type, name
  FROM public.uploads
 WHERE kind = 'map' AND project ILIKE 'MVLC%'
 ORDER BY "Phase" NULLS FIRST, type, map_section;
