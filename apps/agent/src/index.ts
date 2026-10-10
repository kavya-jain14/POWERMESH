import os from "node:os";
import { networkModes, type ProviderCapability } from "@powermesh/contracts";

const capability: ProviderCapability = {
  nodeName: process.env.AGENT_NODE_NAME ?? os.hostname(),
  os: os.platform(),
  architecture: os.arch(),
  cpuCores: os.cpus().length,
  memoryMb: Math.floor(os.totalmem() / 1024 / 1024),
  networkModes: [...networkModes],
  isolationLevels: ["CONTAINER_BASELINE"],
};

process.stdout.write(`${JSON.stringify({ event: "AGENT_READY", capability }, null, 2)}\n`);
