import type { SignedJobOffer } from "@powermesh/contracts";
import type { RuntimeCapability } from "./runtime-probe";
import type { SandboxJob } from "./types";

export function sandboxJobFromVerifiedOffer(
  offer: SignedJobOffer,
  runtime: RuntimeCapability,
): SandboxJob {
  if (!runtime.dockerAvailable || !runtime.rootless) throw new Error("ROOTLESS_RUNTIME_REQUIRED");
  if (offer.manifest.riskTier === "HIGH" || offer.manifest.riskTier === "BLOCKED") {
    throw new Error("RISK_TIER_NOT_EXECUTABLE");
  }
  const isolation = runtime.isolationLevels.includes("GVISOR") ? "GVISOR" : "CONTAINER_BASELINE";
  if (offer.manifest.riskTier === "MEDIUM" && isolation !== "GVISOR") {
    throw new Error("GVISOR_REQUIRED_FOR_MEDIUM_RISK");
  }

  return {
    jobId: offer.manifest.jobId,
    image: offer.manifest.workload.imageDigest,
    isolation,
    networkMode: offer.manifest.resources.networkMode,
    limits: {
      cpu: offer.manifest.resources.cpu,
      memoryMb: offer.manifest.resources.memoryMb,
      pids: 128,
      timeoutSeconds: offer.manifest.resources.timeoutSeconds,
      tmpfsMb: Math.min(1_024, Math.max(64, Math.floor(offer.manifest.resources.memoryMb / 4))),
      maxOutputBytes: offer.manifest.resources.maxOutputBytes,
    },
  };
}
