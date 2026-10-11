ALTER TABLE workload_definitions
  ADD COLUMN image_reference TEXT;

UPDATE workload_definitions
SET image_reference = 'legacy.invalid/powermesh/workload@' || image_digest
WHERE image_reference IS NULL;

ALTER TABLE workload_definitions
  ALTER COLUMN image_reference SET NOT NULL,
  ADD CONSTRAINT workload_image_reference_is_pinned
  CHECK (image_reference ~ '^[a-z0-9][a-zA-Z0-9._/-]*(:[a-zA-Z0-9._-]+)?@sha256:[a-f0-9]{64}$');
