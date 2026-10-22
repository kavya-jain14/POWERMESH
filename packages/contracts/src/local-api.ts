import { z } from "zod";
import { artifactSchema } from "./artifacts";
import { isolationCapabilitySchema, isolationLevelSchema } from "./capabilities";
import { imageDigestSchema, workloadParamsSchema } from "./entities";
import { agentStopEventTypeSchema, jobProgressSchema, resourceUsageSchema } from "./events";
import { providerNodeStatusSchema, providerPolicySchema } from "./provider";
import { jobStateSchema, networkModeSchema, riskTierSchema } from "./schemas";
import { terminalReasonCodeSchema } from "./terminal";

const localTimestampSchema = z.string().datetime({ offset: true });

export const localResourceLimitsSchema = z.object({
  cpuCores: z.number().positive(),
  memoryBytes: z.number().int().positive(),
  diskBytes: z.number().int().positive().nullable(),
  timeoutSeconds: z.number().int().positive(),
  pidLimit: z.number().int().positive().nullable(),
  maxOutputBytes: z.number().int().positive().nullable(),
});

export const localRiskExplanationSchema = z.object({
  tier: riskTierSchema,
  facts: z.array(
    z.object({
      code: z.string().trim().min(1).max(80),
      label: z.string().trim().min(1).max(200),
      effect: z.enum(["lowers", "raises", "blocks"]),
      detail: z.string().trim().min(1).max(500).optional(),
    }),
  ),
  policyVersion: z.string().trim().min(1).max(80),
  decidedAt: localTimestampSchema,
});

export const agentLocalNodeSchema = z.object({
  id: z.string().uuid(),
  ownerId: z.string().uuid(),
  ownerLabel: z.string().trim().min(1).max(100),
  label: z.string().trim().min(1).max(100),
  os: z.enum(["linux", "windows", "macos"]),
  arch: z.enum(["amd64", "arm64"]),
  agentVersion: z.string().trim().min(1).max(40),
  trustTier: z.enum(["community", "verified", "dedicated"]),
  heartbeatAt: localTimestampSchema,
  status: providerNodeStatusSchema,
  capability: z.object({
    runtime: isolationLevelSchema,
    cpuCores: z.number().positive(),
    memoryBytes: z.number().int().positive(),
    diskBytes: z.number().int().positive(),
    accelerator: z.enum(["none", "cuda", "metal"]),
    networkModes: z.array(networkModeSchema),
    isolation: isolationCapabilitySchema,
  }),
});

export const agentLocalOfferSchema = z.object({
  id: z.string().uuid(),
  jobId: z.string().uuid(),
  workload: z.object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(80),
    version: z.string().trim().min(1).max(40),
    digest: imageDigestSchema,
    signatureVerified: z.boolean(),
    publisher: z.string().trim().min(1).max(100),
    summary: z.string().trim().min(1).max(500),
  }),
  inputs: z.object({
    count: z.number().int().nonnegative(),
    contentTypes: z.array(z.string().trim().min(1).max(255)),
    totalBytes: z.number().int().nonnegative().nullable(),
  }),
  inputDigest: imageDigestSchema.optional(),
  params: workloadParamsSchema,
  limits: localResourceLimitsSchema,
  networkMode: networkModeSchema,
  risk: localRiskExplanationSchema,
  requesterLabel: z.string().trim().min(1).max(100),
  createdAt: localTimestampSchema,
  expiresAt: localTimestampSchema,
  status: z.enum(["pending", "approved", "auto_approved", "declined", "expired", "withdrawn"]),
  policyRule: z
    .object({
      code: z.string().trim().min(1).max(80),
      label: z.string().trim().min(1).max(200),
      policyVersion: z.string().trim().min(1).max(80),
    })
    .nullable(),
  decidedAt: localTimestampSchema.optional(),
});

