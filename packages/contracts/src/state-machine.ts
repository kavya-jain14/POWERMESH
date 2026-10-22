import type { JobState } from "./schemas";

export const allowedJobTransitions: Readonly<Record<JobState, readonly JobState[]>> = {
  SUBMITTED: ["POLICY_CHECKED", "REJECTED", "FAILED", "CANCELLED"],
  REJECTED: [],
  // OFFERED remains a compatibility edge until the coordinator persists QUEUED in step 2.
  POLICY_CHECKED: ["QUEUED", "OFFERED", "FAILED", "CANCELLED"],
  QUEUED: ["OFFERED", "EXPIRED", "CANCELLED"],
  OFFERED: ["APPROVED", "DECLINED", "EXPIRED", "CANCELLED"],
  DECLINED: [],
  APPROVED: ["CLAIMED", "EXPIRED", "CANCELLED"],
  CLAIMED: ["STAGING", "RUNNING", "EXPIRED", "FAILED", "CANCELLED"],
  STAGING: ["RUNNING", "FAILED", "CANCELLED"],
  RUNNING: ["VALIDATING", "FAILED", "CANCELLED", "TIMED_OUT"],
  VALIDATING: ["SUCCEEDED", "FAILED", "CANCELLED"],
  SUCCEEDED: [],
  FAILED: [],
  CANCELLED: [],
  EXPIRED: [],
  TIMED_OUT: [],
};

export const terminalJobStates = [
  "REJECTED",
  "DECLINED",
  "EXPIRED",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
  "TIMED_OUT",
] as const satisfies readonly JobState[];

export const leaseRetrySourceStates = [
  "CLAIMED",
  "STAGING",
  "RUNNING",
] as const satisfies readonly JobState[];

export interface JobTransitionContext {
  reasonCode?: string;
  attempt?: number;
  maxAttempts?: number;
  idempotent?: boolean;
}

export function isTerminalJobState(state: JobState): boolean {
  return terminalJobStates.some((terminal) => terminal === state);
}

export function isLeaseRetryTransition(
  current: JobState,
  next: JobState,
  context: JobTransitionContext,
): boolean {
  return (
    next === "QUEUED" &&
    leaseRetrySourceStates.some((source) => source === current) &&
    context.reasonCode === "LEASE_EXPIRED" &&
    context.idempotent === true &&
    context.attempt !== undefined &&
    context.maxAttempts !== undefined &&
    context.attempt < context.maxAttempts
  );
}

export function canTransitionJob(
  current: JobState,
  next: JobState,
  context: JobTransitionContext = {},
): boolean {
  return (
    allowedJobTransitions[current].includes(next) || isLeaseRetryTransition(current, next, context)
  );
}

export class InvalidJobTransitionError extends Error {
  constructor(current: JobState, next: JobState) {
    super(`Job cannot transition from ${current} to ${next}`);
    this.name = "InvalidJobTransitionError";
  }
}

export function assertJobTransition(
  current: JobState,
  next: JobState,
  context: JobTransitionContext = {},
): void {
  if (!canTransitionJob(current, next, context)) {
    throw new InvalidJobTransitionError(current, next);
  }
}
