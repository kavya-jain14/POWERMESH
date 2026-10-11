ALTER TABLE provider_nodes
  ADD COLUMN accelerators JSONB NOT NULL DEFAULT '[]'::JSONB,
  ADD COLUMN available_gpu_count INTEGER NOT NULL DEFAULT 0
    CHECK (available_gpu_count >= 0 AND available_gpu_count <= 16);

ALTER TABLE jobs
  ADD COLUMN accelerator TEXT,
  ADD COLUMN requested_gpu_count INTEGER NOT NULL DEFAULT 0
    CHECK (requested_gpu_count >= 0 AND requested_gpu_count <= 8),
  ADD COLUMN result_summary JSONB;

ALTER TABLE jobs
  ADD CONSTRAINT jobs_accelerator_shape
  CHECK (
    (accelerator IS NULL AND requested_gpu_count = 0)
    OR (accelerator = 'NVIDIA_CUDA' AND requested_gpu_count > 0)
  );
