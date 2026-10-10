import { z } from "zod";

export const terminalReasonCodes = [
  "RISK_BLOCKED",
  "ROUTE_DEDICATED_ONLY",
  "POLICY_DENIED",
  "INVALID_WORKLOAD",
  "PROVIDER_DECLINED",
  "OFFER_EXPIRED",
  "QUEUE_TIMEOUT",
  "REQUESTER_CANCEL",
  "PROVIDER_STOP",
  "ADMIN_STOP",
  "SANDBOX_START_FAILED",
  "EXECUTION_FAILED",
  "EXECUTION_TIMEOUT",
  "OUTPUT_VALIDATION_FAILED",
  "PROVIDER_OFFLINE",
  "LEASE_EXPIRED",
  "CLEANUP_FAILED",
  "INTERNAL_ERROR",
] as const;

export const terminalReasonCodeSchema = z.enum(terminalReasonCodes);

export const terminalReasonsByState = {
  REJECTED: ["RISK_BLOCKED", "ROUTE_DEDICATED_ONLY", "POLICY_DENIED", "INVALID_WORKLOAD"],
  DECLINED: ["PROVIDER_DECLINED"],
  EXPIRED: ["OFFER_EXPIRED", "QUEUE_TIMEOUT"],
  CANCELLED: ["REQUESTER_CANCEL", "PROVIDER_STOP", "ADMIN_STOP"],
  TIMED_OUT: ["EXECUTION_TIMEOUT"],
  FAILED: [
    "SANDBOX_START_FAILED",
    "EXECUTION_FAILED",
    "OUTPUT_VALIDATION_FAILED",
    "PROVIDER_OFFLINE",
    "LEASE_EXPIRED",
    "CLEANUP_FAILED",
    "INTERNAL_ERROR",
  ],
} as const satisfies Record<string, readonly TerminalReasonCode[]>;

export const terminalStateSchema = z.enum([
  "REJECTED",
  "DECLINED",
  "EXPIRED",
  "CANCELLED",
  "TIMED_OUT",
  "FAILED",
]);

export const terminalFailureSchema = z
  .object({
    state: terminalStateSchema,
    code: terminalReasonCodeSchema,
    reason: z.string().trim().min(1).max(500),
  })
  .superRefine(({ state, code }, context) => {
    const allowed: readonly TerminalReasonCode[] = terminalReasonsByState[state];
    if (!allowed.includes(code)) {
      context.addIssue({
        code: "custom",
        path: ["code"],
        message: `${code} is not valid for terminal state ${state}`,
      });
    }
  });

export const protocolTiming = {
  sseHeartbeatSeconds: 5,
  sseStaleAfterSeconds: 12,
  agentHeartbeatSeconds: 5,
  executionLeaseSeconds: 30,
  leaseExpiryGraceSeconds: 10,
  offerTtlSeconds: 60,
  artifactUrlTtlSeconds: 600,
} as const;

export type TerminalReasonCode = z.infer<typeof terminalReasonCodeSchema>;
export type TerminalState = z.infer<typeof terminalStateSchema>;