export const agentLocalJobSchema = z.object({
  id: z.string().uuid(),
  state: jobStateSchema,
  requesterLabel: z.string().trim().min(1).max(100),
  workload: z.object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(80),
    version: z.string().trim().min(1).max(40),
    digest: imageDigestSchema,
  }),
  inputs: z.object({
    count: z.number().int().nonnegative(),
    contentTypes: z.array(z.string().trim().min(1).max(255)),
    totalBytes: z.number().int().nonnegative().nullable(),
  }),
  params: workloadParamsSchema,
  limits: localResourceLimitsSchema,
  networkMode: networkModeSchema,
  accelerator: z.enum(["none", "cuda", "metal"]).optional(),
  risk: localRiskExplanationSchema,
  attempt: z.number().int().min(1).max(2),
  maxAttempts: z.literal(2),
  assignment: z
    .object({
      nodeId: z.string().uuid().optional(),
      nodeLabel: z.string().trim().min(1).max(100),
      os: z.string().trim().min(1).max(40),
      architecture: z.string().trim().min(1).max(40),
      isolation: isolationLevelSchema,
      leaseUntil: localTimestampSchema,
    })
    .nullable(),
  progress: jobProgressSchema.nullable(),
  usage: resourceUsageSchema.nullable(),
  artifacts: z.array(artifactSchema),
  failure: z
    .object({ code: terminalReasonCodeSchema, reason: z.string().trim().min(1).max(500) })
    .nullable(),
  stoppedBy: z
    .object({
      role: z.enum(["requester", "provider", "admin"]),
      label: z.string().trim().min(1).max(100),
      reasonCode: z.enum(["REQUESTER_CANCEL", "PROVIDER_STOP", "ADMIN_STOP"]),
    })
    .nullable(),
  createdAt: localTimestampSchema,
  updatedAt: localTimestampSchema,
});

export const agentLocalStateSchema = z.object({
  agent: z.object({ version: z.string().trim().min(1).max(40), startedAt: localTimestampSchema }),
  coordinator: z.object({ reachable: z.boolean(), lastContactAt: localTimestampSchema }),
  node: agentLocalNodeSchema,
  policy: providerPolicySchema.extend({
    nodeId: z.string().uuid(),
    updatedAt: localTimestampSchema,
  }),
  pendingOffer: agentLocalOfferSchema.nullable(),
  activeJob: agentLocalJobSchema.nullable(),
  lastJob: agentLocalJobSchema.nullable(),
  stop: z
    .object({
      jobId: z.string().uuid(),
      requestedAt: localTimestampSchema,
      steps: z.array(z.object({ step: agentStopEventTypeSchema, at: localTimestampSchema })),
    })
    .nullable(),
});

export const agentPairRequestSchema = z.object({
  code: z.string().regex(/^\d{6}$/),
});

export const agentPairResponseSchema = z.object({ paired: z.literal(true) });
export const agentLocalStopRequestSchema = z
  .object({ jobId: z.string().uuid().optional() })
  .default({});
export const agentAvailabilityRequestSchema = z.object({ available: z.boolean() });
export const agentOfferDecisionRequestSchema = z.object({
  decision: z.enum(["approve", "decline"]),
});

export type AgentAvailabilityRequest = z.infer<typeof agentAvailabilityRequestSchema>;
export type AgentLocalJob = z.infer<typeof agentLocalJobSchema>;
export type AgentLocalNode = z.infer<typeof agentLocalNodeSchema>;
export type AgentLocalOffer = z.infer<typeof agentLocalOfferSchema>;
export type AgentLocalState = z.infer<typeof agentLocalStateSchema>;
export type AgentLocalStopRequest = z.infer<typeof agentLocalStopRequestSchema>;
export type AgentOfferDecisionRequest = z.infer<typeof agentOfferDecisionRequestSchema>;
export type AgentPairRequest = z.infer<typeof agentPairRequestSchema>;
export type AgentPairResponse = z.infer<typeof agentPairResponseSchema>;
export type LocalResourceLimits = z.infer<typeof localResourceLimitsSchema>;
export type LocalRiskExplanation = z.infer<typeof localRiskExplanationSchema>;
