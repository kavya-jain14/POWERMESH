import { z } from "zod";
import { imageDigestSchema } from "./entities";

export const artifactValidationSchema = z.object({
  code: z.string().trim().min(1).max(80),
  label: z.string().trim().min(1).max(200),
  passed: z.boolean(),
});

export const artifactSchema = z
  .object({
    id: z.string().uuid(),
    jobId: z.string().uuid(),
    direction: z.enum(["input", "output"]),
    name: z.string().trim().min(1).max(255),
    contentType: z.string().trim().min(1).max(255),
    sizeBytes: z.number().int().nonnegative(),
    digest: imageDigestSchema,
    url: z.url().nullable(),
    urlExpiresAt: z.string().datetime({ offset: true }).nullable(),
    validation: z.array(artifactValidationSchema),
  })
  .superRefine((artifact, context) => {
    if ((artifact.url === null) !== (artifact.urlExpiresAt === null)) {
      context.addIssue({
        code: "custom",
        path: ["urlExpiresAt"],
        message: "url and urlExpiresAt must either both be present or both be null",
      });
    }

    if (artifact.validation.some((check) => !check.passed) && artifact.url !== null) {
      context.addIssue({
        code: "custom",
        path: ["url"],
        message: "Failed validation makes an artifact non-downloadable",
      });
    }
  });

export type ArtifactValidation = z.infer<typeof artifactValidationSchema>;
export type Artifact = z.infer<typeof artifactSchema>;
