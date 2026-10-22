import { z } from "zod";
import { jobStateSchema } from "./schemas";
import { terminalReasonCodes } from "./terminal";

export const actorRoles = ["requester", "provider", "agent", "admin", "system"] as const;
export const actorSchema = z.object({
  role: z.enum(actorRoles),
  label: z.string().trim().min(1).max(100),
});

export const agentEventTypes = [
  "STAGING",
  "RUNNING",
  "PROGRESS",
  "NETWORK_REVOKED",
  "TERMINATION_REQUESTED",
  "PROCESS_KILLED",
  "WORKSPACE_CLEANED",
] as const;
export const agentEventTypeSchema = z.enum(agentEventTypes);

export const agentStopEventTypes = [
  "NETWORK_REVOKED",
  "TERMINATION_REQUESTED",
  "PROCESS_KILLED",
  "WORKSPACE_CLEANED",
] as const;
export const agentStopEventTypeSchema = z.enum(agentStopEventTypes);

export const jobEventTypes = ["state", "progress", "log"] as const;
export const jobEventTypeSchema = z.enum(jobEventTypes);

export const jobEventReasonCodes = [
  ...terminalReasonCodes,
  "HEARTBEAT_MISSED",
  ...agentEventTypes,
] as const;
export const jobEventReasonCodeSchema = z.enum(jobEventReasonCodes);

export const jobProgressSchema = z.object({
  done: z.number().nonnegative(),
  total: z.number().positive(),
  unit: z.string().trim().min(1).max(40).optional(),
});

export const resourceUsageSchema = z.object({
  cpuCores: z.number().nonnegative(),
  memoryBytes: z.number().int().nonnegative(),
  diskBytes: z.number().int().nonnegative(),
  elapsedSeconds: z.number().nonnegative(),
});

export const safePayloadSchema = z.record(z.string().min(1).max(80), z.unknown());

export const jobEventSchema = z.object({
  seq: z.number().int().positive(),
  id: z.string().uuid(),
  jobId: z.string().uuid(),
  type: jobEventTypeSchema,
  state: jobStateSchema.optional(),
  prevState: jobStateSchema.optional(),
  progress: jobProgressSchema.optional(),
  usage: resourceUsageSchema.optional(),
  message: z.string().trim().min(1).max(500).optional(),
  reasonCode: jobEventReasonCodeSchema.optional(),
  actor: actorSchema,
  at: z.string().datetime({ offset: true }),
  correlationId: z.string().uuid(),
  attempt: z.number().int().min(1).max(2),
  safePayload: safePayloadSchema.default({}),
});

export const sseHeartbeatSchema = z.object({
  at: z.string().datetime({ offset: true }),
});

export type Actor = z.infer<typeof actorSchema>;
export type AgentEventType = z.infer<typeof agentEventTypeSchema>;
export type AgentStopEventType = z.infer<typeof agentStopEventTypeSchema>;
export type JobEvent = z.infer<typeof jobEventSchema>;
export type JobEventReasonCode = z.infer<typeof jobEventReasonCodeSchema>;
export type JobEventType = z.infer<typeof jobEventTypeSchema>;
export type JobProgress = z.infer<typeof jobProgressSchema>;
export type ResourceUsage = z.infer<typeof resourceUsageSchema>;
export type SseHeartbeat = z.infer<typeof sseHeartbeatSchema>;
