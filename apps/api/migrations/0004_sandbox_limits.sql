ALTER TABLE jobs
  ADD COLUMN max_output_bytes INTEGER NOT NULL DEFAULT 10485760
  CHECK (max_output_bytes > 0 AND max_output_bytes <= 52428800);
