import { describe, expect, it } from "vitest";
import {
  allowedJobTransitions,
  assertJobTransition,
  canTransitionJob,
  InvalidJobTransitionError,
} from "./state-machine";

describe("job state machine", () => {
  it("allows the complete successful path", () => {
    const transitions = [
      ["SUBMITTED", "POLICY_CHECKED"],
      ["POLICY_CHECKED", "OFFERED"],
      ["OFFERED", "APPROVED"],
      ["APPROVED", "CLAIMED"],
      ["CLAIMED", "RUNNING"],
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

  it.each(["SUCCEEDED", "FAILED", "CANCELLED", "EXPIRED"] as const)(
    "keeps %s terminal",
    (state) => {
      expect(allowedJobTransitions[state]).toHaveLength(0);
    },
  );
});
