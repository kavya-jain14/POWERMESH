import { z } from "zod";
import { networkModeSchema } from "./schemas";

export const providerNodeStatuses = ["offline", "available", "busy", "paused"] as const;
export const providerNodeStatusSchema = z.enum(providerNodeStatuses);

const timezoneSchema = z
  .string()
  .trim()
  .min(1)
  .refine(
    (timezone) => {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: timezone });
        return true;
      } catch {
        return false;
      }
    },
    { message: "Expected an IANA timezone" },
  );

const localTimeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);

const scheduleSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("always"), timezone: timezoneSchema }),
  z
    .object({
      mode: z.literal("window"),
      start: localTimeSchema,
      end: localTimeSchema,
      timezone: timezoneSchema,
    })
    .refine(({ start, end }) => start !== end, {
      path: ["end"],
      message: "Schedule start and end must differ",
    }),
]);

export const providerPolicySchema = z.object({
  allowedWorkloads: z.array(z.string().trim().min(1)).max(100),
  riskMax: z.enum(["LOW", "MEDIUM"]),
  consentMode: z.enum(["ask", "auto"]),
  schedule: scheduleSchema,
  networkModes: z.array(networkModeSchema.extract(["OFFLINE", "RESTRICTED"])).min(1),
  resourceCaps: z.object({
    cpuCores: z.number().positive().max(256),
    memoryBytes: z.number().int().positive(),
    diskBytes: z.number().int().positive(),
    timeoutSeconds: z.number().int().positive().max(86_400),
    pidLimit: z.number().int().positive(),
    maxOutputBytes: z.number().int().positive(),
  }),
});

export type ProviderNodeStatus = z.infer<typeof providerNodeStatusSchema>;
export type ProviderPolicy = z.infer<typeof providerPolicySchema>;
