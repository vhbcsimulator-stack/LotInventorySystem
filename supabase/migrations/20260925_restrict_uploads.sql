-- Limit what Storage accepts, so the portal's upload rules hold even for a
-- request that does not come through the portal. Mirrors src/lib/uploadRules.js;
-- change the two together.
--
--   Photos (galleries, flyers, featured and future projects): JPG, PNG, WebP, 10 MB
--   Maps (project map buckets, annotated images):             JPG, PNG, WebP, 25 MB
--
-- COCO JSON and CSV files are read in the browser and never stored as files, so
-- they have no bucket to restrict. SVG in particular stays out: these buckets are
-- public, and an SVG can carry script.
--
-- Files already stored are not touched; the limits apply to new uploads. A
-- bucket that does not exist yet is skipped — run this again after creating one.

UPDATE storage.buckets
SET file_size_limit = 10 * 1024 * 1024,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']
WHERE id IN ('project_deve_updates', 'future_dev', 'flyers', 'featured-projects', 'future-projects');

-- One map bucket per project code, lower-cased (see saveProjectMap).
UPDATE storage.buckets
SET file_size_limit = 25 * 1024 * 1024,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']
WHERE id IN ('annotated-images', 'mvlc', 'eblf', 'erhd', 'gls', 'mscc');

-- Check: every bucket above should list its limit and types.
SELECT id, file_size_limit, allowed_mime_types
FROM storage.buckets
ORDER BY id;
