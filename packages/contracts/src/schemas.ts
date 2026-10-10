import { z } from "zod";

export const riskTiers = ["LOW", "MEDIUM", "HIGH", "BLOCKED"] as const;
export const networkModes = ["OFFLINE", "RESTRICTED", "OPEN_WEB"] as const;
export const jobStates = [
  "SUBMITTED",
  "POLICY_CHECKED",
  "OFFERED",
  "APPROVED",
  "CLAIMED",
  "RUNNING",
  "VALIDATING",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
  "EXPIRED",
] as const;

export const riskTierSchema = z.enum(riskTiers);
export const networkModeSchema = z.enum(networkModes);
export const jobStateSchema = z.enum(jobStates);

export const workloadRequestSchema = z.object({
  cpu: z.number().int().positive().max(16),
  memoryMb: z.number().int().positive().max(32768),
  timeoutSeconds: z.number().int().positive().max(3600),
  maxOutputBytes: z
    .number()
    .int()
    .positive()
    .max(50 * 1024 * 1024)
    .default(10 * 1024 * 1024),
  networkMode: networkModeSchema,
  allowedHosts: z.array(z.string().min(1)).max(20).default([]),
  needsHostMount: z.boolean().default(false),
  privileged: z.boolean().default(false),
  dockerSocket: z.boolean().default(false),
  deviceAccess: z.boolean().default(false),
  arbitraryImage: z.boolean().default(false),
});

export const providerCapabilitySchema = z.object({
  nodeName: z.string().min(1),
  os: z.string().min(1),
  architecture: z.string().min(1),
  cpuCores: z.number().int().positive(),
  memoryMb: z.number().int().positive(),
  networkModes: z.array(networkModeSchema),
  isolationLevels: z.array(z.enum(["CONTAINER_BASELINE", "GVISOR", "MICROVM"])),
});

export type JobState = z.infer<typeof jobStateSchema>;
export type NetworkMode = z.infer<typeof networkModeSchema>;
export type ProviderCapability = z.infer<typeof providerCapabilitySchema>;
export type RiskTier = z.infer<typeof riskTierSchema>;
export type WorkloadRequest = z.infer<typeof workloadRequestSchema>;
