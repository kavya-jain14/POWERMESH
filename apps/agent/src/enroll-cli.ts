import os from "node:os";
import { createInterface } from "node:readline/promises";
import { enrollAgent } from "./enrollment";
import { probeSandboxRuntime } from "./sandbox/runtime-probe";
import { SystemCredentialStore } from "./secure-store";
import { AgentTrustStore } from "./trust";

const endpoint = process.env.POWERMESH_COORDINATOR_URL;
const enrollmentKey = process.env.POWERMESH_ENROLLMENT_KEY;
const ownerId = process.env.POWERMESH_OWNER_ID;

if (!endpoint || !enrollmentKey || !ownerId) {
  throw new Error(
    "POWERMESH_COORDINATOR_URL, POWERMESH_ENROLLMENT_KEY, and POWERMESH_OWNER_ID are required",
  );
}

const runtime = await probeSandboxRuntime();
if (!runtime.dockerAvailable || !runtime.canExecute) {
  throw new Error(`EXECUTION_RUNTIME_REQUIRED: ${runtime.reasons.join("; ")}`);
}

const prompt = createInterface({ input: process.stdin, output: process.stdout });
try {
  const result = await enrollAgent({
    endpoint,
    enrollmentKey,
    registration: {
      ownerId,
      nodeName: process.env.AGENT_NODE_NAME ?? os.hostname(),
      os: os.platform(),
      architecture: os.arch(),
      agentVersion: process.env.POWERMESH_AGENT_VERSION ?? "0.1.0",
      cpuCores: os.cpus().length,
      memoryMb: Math.floor(os.totalmem() / 1024 / 1024),
      networkModes: ["OFFLINE"],
      isolationLevels: runtime.isolationLevels,
      accelerators: runtime.accelerators,
    },
    trust: new AgentTrustStore(new SystemCredentialStore()),
    confirmFingerprint: async (fingerprint) => {
      const expected = process.env.POWERMESH_EXPECTED_KEY_FINGERPRINT?.toLowerCase();
      if (expected) return expected === fingerprint;
      if (!process.stdin.isTTY) return false;
      process.stdout.write(`Coordinator Ed25519 fingerprint:\n${fingerprint}\n`);
      const answer = await prompt.question("Confirm it matches the trusted coordinator (yes/no): ");
      return answer.trim().toLowerCase() === "yes";
    },
  });
  process.stdout.write(
    `${JSON.stringify({ event: "AGENT_ENROLLED", nodeId: result.nodeId, fingerprint: result.fingerprint })}\n`,
  );
} finally {
  prompt.close();
}
