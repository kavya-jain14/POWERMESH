import type { JobState } from "./schemas";

export const allowedJobTransitions: Readonly<Record<JobState, readonly JobState[]>> = {
  SUBMITTED: ["POLICY_CHECKED", "FAILED", "CANCELLED"],
  POLICY_CHECKED: ["OFFERED", "FAILED", "CANCELLED"],
  OFFERED: ["APPROVED", "EXPIRED", "CANCELLED"],
  APPROVED: ["CLAIMED", "EXPIRED", "CANCELLED"],
  CLAIMED: ["RUNNING", "EXPIRED", "FAILED", "CANCELLED"],
  RUNNING: ["VALIDATING", "FAILED", "CANCELLED"],
  VALIDATING: ["SUCCEEDED", "FAILED"],
  SUCCEEDED: [],
  FAILED: [],
  CANCELLED: [],
  EXPIRED: [],
};

export function canTransitionJob(current: JobState, next: JobState): boolean {
  return allowedJobTransitions[current].includes(next);
}

export class InvalidJobTransitionError extends Error {
  constructor(current: JobState, next: JobState) {
    super(`Job cannot transition from ${current} to ${next}`);
    this.name = "InvalidJobTransitionError";
  }
}

export function assertJobTransition(current: JobState, next: JobState): void {
  if (!canTransitionJob(current, next)) {
    throw new InvalidJobTransitionError(current, next);
  }
}
