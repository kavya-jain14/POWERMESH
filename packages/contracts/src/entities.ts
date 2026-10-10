import { z } from "zod";
import { networkModeSchema, workloadRequestSchema } from "./schemas";

export const nodeStatuses = ["OFFLINE", "ONLINE", "BUSY", "DRAINING"] as const;
export const isolationLevels = ["CONTAINER_BASELINE", "GVISOR", "MICROVM"] as const;

export const imageDigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

export const workloadDefinitionSchema = z.object({
  name: z.string().trim().min(2).max(80),
  version: z.string().trim().min(1).max(40),
  imageDigest: imageDigestSchema,
});

export const jobSubmissionSchema = z.object({
  requesterId: z.string().uuid(),
  workload: workloadDefinitionSchema,
  resources: workloadRequestSchema,
  params: z
    .record(z.string().min(1).max(80), z.string().max(2_000))
    .refine((value) => Object.keys(value).length <= 50, "At most 50 parameters are allowed")
    .default({}),
  inputDigests: z.array(imageDigestSchema).max(20).default([]),
});

export const providerRegistrationSchema = z.object({
  ownerId: z.string().uuid(),
  nodeName: z.string().trim().min(1).max(80),
  os: z.string().trim().min(1).max(40),
  architecture: z.string().trim().min(1).max(40),
  agentVersion: z.string().trim().min(1).max(40),
  cpuCores: z.number().int().positive().max(256),
  memoryMb: z.number().int().positive().max(2_097_152),
  networkModes: z.array(networkModeSchema).min(1),
  isolationLevels: z.array(z.enum(isolationLevels)).min(1),
});

export const providerHeartbeatSchema = z.object({
  availableCpu: z.number().int().nonnegative().max(256),
  availableMemoryMb: z.number().int().nonnegative().max(2_097_152),
  activeJobs: z.number().int().nonnegative().max(1_000),
  status: z.enum(["ONLINE", "BUSY", "DRAINING"]),
});

export type JobSubmission = z.infer<typeof jobSubmissionSchema>;
export type ProviderHeartbeat = z.infer<typeof providerHeartbeatSchema>;
export type ProviderRegistration = z.infer<typeof providerRegistrationSchema>;
