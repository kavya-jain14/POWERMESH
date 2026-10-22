import { z } from "zod";
import {
  agentEventTypeSchema,
  jobProgressSchema,
  resourceUsageSchema,
  safePayloadSchema,
} from "./events";
import { signedJobOfferSchema } from "./offers";

export const agentCommands = ["CANCEL"] as const;

export const cancelAgentCommandSchema = z.object({
  type: z.literal("CANCEL"),
  jobId: z.string().uuid(),
  reason: z.enum(["REQUESTER_CANCEL", "ADMIN_STOP"]),
});

export const agentCommandSchema = z.discriminatedUnion("type", [cancelAgentCommandSchema]);

export const heartbeatNodeSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["OFFLINE", "ONLINE", "BUSY", "DRAINING"]),
});

export const agentHeartbeatResponseSchema = z.object({
  node: heartbeatNodeSchema,
  offers: z.array(signedJobOfferSchema),
  commands: z.array(agentCommandSchema),
});

export const agentJobEventSchema = z.object({
  agentSeq: z.number().int().positive(),
  jobId: z.string().uuid(),
  type: agentEventTypeSchema,
  at: z.string().datetime({ offset: true }),
  progress: jobProgressSchema.optional(),
  usage: resourceUsageSchema.optional(),
  safePayload: safePayloadSchema.default({}),
});

export const agentEventBatchSchema = z.object({
  events: z.array(agentJobEventSchema).min(1).max(100),
});

export type AgentCommand = z.infer<typeof agentCommandSchema>;
export type AgentEventBatch = z.infer<typeof agentEventBatchSchema>;
export type AgentHeartbeatResponse = z.infer<typeof agentHeartbeatResponseSchema>;
export type AgentJobEvent = z.infer<typeof agentJobEventSchema>;
export type HeartbeatNode = z.infer<typeof heartbeatNodeSchema>;
