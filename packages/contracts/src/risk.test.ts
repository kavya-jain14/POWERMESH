import { describe, expect, it } from "vitest";
import { classifyRisk } from "./risk";
import type { WorkloadRequest } from "./schemas";

const baseline: WorkloadRequest = {
  cpu: 1,
  memoryMb: 256,
  timeoutSeconds: 60,
  networkMode: "OFFLINE",
  allowedHosts: [],
  needsHostMount: false,
  privileged: false,
  dockerSocket: false,
  deviceAccess: false,
  arbitraryImage: false,
};

describe("classifyRisk", () => {
  it("classifies a bounded offline workload as low risk", () => {
    expect(classifyRisk(baseline).tier).toBe("LOW");
  });

  it("requires review for restricted egress", () => {
    expect(classifyRisk({ ...baseline, networkMode: "RESTRICTED" }).tier).toBe("MEDIUM");
  });

  it("marks open web access as high risk and outside the MVP", () => {
    const decision = classifyRisk({ ...baseline, networkMode: "OPEN_WEB" });
    expect(decision.tier).toBe("HIGH");
    expect(decision.executableInMvp).toBe(false);
  });

  it.each(["privileged", "needsHostMount", "dockerSocket", "deviceAccess"] as const)(
    "blocks the %s escape surface",
    (field) => {
      expect(classifyRisk({ ...baseline, [field]: true }).tier).toBe("BLOCKED");
    },
  );
});
