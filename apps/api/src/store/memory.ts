import { randomUUID } from "node:crypto";
import type { SignedJobOffer } from "@powermesh/contracts";
import { assertJobTransition } from "@powermesh/contracts";
import {
  type CoordinatorStore,
  type JobRecord,
  type ProviderNodeRecord,
  providerCanRunJob,
  type RequesterRecord,
  type StoreResult,
} from "./types";

interface StoredNode {
  record: ProviderNodeRecord;
  tokenHash: string;
}

interface StoredOffer {
  record: SignedJobOffer;
  nonceConsumedAt: string | null;
}

const capacityReservingStates = new Set([
  "OFFERED",
  "APPROVED",
  "CLAIMED",
  "RUNNING",
  "VALIDATING",
]);

export class MemoryCoordinatorStore implements CoordinatorStore {
  readonly kind = "memory" as const;
  private readonly jobs = new Map<string, JobRecord>();
  private readonly nodes = new Map<string, StoredNode>();
  private readonly offers = new Map<string, StoredOffer>();
  private readonly requesters = new Map<string, { record: RequesterRecord; tokenHash: string }>();

  private effectiveProviderCapacity(node: ProviderNodeRecord): ProviderNodeRecord {
    let reservedCpu = 0;
    let reservedMemoryMb = 0;
    let reservedJobs = 0;
    for (const { record: offer } of this.offers.values()) {
      if (offer.manifest.nodeId !== node.id) continue;
      const job = this.jobs.get(offer.manifest.jobId);
      if (!job || !capacityReservingStates.has(job.state)) continue;
      reservedCpu += job.resources.cpu;
      reservedMemoryMb += job.resources.memoryMb;
      reservedJobs += 1;
    }
    return {
      ...node,
      availableCpu: Math.max(0, node.availableCpu - reservedCpu),
      availableMemoryMb: Math.max(0, node.availableMemoryMb - reservedMemoryMb),
      activeJobs: Math.max(node.activeJobs, reservedJobs),
    };
  }

  async close(): Promise<void> {}

  async registerRequester(
    input: Parameters<CoordinatorStore["registerRequester"]>[0],
    tokenHash: string,
  ): Promise<RequesterRecord> {
    const now = new Date().toISOString();
    const record: RequesterRecord = {
      id: randomUUID(),
      communityId: input.communityId ?? null,
      status: "ACTIVE",
      createdAt: now,
      updatedAt: now,
    };
    this.requesters.set(record.id, { record, tokenHash });
    return structuredClone(record);
  }

  async authenticateRequester(tokenHash: string): Promise<RequesterRecord | null> {
    const requester = [...this.requesters.values()].find((entry) => entry.tokenHash === tokenHash);
    if (requester?.record.status !== "ACTIVE") return null;
    return structuredClone(requester.record);
  }

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

  async listPolicyCheckedJobs(limit: number): Promise<JobRecord[]> {
    return [...this.jobs.values()]
      .filter((job) => job.state === "POLICY_CHECKED")
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .slice(0, limit)
      .map((job) => structuredClone(job));
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
    newTokenHash: string,
    currentTokenHash?: string,
  ): Promise<ProviderNodeRecord | null> {
    const existing = [...this.nodes.values()].find(
      ({ record }) => record.ownerId === input.ownerId && record.nodeName === input.nodeName,
    );
    if (currentTokenHash && (!existing || existing.tokenHash !== currentTokenHash)) return null;
    if (!currentTokenHash && existing) return null;

    const now = new Date().toISOString();
    const node: ProviderNodeRecord = {
      ...input,
      id: existing?.record.id ?? randomUUID(),
      availableCpu: existing?.record.availableCpu ?? 0,
      availableMemoryMb: existing?.record.availableMemoryMb ?? 0,
      activeJobs: existing?.record.activeJobs ?? 0,
      status: existing?.record.status ?? "OFFLINE",
      lastHeartbeatAt: existing?.record.lastHeartbeatAt ?? null,
      createdAt: existing?.record.createdAt ?? now,
      updatedAt: now,
    };
    this.nodes.set(node.id, { record: node, tokenHash: newTokenHash });
    return structuredClone(node);
  }

  async authenticateProvider(id: string, tokenHash: string): Promise<boolean> {
    return this.nodes.get(id)?.tokenHash === tokenHash;
  }

  async findProvider(id: string): Promise<ProviderNodeRecord | null> {
    const node = this.nodes.get(id)?.record;
    return node ? structuredClone(node) : null;
  }

  async listAvailableProviders(): Promise<ProviderNodeRecord[]> {
    return [...this.nodes.values()]
      .map(({ record }) => record)
      .filter((node) => node.status === "ONLINE")
      .map((node) => structuredClone(this.effectiveProviderCapacity(node)));
  }

  async heartbeatProvider(
    id: string,
    heartbeat: Parameters<CoordinatorStore["heartbeatProvider"]>[1],
  ): Promise<ProviderNodeRecord | null> {
    const stored = this.nodes.get(id);
    if (!stored) return null;

    const now = new Date().toISOString();
    const updated: ProviderNodeRecord = {
      ...stored.record,
      ...heartbeat,
      lastHeartbeatAt: now,
      updatedAt: now,
    };
    this.nodes.set(id, { ...stored, record: updated });
    return structuredClone(updated);
  }

