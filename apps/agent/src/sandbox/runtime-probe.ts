import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import type { SandboxIsolation } from "./types";

const execFile = promisify(execFileCallback);

export interface RuntimeCapability {
  dockerAvailable: boolean;
  rootless: boolean;
  isolationLevels: SandboxIsolation[];
  reasons: string[];
}

export async function probeSandboxRuntime(): Promise<RuntimeCapability> {
  if (process.platform !== "linux") {
    return {
      dockerAvailable: false,
      rootless: false,
      isolationLevels: [],
      reasons: [
        "Provider execution requires a Linux host; macOS/Windows may run requester clients only",
      ],
    };
  }

  try {
    const [{ stdout: security }, { stdout: runtimes }] = await Promise.all([
      execFile("docker", ["info", "--format", "{{json .SecurityOptions}}"], { timeout: 5_000 }),
      execFile("docker", ["info", "--format", "{{json .Runtimes}}"], { timeout: 5_000 }),
    ]);
    const rootless = /rootless/i.test(security);
    const hasRunsc = /"runsc"\s*:/.test(runtimes);
    const reasons: string[] = [];
    if (!rootless) reasons.push("Docker daemon is not running in rootless mode");
    if (!hasRunsc) reasons.push("gVisor runsc runtime is not installed");
    return {
      dockerAvailable: true,
      rootless,
      isolationLevels: rootless
        ? ["CONTAINER_BASELINE", ...(hasRunsc ? (["GVISOR"] as const) : [])]
        : [],
      reasons,
    };
  } catch {
    return {
      dockerAvailable: false,
      rootless: false,
      isolationLevels: [],
      reasons: ["Docker daemon is unavailable"],
    };
  }
}
