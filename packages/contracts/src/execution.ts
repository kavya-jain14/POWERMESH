import { z } from "zod";
import { imageDigestSchema } from "./entities";

export const executionOutputSchema = z.object({
  sizeBytes: z
    .number()
    .int()
    .nonnegative()
    .max(50 * 1024 * 1024),
  digest: imageDigestSchema,
});

export const gpuBenchmarkResultSchema = z.object({
  type: z.literal("gpu-benchmark"),
  gpuName: z.string().trim().min(1).max(120),
  cudaRuntime: z.string().trim().min(1).max(40),
  computeCapability: z.string().trim().min(1).max(20),
  memoryMb: z.number().int().positive().max(262_144),
  matrixSize: z.number().int().min(256).max(4096),
  iterations: z.number().int().min(1).max(100),
  durationMs: z.number().nonnegative().max(3_600_000),
  checksum: z.string().regex(/^[a-f0-9]{16}$/),
});

export const executionCompletionSchema = z.object({
  exitCode: z.number().int().nullable(),
  timedOut: z.boolean(),
  outputTruncated: z.boolean(),
  outputValidated: z.boolean(),
  stdout: executionOutputSchema,
  stderr: executionOutputSchema,
  resultSummary: gpuBenchmarkResultSchema.optional(),
});

export type ExecutionCompletion = z.infer<typeof executionCompletionSchema>;
export type ExecutionOutput = z.infer<typeof executionOutputSchema>;
export type GpuBenchmarkResult = z.infer<typeof gpuBenchmarkResultSchema>;
