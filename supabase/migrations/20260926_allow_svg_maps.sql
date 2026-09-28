-- Let map buckets store SVG, so a site map (and its recoloured saves) stays a
-- vector. Mirrors the `map` rule in src/lib/uploadRules.js.
--
-- Every SVG is sanitised in the portal before upload (src/lib/svgMaps.js):
-- scripts, foreignObject, event handlers, and links to outside files are
-- removed, since these buckets are public. Photo buckets stay JPG/PNG/WebP.
--
-- Replaces the map-bucket limits set in 20260925_restrict_uploads.sql. A bucket
-- that does not exist yet is skipped.

UPDATE storage.buckets
SET file_size_limit = 25 * 1024 * 1024,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml']
WHERE id IN ('annotated-images', 'mvlc', 'eblf', 'erhd', 'gls', 'mscc');

-- Check: the map buckets should list image/svg+xml.
SELECT id, file_size_limit, allowed_mime_types
FROM storage.buckets
WHERE id IN ('annotated-images', 'mvlc', 'eblf', 'erhd', 'gls', 'mscc')
ORDER BY id;
