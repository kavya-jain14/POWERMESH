import { createHash } from "node:crypto";
import {
  agentHeartbeatResponseSchema,
  type GpuBenchmarkResult,
  gpuBenchmarkResultSchema,
  type ProviderHeartbeat,
  protocolTiming,
  type SignedJobOffer,
  signedJobOfferSchema,
} from "@powermesh/contracts";
import { z } from "zod";
import type { EgressNetworkController } from "./egress/docker-network";
import { verifyCoordinatorOffer } from "./offer-verification";
import { validateOutput } from "./sandbox/output-validator";
import { sandboxJobFromVerifiedOffer } from "./sandbox/policy";
import { executeSandboxJob, type SandboxExecutionAdapter } from "./sandbox/runner";
import type { RuntimeCapability } from "./sandbox/runtime-probe";
import type { SandboxResult } from "./sandbox/types";

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

const offerResponseSchema = z.object({ offer: signedJobOfferSchema });

export type JobLoopOutcome =
  | { offerId: string; status: "DECLINED" }
  | { offerId: string; status: "SUCCEEDED" | "FAILED" }
  | { offerId: string; status: "REJECTED"; reason: string };

export interface AgentJobLoopOptions {
  origin: string;
  nodeId: string;
  agentToken: string;
  coordinatorPublicKey: string;
  runtime: RuntimeCapability;
  executor: SandboxExecutionAdapter;
  heartbeat: () => ProviderHeartbeat;
  approveOffer: (offer: SignedJobOffer) => Promise<boolean>;
  egress?: EgressNetworkController;
  fetcher?: Fetcher;
  pollIntervalMs?: number;
}

function outputSummary(data: Buffer) {
  return {
    sizeBytes: data.length,
    digest: `sha256:${createHash("sha256").update(data).digest("hex")}` as const,
  };
}

function validateWorkloadOutput(
  offer: SignedJobOffer,
  result: SandboxResult,
): { valid: boolean; resultSummary?: GpuBenchmarkResult } {
  if (result.exitCode !== 0 || result.timedOut || result.outputTruncated) return { valid: false };
  if (offer.manifest.workload.name === "gpu-benchmark") {
    try {
      validateOutput(
        "gpu-benchmark.json",
        "application/json",
        result.stdout,
        offer.manifest.resources.maxOutputBytes,
      );
      const resultSummary = gpuBenchmarkResultSchema.parse(
        JSON.parse(result.stdout.toString("utf8")),
      );
      if (
        resultSummary.matrixSize !== Number(offer.manifest.params.matrixSize) ||
        resultSummary.iterations !== Number(offer.manifest.params.iterations)
      ) {
        return { valid: false };
      }
      return { valid: true, resultSummary };
    } catch {
      return { valid: false };
    }
  }
  if (offer.manifest.workload.name !== "image-transform") return { valid: false };
  const format = offer.manifest.params.format;
  const contentType =
    format === "png" ? "image/png" : format === "jpeg" ? "image/jpeg" : "image/webp";
  const extension = format === "jpeg" ? "jpg" : String(format);
  try {
    validateOutput(
      `output.${extension}`,
      contentType,
      result.stdout,
      offer.manifest.resources.maxOutputBytes,
    );
    return { valid: true };
  } catch {
    return { valid: false };
  }
}

function completionFromResult(
  result: SandboxResult,
  outputValidated: boolean,
  resultSummary?: GpuBenchmarkResult,
) {
  return {
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    outputTruncated: result.outputTruncated,
    outputValidated,
    stdout: outputSummary(result.stdout),
    stderr: outputSummary(result.stderr),
    ...(resultSummary ? { resultSummary } : {}),
  };
}

export class AgentJobLoop {
  private readonly fetcher: Fetcher;
  private readonly running = new Map<string, AbortController>();
  private stopped = false;

  constructor(private readonly options: AgentJobLoopOptions) {
    this.fetcher = options.fetcher ?? fetch;
  }

