import type { EgressNetworkController } from "../egress/docker-network";
import type { SandboxJob, SandboxResult } from "./types";

export interface SandboxExecutionAdapter {
  execute(job: SandboxJob, signal?: AbortSignal): Promise<SandboxResult>;
  kill(jobId: string): boolean;
}

export async function executeSandboxJob(
  job: SandboxJob,
  executor: SandboxExecutionAdapter,
  egress?: EgressNetworkController,
  signal?: AbortSignal,
): Promise<SandboxResult> {
  signal?.throwIfAborted();
  if (job.networkMode === "OPEN_WEB") throw new Error("OPEN_WEB_FORBIDDEN");
  if (job.networkMode === "OFFLINE") return executor.execute(job, signal);
  if (!egress) throw new Error("CONTROLLED_EGRESS_REQUIRED");

  const restrictedNetwork = await egress.prepare(job.jobId, job.allowedHosts, {
    maxRequests: 100,
    maxBytes: Math.min(1024 * 1024 * 1024, job.limits.maxOutputBytes * 4),
    timeoutMs: job.limits.timeoutSeconds * 1_000,
  });
  try {
    signal?.throwIfAborted();
    return await executor.execute({ ...job, restrictedNetwork }, signal);
  } finally {
    await egress.cleanup(job.jobId);
  }
}
