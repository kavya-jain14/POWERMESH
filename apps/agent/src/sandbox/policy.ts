import type { SignedJobOffer } from "@powermesh/contracts";
import type { RuntimeCapability } from "./runtime-probe";
import type { SandboxJob } from "./types";

export function sandboxJobFromVerifiedOffer(
  offer: SignedJobOffer,
  runtime: RuntimeCapability,
): SandboxJob {
  if (!runtime.dockerAvailable || !runtime.canExecute)
    throw new Error("EXECUTION_RUNTIME_REQUIRED");
  if (offer.manifest.riskTier === "HIGH" || offer.manifest.riskTier === "BLOCKED") {
    throw new Error("RISK_TIER_NOT_EXECUTABLE");
  }
  const needsGpu = offer.manifest.resources.accelerator === "NVIDIA_CUDA";
  const gpuCount = offer.manifest.resources.gpuCount ?? 0;
  const gpuDevices = runtime.accelerators
    .filter((accelerator) => accelerator.kind === "NVIDIA_CUDA")
    .slice(0, gpuCount);
  if (needsGpu && gpuDevices.length !== gpuCount) {
    throw new Error("NVIDIA_CUDA_CAPABILITY_REQUIRED");
  }
  const isolation =
    !needsGpu && runtime.isolationLevels.includes("GVISOR") ? "GVISOR" : "CONTAINER_BASELINE";
  if (offer.manifest.riskTier === "MEDIUM" && isolation !== "GVISOR") {
    throw new Error("GVISOR_REQUIRED_FOR_MEDIUM_RISK");
  }

  return {
    jobId: offer.manifest.jobId,
    image: offer.manifest.workload.imageReference,
    isolation,
    networkMode: offer.manifest.resources.networkMode,
    allowedHosts: offer.manifest.resources.allowedHosts,
    accelerator: needsGpu
      ? { kind: "NVIDIA_CUDA", deviceIds: gpuDevices.map((device) => String(device.index)) }
      : undefined,
    command: [JSON.stringify(offer.manifest.params)],
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
