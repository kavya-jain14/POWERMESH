import { describe, expect, it } from "vitest";
import {
  allowedJobTransitions,
  assertJobTransition,
  canTransitionJob,
  InvalidJobTransitionError,
  isTerminalJobState,
} from "./state-machine";

describe("job state machine", () => {
  it("allows the complete successful path", () => {
    const transitions = [
      ["SUBMITTED", "POLICY_CHECKED"],
      ["POLICY_CHECKED", "QUEUED"],
      ["QUEUED", "OFFERED"],
      ["OFFERED", "APPROVED"],
      ["APPROVED", "CLAIMED"],
      ["CLAIMED", "STAGING"],
      ["STAGING", "RUNNING"],
      ["RUNNING", "VALIDATING"],
      ["VALIDATING", "SUCCEEDED"],
    ] as const;

    for (const [current, next] of transitions) {
      expect(canTransitionJob(current, next)).toBe(true);
    }
  });

  it("rejects skipping consent and claim states", () => {
    expect(canTransitionJob("OFFERED", "RUNNING")).toBe(false);
    expect(() => assertJobTransition("OFFERED", "RUNNING")).toThrow(InvalidJobTransitionError);
  });

  it("keeps the coordinator-v0 policy-to-offer edge during the QUEUED migration", () => {
    expect(canTransitionJob("POLICY_CHECKED", "OFFERED")).toBe(true);
  });

  it.each([
    "REJECTED",
    "DECLINED",
    "EXPIRED",
    "SUCCEEDED",
    "FAILED",
    "CANCELLED",
    "TIMED_OUT",
  ] as const)("keeps %s terminal", (state) => {
    expect(allowedJobTransitions[state]).toHaveLength(0);
    expect(isTerminalJobState(state)).toBe(true);
  });

  it("allows one idempotent lease retry with explicit context", () => {
    const retry = {
      reasonCode: "LEASE_EXPIRED",
      idempotent: true,
      attempt: 1,
      maxAttempts: 2,
    } as const;

    expect(canTransitionJob("CLAIMED", "QUEUED", retry)).toBe(true);
    expect(canTransitionJob("STAGING", "QUEUED", retry)).toBe(true);
    expect(canTransitionJob("RUNNING", "QUEUED", retry)).toBe(true);
    expect(canTransitionJob("RUNNING", "QUEUED", { ...retry, attempt: 2 })).toBe(false);
    expect(canTransitionJob("RUNNING", "QUEUED", { ...retry, idempotent: false })).toBe(false);
    expect(canTransitionJob("RUNNING", "QUEUED")).toBe(false);
  });
});
