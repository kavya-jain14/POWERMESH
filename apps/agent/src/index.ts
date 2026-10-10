import os from "node:os";
import type { ProviderCapability } from "@powermesh/contracts";
import { probeSandboxRuntime } from "./sandbox/runtime-probe";

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
