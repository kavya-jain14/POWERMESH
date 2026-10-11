import { execFile as execFileCallback } from "node:child_process";
import os from "node:os";
import { promisify } from "node:util";
import type { AcceleratorCapability } from "@powermesh/contracts";
import type { SandboxIsolation } from "./types";

const execFile = promisify(execFileCallback);

export interface RuntimeCapability {
  dockerAvailable: boolean;
  rootless: boolean;
  canExecute: boolean;
  executionMode: "ROOTLESS_LINUX" | "WSL2_DOCKER_DESKTOP" | "UNAVAILABLE";
  accelerators: AcceleratorCapability[];
  isolationLevels: SandboxIsolation[];
  reasons: string[];
}

export function parseNvidiaSmi(output: string): AcceleratorCapability[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const [index, name, memoryMb, uuid, driverVersion] = line
        .split(",")
        .map((part) => part.trim());
      const parsedIndex = Number(index);
      const parsedMemory = Math.round(Number(memoryMb));
      if (
        !Number.isInteger(parsedIndex) ||
        parsedIndex < 0 ||
        !name ||
        !Number.isFinite(parsedMemory) ||
        parsedMemory <= 0
      ) {
        return [];
      }
      return [
        {
          kind: "NVIDIA_CUDA" as const,
          index: parsedIndex,
          name,
          memoryMb: parsedMemory,
          ...(uuid ? { uuid } : {}),
          ...(driverVersion ? { driverVersion } : {}),
        },
      ];
    });
}

async function probeNvidia(): Promise<AcceleratorCapability[]> {
  const commands = ["nvidia-smi", "/usr/lib/wsl/lib/nvidia-smi"];
  for (const command of commands) {
    try {
      const { stdout } = await execFile(
        command,
        [
          "--query-gpu=index,name,memory.total,uuid,driver_version",
          "--format=csv,noheader,nounits",
        ],
        { timeout: 5_000 },
      );
      return parseNvidiaSmi(stdout);
    } catch {
      // WSL2 commonly exposes the Windows GPU binary outside PATH.
    }
  }
  return [];
}

export async function probeSandboxRuntime(): Promise<RuntimeCapability> {
  if (process.platform !== "linux") {
    return {
      dockerAvailable: false,
      rootless: false,
      canExecute: false,
      executionMode: "UNAVAILABLE",
      accelerators: [],
      isolationLevels: [],
      reasons: [
        "Provider execution requires a Linux host; macOS/Windows may run requester clients only",
      ],
    };
  }

  try {
    const [{ stdout: security }, { stdout: runtimes }, accelerators] = await Promise.all([
      execFile("docker", ["info", "--format", "{{json .SecurityOptions}}"], { timeout: 5_000 }),
      execFile("docker", ["info", "--format", "{{json .Runtimes}}"], { timeout: 5_000 }),
      probeNvidia(),
    ]);
    const rootless = /rootless/i.test(security);
    const hasRunsc = /"runsc"\s*:/.test(runtimes);
    const isWsl2 = /microsoft/i.test(os.release());
    const allowDesktopSandbox = process.env.POWERMESH_ALLOW_DESKTOP_SANDBOX === "true";
    const desktopDemo = isWsl2 && allowDesktopSandbox;
    const canExecute = rootless || desktopDemo;
    const reasons: string[] = [];
    if (!rootless) reasons.push("Docker daemon is not running in rootless mode");
    if (desktopDemo) {
      reasons.push("WSL2 Docker Desktop demo mode is enabled; this is not rootless isolation");
    }
    if (!hasRunsc) reasons.push("gVisor runsc runtime is not installed");
    return {
      dockerAvailable: true,
      rootless,
      canExecute,
      executionMode: rootless
        ? "ROOTLESS_LINUX"
        : desktopDemo
          ? "WSL2_DOCKER_DESKTOP"
          : "UNAVAILABLE",
      accelerators,
      isolationLevels: canExecute
        ? ["CONTAINER_BASELINE", ...(hasRunsc ? (["GVISOR"] as const) : [])]
        : [],
      reasons,
    };
  } catch {
    return {
      dockerAvailable: false,
      rootless: false,
      canExecute: false,
      executionMode: "UNAVAILABLE",
      accelerators: [],
      isolationLevels: [],
      reasons: ["Docker daemon is unavailable"],
    };
  }
}
