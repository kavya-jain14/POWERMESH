import { z } from "zod";

export const riskTiers = ["LOW", "MEDIUM", "HIGH", "BLOCKED"] as const;
export const networkModes = ["OFFLINE", "RESTRICTED", "OPEN_WEB"] as const;
export const jobStates = [
  "SUBMITTED",
  "REJECTED",
  "POLICY_CHECKED",
  "QUEUED",
  "OFFERED",
  "DECLINED",
  "APPROVED",
  "CLAIMED",
  "STAGING",
  "RUNNING",
  "VALIDATING",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
  "EXPIRED",
  "TIMED_OUT",
] as const;

export const riskTierSchema = z.enum(riskTiers);
export const networkModeSchema = z.enum(networkModes);
export const jobStateSchema = z.enum(jobStates);

export const acceleratorKinds = ["NVIDIA_CUDA"] as const;
export const acceleratorKindSchema = z.enum(acceleratorKinds);

export const acceleratorCapabilitySchema = z.object({
  kind: acceleratorKindSchema,
  index: z.number().int().nonnegative().max(15),
  name: z.string().trim().min(1).max(120),
  memoryMb: z.number().int().positive().max(262_144),
  uuid: z.string().trim().min(1).max(120).optional(),
  driverVersion: z.string().trim().min(1).max(40).optional(),
  cudaVersion: z.string().trim().min(1).max(40).optional(),
});

export const workloadRequestSchema = z
  .object({
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
    accelerator: acceleratorKindSchema.optional(),
    gpuCount: z.number().int().min(0).max(8).optional(),
  })
  .superRefine((request, context) => {
    const gpuCount = request.gpuCount ?? 0;
    if (request.accelerator === "NVIDIA_CUDA" && gpuCount < 1) {
      context.addIssue({
        code: "custom",
        path: ["gpuCount"],
        message: "A CUDA workload must request at least one GPU",
      });
    }
    if (!request.accelerator && gpuCount !== 0) {
      context.addIssue({
        code: "custom",
        path: ["gpuCount"],
        message: "GPU count requires an accelerator kind",
      });
    }
  });

export const providerCapabilitySchema = z.object({
  nodeName: z.string().min(1),
  os: z.string().min(1),
  architecture: z.string().min(1),
  cpuCores: z.number().int().positive(),
  memoryMb: z.number().int().positive(),
  networkModes: z.array(networkModeSchema),
  isolationLevels: z.array(z.enum(["CONTAINER_BASELINE", "GVISOR", "MICROVM"])),
  accelerators: z.array(acceleratorCapabilitySchema).max(16).optional(),
});

export type JobState = z.infer<typeof jobStateSchema>;
export type NetworkMode = z.infer<typeof networkModeSchema>;
export type AcceleratorCapability = z.infer<typeof acceleratorCapabilitySchema>;
export type AcceleratorKind = z.infer<typeof acceleratorKindSchema>;
export type ProviderCapability = z.infer<typeof providerCapabilitySchema>;
export type RiskTier = z.infer<typeof riskTierSchema>;
export type WorkloadRequest = z.infer<typeof workloadRequestSchema>;
