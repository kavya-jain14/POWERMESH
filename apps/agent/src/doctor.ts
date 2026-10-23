import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { coordinatorOrigin } from "./enrollment";
import { probeSandboxRuntime, type RuntimeCapability } from "./sandbox/runtime-probe";
import { publicKeyFingerprint } from "./trust";

const execFile = promisify(execFileCallback);

const healthSchema = z.object({ status: z.literal("ok"), service: z.literal("powermesh-api") });
const signingKeySchema = z.object({
  algorithm: z.literal("Ed25519"),
  publicKey: z.string().includes("BEGIN PUBLIC KEY"),
});

export interface DoctorCheck {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
}

export interface DoctorReport {
  ready: boolean;
  coordinatorOrigin: string | null;
  checks: DoctorCheck[];
}

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

interface DoctorOptions {
  coordinatorUrl: string;
  requireGpu?: boolean;
  gpuProbeImage?: string;
  fetcher?: Fetcher;
  runtimeProbe?: () => Promise<RuntimeCapability>;
  gpuContainerProbe?: (image: string) => Promise<string>;
}

async function fetchJson(fetcher: Fetcher, url: string): Promise<unknown> {
  const response = await fetcher(url, { signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error(`HTTP_${response.status}`);
  return response.json();
}

async function defaultGpuContainerProbe(image: string): Promise<string> {
  const { stdout } = await execFile(
    "docker",
    [
      "run",
      "--rm",
      "--pull=missing",
      "--gpus",
      "all",
      image,
      "nvidia-smi",
      "--query-gpu=name",
      "--format=csv,noheader",
    ],
    { timeout: 180_000, maxBuffer: 1024 * 1024 },
  );
  const gpuNames = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (gpuNames.length === 0) throw new Error("NO_GPU_VISIBLE_IN_CONTAINER");
  return gpuNames.join(", ");
}

function result(id: string, label: string, ok: boolean, detail: string): DoctorCheck {
  return { id, label, ok, detail };
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : "UNKNOWN_ERROR";
}

export async function runAgentDoctor(options: DoctorOptions): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  let origin: string | null = null;
  try {
    origin = coordinatorOrigin(options.coordinatorUrl);
    checks.push(result("coordinator-url", "Coordinator uses an allowed origin", true, origin));
  } catch (error) {
    checks.push(
      result("coordinator-url", "Coordinator uses an allowed origin", false, errorDetail(error)),
    );
  }

  const fetcher = options.fetcher ?? fetch;
  if (origin) {
    const [health, signingKey] = await Promise.allSettled([
      fetchJson(fetcher, `${origin}/health`).then((value) => healthSchema.parse(value)),
      fetchJson(fetcher, `${origin}/v1/signing-key`).then((value) => signingKeySchema.parse(value)),
    ]);
    checks.push(
      health.status === "fulfilled"
        ? result("coordinator-health", "Coordinator is reachable", true, "powermesh-api is healthy")
        : result(
            "coordinator-health",
            "Coordinator is reachable",
            false,
            errorDetail(health.reason),
          ),
    );
    checks.push(
      signingKey.status === "fulfilled"
        ? result(
            "signing-key",
            "Coordinator signing identity is available",
            true,
            publicKeyFingerprint(signingKey.value.publicKey),
          )
        : result(
            "signing-key",
            "Coordinator signing identity is available",
            false,
            errorDetail(signingKey.reason),
          ),
    );
  } else {
    checks.push(
      result("coordinator-health", "Coordinator is reachable", false, "INVALID_COORDINATOR_URL"),
      result(
        "signing-key",
        "Coordinator signing identity is available",
        false,
        "INVALID_COORDINATOR_URL",
      ),
    );
  }

  const runtime = await (options.runtimeProbe ?? probeSandboxRuntime)();
  checks.push(
    result(
      "docker",
      "Docker daemon is available",
      runtime.dockerAvailable,
      runtime.dockerAvailable ? runtime.executionMode : runtime.reasons.join("; "),
    ),
    result(
      "execution-mode",
      "Agent execution mode is enabled",
      runtime.canExecute,
      runtime.canExecute ? runtime.executionMode : runtime.reasons.join("; "),
    ),
  );

  if (options.requireGpu) {
    checks.push(
      result(
        "gpu-host",
        "NVIDIA GPU is visible to WSL/Linux",
        runtime.accelerators.length > 0,
        runtime.accelerators.length > 0
          ? runtime.accelerators.map((gpu) => `${gpu.index}: ${gpu.name}`).join(", ")
          : "NO_NVIDIA_GPU_DETECTED",
      ),
    );
    if (runtime.dockerAvailable && runtime.canExecute && runtime.accelerators.length > 0) {
      const image = options.gpuProbeImage ?? "nvidia/cuda:12.8.1-base-ubuntu24.04";
      try {
        const gpuNames = await (options.gpuContainerProbe ?? defaultGpuContainerProbe)(image);
        checks.push(result("gpu-container", "NVIDIA GPU is usable inside Docker", true, gpuNames));
      } catch (error) {
        checks.push(
          result("gpu-container", "NVIDIA GPU is usable inside Docker", false, errorDetail(error)),
        );
      }
    } else {
      checks.push(
        result(
          "gpu-container",
          "NVIDIA GPU is usable inside Docker",
          false,
          "GPU_CONTAINER_PROBE_BLOCKED",
        ),
      );
    }
  }

  return { ready: checks.every((check) => check.ok), coordinatorOrigin: origin, checks };
}
