import type { RiskTier, WorkloadRequest } from "./schemas";

export interface RiskDecision {
  tier: RiskTier;
  reasons: string[];
  executableInMvp: boolean;
}

export function classifyRisk(workload: WorkloadRequest): RiskDecision {
  const blockedReasons: string[] = [];

  if (workload.privileged) blockedReasons.push("Privileged execution is forbidden");
  if (workload.needsHostMount) blockedReasons.push("Host filesystem mounts are forbidden");
  if (workload.dockerSocket) blockedReasons.push("Docker socket access is forbidden");
  if (workload.deviceAccess) blockedReasons.push("Raw host device access is forbidden");

  if (blockedReasons.length > 0) {
    return { tier: "BLOCKED", reasons: blockedReasons, executableInMvp: false };
  }

  if (workload.arbitraryImage || workload.networkMode === "OPEN_WEB") {
    return {
      tier: "HIGH",
      reasons: [
        workload.arbitraryImage
          ? "Unreviewed images require a stronger isolation tier"
          : "Open internet access creates uncontrolled egress",
      ],
      executableInMvp: false,
    };
  }

  if (
    workload.networkMode === "RESTRICTED" ||
    workload.cpu > 2 ||
    workload.memoryMb > 4096 ||
    workload.timeoutSeconds > 900
  ) {
    return {
      tier: "MEDIUM",
      reasons: ["The workload needs explicit provider review and stricter monitoring"],
      executableInMvp: true,
    };
  }

  return {
    tier: "LOW",
    reasons: ["Offline workload fits the default resource envelope"],
    executableInMvp: true,
  };
}
