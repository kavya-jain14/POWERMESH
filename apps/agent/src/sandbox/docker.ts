import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { SandboxJob, SandboxResult } from "./types";

const PINNED_IMAGE =
  /^(?:sha256:[a-f0-9]{64}|[a-z0-9][a-z0-9._/-]*(?::[a-zA-Z0-9._-]+)?@sha256:[a-f0-9]{64})$/;

function assertLimits(job: SandboxJob): void {
  const { cpu, memoryMb, pids, timeoutSeconds, tmpfsMb, maxOutputBytes } = job.limits;
  if (!Number.isFinite(cpu) || cpu <= 0 || cpu > 16) throw new Error("Invalid CPU limit");
  if (!Number.isInteger(memoryMb) || memoryMb < 64 || memoryMb > 32_768) {
    throw new Error("Invalid memory limit");
  }
  if (!Number.isInteger(pids) || pids < 1 || pids > 1_024) throw new Error("Invalid PID limit");
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 3_600) {
    throw new Error("Invalid timeout limit");
  }
  if (!Number.isInteger(tmpfsMb) || tmpfsMb < 1 || tmpfsMb > 1_024) {
    throw new Error("Invalid temporary filesystem limit");
  }
  if (
    !Number.isInteger(maxOutputBytes) ||
    maxOutputBytes < 1 ||
    maxOutputBytes > 50 * 1024 * 1024
  ) {
    throw new Error("Invalid output limit");
  }
}

export function buildDockerArgs(job: SandboxJob, containerName: string): string[] {
  if (!PINNED_IMAGE.test(job.image))
    throw new Error("Sandbox images must be pinned by SHA-256 digest");
  assertLimits(job);
  if (job.networkMode === "OPEN_WEB") throw new Error("Open web execution is forbidden");
  if (job.networkMode === "RESTRICTED" && !job.restrictedNetwork) {
    throw new Error("Networked jobs require the controlled egress runtime");
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(containerName)) {
    throw new Error("Invalid container name");
  }

  const args = [
    "run",
    "--rm",
    "--name",
    containerName,
    "--label",
    `io.powermesh.job=${job.jobId}`,
    ...(job.networkMode === "OFFLINE"
      ? ["--network=none"]
      : [
          `--network=${job.restrictedNetwork?.networkName}`,
          `--ip=${job.restrictedNetwork?.workloadIp}`,
          "--dns=127.0.0.1",
          "--env",
          `HTTP_PROXY=http://${job.restrictedNetwork?.proxyIp}:8080`,
          "--env",
          `HTTPS_PROXY=http://${job.restrictedNetwork?.proxyIp}:8080`,
          "--env",
          "NO_PROXY=",
        ]),
    "--read-only",
    ...(job.accelerator ? ["--gpus", `device=${job.accelerator.deviceIds.join(",")}`] : []),
    "--user=65532:65532",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges=true",
    `--pids-limit=${job.limits.pids}`,
    `--memory=${job.limits.memoryMb}m`,
    `--memory-swap=${job.limits.memoryMb}m`,
    `--cpus=${job.limits.cpu}`,
    `--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=${job.limits.tmpfsMb}m`,
  ];
  if (job.isolation === "GVISOR") args.push("--runtime=runsc");
  args.push(job.image, ...(job.command ?? []));
  return args;
}

export type SpawnAdapter = (
  command: string,
  args: readonly string[],
) => ChildProcessWithoutNullStreams;

export class SandboxExecutor {
  private readonly running = new Map<
    string,
    { child: ChildProcessWithoutNullStreams; name: string }
  >();

  constructor(
    private readonly spawnProcess: SpawnAdapter = (command, args) =>
      spawn(command, args, { shell: false, stdio: "pipe" }),
  ) {}

  async execute(job: SandboxJob, signal?: AbortSignal): Promise<SandboxResult> {
    signal?.throwIfAborted();
    const name = `powermesh-${job.jobId.replace(/[^a-zA-Z0-9_.-]/g, "-").slice(0, 72)}-${randomUUID().slice(0, 8)}`;
    const child = this.spawnProcess("docker", buildDockerArgs(job, name));
    child.stdin.end();
    this.running.set(job.jobId, { child, name });

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let captured = 0;
    let outputTruncated = false;
    let timedOut = false;
    const capture = (target: Buffer[]) => (chunk: Buffer) => {
      const remaining = job.limits.maxOutputBytes - captured;
      if (remaining <= 0) {
        outputTruncated = true;
        this.kill(job.jobId);
        return;
      }
      const kept = chunk.subarray(0, remaining);
      target.push(kept);
      captured += kept.length;
      if (kept.length < chunk.length) {
        outputTruncated = true;
        this.kill(job.jobId);
      }
    };
    child.stdout.on("data", capture(stdout));
    child.stderr.on("data", capture(stderr));

    const stop = () => void this.kill(job.jobId);
    signal?.addEventListener("abort", stop, { once: true });
    if (signal?.aborted) stop();
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, job.limits.timeoutSeconds * 1_000);
    timer.unref();

    try {
      const exitCode = await new Promise<number | null>((resolve, reject) => {
        child.once("error", reject);
        child.once("close", resolve);
      });
      return {
        exitCode,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
        timedOut,
        outputTruncated,
      };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", stop);
      this.running.delete(job.jobId);
    }
  }

  kill(jobId: string): boolean {
    const execution = this.running.get(jobId);
    if (!execution) return false;
    execution.child.kill("SIGKILL");
    const killer = this.spawnProcess("docker", ["kill", execution.name]);
    killer.on("error", () => undefined);
    return true;
  }

  killAll(): void {
    for (const jobId of this.running.keys()) this.kill(jobId);
  }
}
