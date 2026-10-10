import { randomUUID } from "node:crypto";
import { assertJobTransition } from "@powermesh/contracts";
import type { CoordinatorStore, JobRecord, ProviderNodeRecord } from "./types";

export class MemoryCoordinatorStore implements CoordinatorStore {
  readonly kind = "memory" as const;
  private readonly jobs = new Map<string, JobRecord>();
  private readonly nodes = new Map<string, ProviderNodeRecord>();

  async close(): Promise<void> {}

  async createPolicyCheckedJob(
    input: Parameters<CoordinatorStore["createPolicyCheckedJob"]>[0],
    risk: Parameters<CoordinatorStore["createPolicyCheckedJob"]>[1],
  ): Promise<JobRecord> {
    const now = new Date().toISOString();
    const job: JobRecord = {
      id: randomUUID(),
      requesterId: input.requesterId,
      workload: input.workload,
      resources: input.resources,
      params: input.params,
      inputDigests: input.inputDigests,
      riskTier: risk.tier,
      state: "POLICY_CHECKED",
      createdAt: now,
      updatedAt: now,
    };
    this.jobs.set(job.id, job);
    return structuredClone(job);
  }

  async findJob(id: string): Promise<JobRecord | null> {
    const job = this.jobs.get(id);
    return job ? structuredClone(job) : null;
  }

  async transitionJob(
    id: string,
    nextState: Parameters<CoordinatorStore["transitionJob"]>[1],
    _actor: string,
    _correlationId: string,
    _safePayload: Record<string, unknown> = {},
  ): Promise<JobRecord | null> {
    const job = this.jobs.get(id);
    if (!job) return null;

    assertJobTransition(job.state, nextState);
    const updated = { ...job, state: nextState, updatedAt: new Date().toISOString() };
    this.jobs.set(id, updated);
    return structuredClone(updated);
  }

  async registerProvider(
    input: Parameters<CoordinatorStore["registerProvider"]>[0],
  ): Promise<ProviderNodeRecord> {
    const existing = [...this.nodes.values()].find(
      (node) => node.ownerId === input.ownerId && node.nodeName === input.nodeName,
    );
    const now = new Date().toISOString();
    const node: ProviderNodeRecord = {
      ...input,
      id: existing?.id ?? randomUUID(),
      availableCpu: existing?.availableCpu ?? 0,
      availableMemoryMb: existing?.availableMemoryMb ?? 0,
      activeJobs: existing?.activeJobs ?? 0,
      status: existing?.status ?? "OFFLINE",
      lastHeartbeatAt: existing?.lastHeartbeatAt ?? null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.nodes.set(node.id, node);
    return structuredClone(node);
  }

  async heartbeatProvider(
    id: string,
    heartbeat: Parameters<CoordinatorStore["heartbeatProvider"]>[1],
  ): Promise<ProviderNodeRecord | null> {
    const node = this.nodes.get(id);
    if (!node) return null;

    const now = new Date().toISOString();
    const updated: ProviderNodeRecord = {
      ...node,
      ...heartbeat,
      lastHeartbeatAt: now,
      updatedAt: now,
    };
    this.nodes.set(id, updated);
    return structuredClone(updated);
  }
}
