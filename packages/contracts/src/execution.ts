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

export const executionCompletionSchema = z.object({
  exitCode: z.number().int().nullable(),
  timedOut: z.boolean(),
  outputTruncated: z.boolean(),
  outputValidated: z.boolean(),
  stdout: executionOutputSchema,
  stderr: executionOutputSchema,
});

export type ExecutionCompletion = z.infer<typeof executionCompletionSchema>;
export type ExecutionOutput = z.infer<typeof executionOutputSchema>;
