import { z } from "zod";

export const isolationCapabilityLevels = ["docker-rootless", "gvisor", "microvm"] as const;
export const isolationLevelSchema = z.enum(isolationCapabilityLevels);

export const isolationProbeStatuses = ["pending", "verified", "failed", "unsupported"] as const;
export const isolationProbeStatusSchema = z.enum(isolationProbeStatuses);

export const isolationProbeFailureCodes = [
  "RUNTIME_MISSING",
  "ROOTLESS_REQUIRED",
  "PROBE_FAILED",
] as const;

export const isolationCapabilitySchema = z
  .object({
    declared: z.array(isolationLevelSchema),
    verified: z.array(isolationLevelSchema),
    probeStatus: isolationProbeStatusSchema,
    probedAt: z.string().datetime({ offset: true }).nullable(),
    failureCode: z.enum(isolationProbeFailureCodes).optional(),
  })
  .superRefine((capability, context) => {
    const declared = new Set(capability.declared);
    for (const level of capability.verified) {
      if (!declared.has(level)) {
        context.addIssue({
          code: "custom",
          path: ["verified"],
          message: "Verified isolation must also be declared",
        });
      }
    }

    if (capability.probeStatus === "verified" && capability.verified.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["verified"],
        message: "A verified probe must verify at least one isolation level",
      });
    }

    const failureExpected = capability.probeStatus === "failed";
    if (failureExpected !== (capability.failureCode !== undefined)) {
      context.addIssue({
        code: "custom",
        path: ["failureCode"],
        message: "failureCode is required only when the probe failed",
      });
    }
  });

export type IsolationLevel = z.infer<typeof isolationLevelSchema>;
export type IsolationCapability = z.infer<typeof isolationCapabilitySchema>;