  activeJobCount(): number {
    return this.running.size;
  }

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${this.options.agentToken}`);
    if (init.body) headers.set("content-type", "application/json");
    return this.fetcher(`${this.options.origin}${path}`, { ...init, headers });
  }

  private async postJson(path: string, body?: unknown): Promise<unknown> {
    const response = await this.request(path, {
      method: "POST",
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`COORDINATOR_REQUEST_FAILED_${response.status}`);
    return response.json();
  }

  private async heartbeat() {
    const response = await this.postJson(
      `/v1/nodes/${this.options.nodeId}/heartbeat`,
      this.options.heartbeat(),
    );
    const heartbeat = agentHeartbeatResponseSchema.parse(response);
    for (const command of heartbeat.commands) {
      if (command.type === "CANCEL") this.stop(command.jobId);
    }
    return heartbeat;
  }

  private async handleOffer(untrustedOffer: SignedJobOffer): Promise<JobLoopOutcome> {
    const verification = verifyCoordinatorOffer(untrustedOffer, this.options.coordinatorPublicKey);
    if (!verification.valid) {
      return {
        offerId: untrustedOffer.id,
        status: "REJECTED",
        reason: verification.reason,
      };
    }
    let offer = verification.offer;
    if (offer.manifest.nodeId !== this.options.nodeId) {
      return { offerId: offer.id, status: "REJECTED", reason: "NODE_MISMATCH" };
    }

    if (!offer.approvedAt) {
      if (!(await this.options.approveOffer(offer))) {
        await this.postJson(`/v1/nodes/${this.options.nodeId}/offers/${offer.id}/decline`);
        return { offerId: offer.id, status: "DECLINED" };
      }
      offer = offerResponseSchema.parse(
        await this.postJson(`/v1/nodes/${this.options.nodeId}/offers/${offer.id}/approve`),
      ).offer;
    }

    offer = offerResponseSchema.parse(
      await this.postJson(`/v1/nodes/${this.options.nodeId}/offers/${offer.id}/claim`, {
        nonce: offer.manifest.nonce,
        leaseSeconds: Math.min(300, Math.max(15, offer.manifest.resources.timeoutSeconds + 10)),
      }),
    ).offer;

    await this.postJson(`/v1/nodes/${this.options.nodeId}/jobs/${offer.manifest.jobId}/start`);
    const controller = new AbortController();
    this.running.set(offer.manifest.jobId, controller);
    await this.heartbeat().catch(() => undefined);
    const heartbeatTimer = setInterval(
      () => void this.heartbeat().catch(() => undefined),
      protocolTiming.agentHeartbeatSeconds * 1_000,
    );
    heartbeatTimer.unref();
    let result: SandboxResult;
    try {
      const sandboxJob = sandboxJobFromVerifiedOffer(offer, this.options.runtime);
      result = await executeSandboxJob(
        sandboxJob,
        this.options.executor,
        this.options.egress,
        controller.signal,
      );
    } catch {
      result = {
        exitCode: null,
        stdout: Buffer.alloc(0),
        stderr: Buffer.alloc(0),
        timedOut: false,
        outputTruncated: false,
      };
    } finally {
      clearInterval(heartbeatTimer);
      this.running.delete(offer.manifest.jobId);
    }

    const validation = validateWorkloadOutput(offer, result);
    await this.postJson(
      `/v1/nodes/${this.options.nodeId}/jobs/${offer.manifest.jobId}/complete`,
      completionFromResult(result, validation.valid, validation.resultSummary),
    );
    const succeeded =
      result.exitCode === 0 && !result.timedOut && !result.outputTruncated && validation.valid;
    return { offerId: offer.id, status: succeeded ? "SUCCEEDED" : "FAILED" };
  }

  async runOnce(): Promise<JobLoopOutcome[]> {
    const heartbeat = await this.heartbeat();
    const outcomes: JobLoopOutcome[] = [];
    for (const offer of heartbeat.offers) {
      try {
        outcomes.push(await this.handleOffer(offer));
      } catch {
        outcomes.push({ offerId: offer.id, status: "REJECTED", reason: "PROCESSING_FAILED" });
      }
    }
    return outcomes;
  }

  async runUntilStopped(): Promise<void> {
    this.stopped = false;
    const interval = this.options.pollIntervalMs ?? protocolTiming.agentHeartbeatSeconds * 1_000;
    while (!this.stopped) {
      await this.runOnce().catch(() => []);
      if (this.stopped) break;
      await new Promise<void>((resolve) => {
        setTimeout(resolve, interval);
      });
    }
  }

  stop(jobId?: string): void {
    if (jobId) {
      this.running.get(jobId)?.abort();
      this.options.executor.kill(jobId);
      return;
    }
    this.stopped = true;
    for (const [runningJobId, controller] of this.running) {
      controller.abort();
      this.options.executor.kill(runningJobId);
    }
  }
}
