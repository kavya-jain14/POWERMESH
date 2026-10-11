import os from "node:os";
import type { ProviderCapability } from "@powermesh/contracts";
import { EgressNetworkController } from "./egress/docker-network";
import { loadAgentTrust } from "./enrollment";
import { AgentJobLoop } from "./job-loop";
import { SandboxExecutor } from "./sandbox/docker";
import { probeSandboxRuntime } from "./sandbox/runtime-probe";
import { SystemCredentialStore } from "./secure-store";
import { AgentTrustStore } from "./trust";

const runtime = await probeSandboxRuntime();
const capability: ProviderCapability = {
  nodeName: process.env.AGENT_NODE_NAME ?? os.hostname(),
  os: os.platform(),
  architecture: os.arch(),
  cpuCores: os.cpus().length,
  memoryMb: Math.floor(os.totalmem() / 1024 / 1024),
  networkModes: runtime.dockerAvailable && runtime.rootless ? ["OFFLINE"] : [],
  isolationLevels: runtime.isolationLevels,
};

process.stdout.write(`${JSON.stringify({ event: "AGENT_READY", capability, runtime }, null, 2)}\n`);

const endpoint = process.env.POWERMESH_COORDINATOR_URL;
const nodeId = process.env.POWERMESH_NODE_ID;
if (endpoint && nodeId && runtime.dockerAvailable && runtime.rootless) {
  const trust = new AgentTrustStore(new SystemCredentialStore());
  const enrolled = await loadAgentTrust(endpoint, trust);
  const executor = new SandboxExecutor();
  const proxyImage = process.env.POWERMESH_EGRESS_PROXY_IMAGE;
  const egress = proxyImage ? new EgressNetworkController(proxyImage) : undefined;
  let loop: AgentJobLoop;
  loop = new AgentJobLoop({
    origin: enrolled.origin,
    agentToken: enrolled.agentToken,
    coordinatorPublicKey: enrolled.publicKey,
    nodeId,
    runtime,
    executor,
    egress,
    heartbeat: () => ({
      availableCpu: Math.max(0, capability.cpuCores - loop.activeJobCount()),
      availableMemoryMb: Math.max(0, capability.memoryMb - loop.activeJobCount() * 512),
      activeJobs: loop.activeJobCount(),
      status: loop.activeJobCount() > 0 ? "BUSY" : "ONLINE",
    }),
    approveOffer: async (offer) => {
      const autoApproveLowRisk = process.env.POWERMESH_AUTO_APPROVE_LOW_RISK === "true";
      return autoApproveLowRisk && offer.manifest.riskTier === "LOW";
    },
  });
  const stop = () => loop.stop();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  await loop.runUntilStopped();
}