  async createOffer(offer: SignedJobOffer): Promise<StoreResult<SignedJobOffer>> {
    const job = this.jobs.get(offer.manifest.jobId);
    if (!job) return { ok: false, reason: "JOB_NOT_FOUND" };
    const node = this.nodes.get(offer.manifest.nodeId)?.record;
    if (!node) return { ok: false, reason: "NODE_NOT_FOUND" };
    if (job.state !== "POLICY_CHECKED") return { ok: false, reason: "INVALID_STATE" };
    const eligibilityFailure = providerCanRunJob(this.effectiveProviderCapacity(node), job);
    if (eligibilityFailure) return { ok: false, reason: eligibilityFailure };

    assertJobTransition(job.state, "OFFERED");
    this.jobs.set(job.id, { ...job, state: "OFFERED", updatedAt: offer.manifest.issuedAt });
    this.offers.set(offer.id, { record: structuredClone(offer), nonceConsumedAt: null });
    return { ok: true, value: structuredClone(offer) };
  }

  async listPendingOffers(nodeId: string, now: string): Promise<SignedJobOffer[]> {
    const currentTime = Date.parse(now);
    return [...this.offers.values()]
      .filter(({ record }) => {
        const job = this.jobs.get(record.manifest.jobId);
        return (
          record.manifest.nodeId === nodeId &&
          Date.parse(record.manifest.expiresAt) > currentTime &&
          (job?.state === "OFFERED" || job?.state === "APPROVED")
        );
      })
      .map(({ record }) => structuredClone(record));
  }

  async approveOffer(
    offerId: string,
    nodeId: string,
    now: string,
  ): Promise<StoreResult<SignedJobOffer>> {
    const stored = this.offers.get(offerId);
    if (!stored) return { ok: false, reason: "OFFER_NOT_FOUND" };
    if (stored.record.manifest.nodeId !== nodeId) return { ok: false, reason: "NODE_MISMATCH" };
    const job = this.jobs.get(stored.record.manifest.jobId);
    if (!job) return { ok: false, reason: "JOB_NOT_FOUND" };
    if (Date.parse(stored.record.manifest.expiresAt) <= Date.parse(now)) {
      if (job.state === "OFFERED") {
        assertJobTransition(job.state, "EXPIRED");
        this.jobs.set(job.id, { ...job, state: "EXPIRED", updatedAt: now });
      }
      return { ok: false, reason: "OFFER_EXPIRED" };
    }
    if (job.state !== "OFFERED") return { ok: false, reason: "INVALID_STATE" };

    assertJobTransition(job.state, "APPROVED");
    const record = { ...stored.record, approvedAt: now };
    this.offers.set(offerId, { ...stored, record });
    this.jobs.set(job.id, { ...job, state: "APPROVED", updatedAt: now });
    return { ok: true, value: structuredClone(record) };
  }

  async claimOffer(
    offerId: string,
    nodeId: string,
    nonce: string,
    now: string,
    leaseUntil: string,
  ): Promise<StoreResult<SignedJobOffer>> {
    const stored = this.offers.get(offerId);
    if (!stored) return { ok: false, reason: "OFFER_NOT_FOUND" };
    if (stored.record.manifest.nodeId !== nodeId) return { ok: false, reason: "NODE_MISMATCH" };
    if (stored.nonceConsumedAt) return { ok: false, reason: "NONCE_ALREADY_USED" };
    if (stored.record.manifest.nonce !== nonce) return { ok: false, reason: "NONCE_MISMATCH" };
    const job = this.jobs.get(stored.record.manifest.jobId);
    if (!job) return { ok: false, reason: "JOB_NOT_FOUND" };
    if (Date.parse(stored.record.manifest.expiresAt) <= Date.parse(now)) {
      if (job.state === "APPROVED") {
        assertJobTransition(job.state, "EXPIRED");
        this.jobs.set(job.id, { ...job, state: "EXPIRED", updatedAt: now });
      }
      return { ok: false, reason: "OFFER_EXPIRED" };
    }
    if (job.state !== "APPROVED") return { ok: false, reason: "INVALID_STATE" };

    assertJobTransition(job.state, "CLAIMED");
    const record = { ...stored.record, claimedAt: now, leaseUntil };
    this.offers.set(offerId, { record, nonceConsumedAt: now });
    this.jobs.set(job.id, { ...job, state: "CLAIMED", updatedAt: now });
    return { ok: true, value: structuredClone(record) };
  }

  async transitionAssignedJob(
    jobId: string,
    nodeId: string,
    nextState: Parameters<CoordinatorStore["transitionAssignedJob"]>[2],
    _actor: string,
    _correlationId: string,
    _safePayload: Record<string, unknown> = {},
  ): Promise<StoreResult<JobRecord>> {
    const job = this.jobs.get(jobId);
    if (!job) return { ok: false, reason: "JOB_NOT_FOUND" };
    const assignment = [...this.offers.values()].find(
      ({ record }) => record.manifest.jobId === jobId,
    );
    if (!assignment?.record.claimedAt) return { ok: false, reason: "JOB_NOT_CLAIMED" };
    if (assignment.record.manifest.nodeId !== nodeId) {
      return { ok: false, reason: "NODE_MISMATCH" };
    }
    if (
      nextState === "RUNNING" &&
      (!assignment.record.leaseUntil || Date.parse(assignment.record.leaseUntil) <= Date.now())
    ) {
      return { ok: false, reason: "LEASE_EXPIRED" };
    }
    try {
      assertJobTransition(job.state, nextState);
    } catch {
      return { ok: false, reason: "INVALID_STATE" };
    }
    const updated = { ...job, state: nextState, updatedAt: new Date().toISOString() };
    this.jobs.set(jobId, updated);
    return { ok: true, value: structuredClone(updated) };
  }
}
