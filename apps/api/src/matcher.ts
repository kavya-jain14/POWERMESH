import { randomBytes, randomUUID } from "node:crypto";
import { protocolTiming, type SignedJobOffer } from "@powermesh/contracts";
import type { OfferSigner } from "./offers/signing";
import {
  type CoordinatorStore,
  type JobRecord,
  type ProviderNodeRecord,
  providerCanRunJob,
  type StoreResult,
} from "./store";

const heartbeatFreshnessMs = protocolTiming.agentHeartbeatSeconds * 3 * 1_000;

export function selectProvider(
  job: JobRecord,
  providers: ProviderNodeRecord[],
  now: Date,
): ProviderNodeRecord | null {
  return (
    providers
      .filter((provider) => {
        if (providerCanRunJob(provider, job)) return false;
        if (!provider.lastHeartbeatAt) return false;
        return now.getTime() - Date.parse(provider.lastHeartbeatAt) <= heartbeatFreshnessMs;
      })
      .sort(
        (left, right) =>
          left.activeJobs - right.activeJobs ||
          right.availableCpu - left.availableCpu ||
          right.availableMemoryMb - left.availableMemoryMb ||
          left.id.localeCompare(right.id),
      )[0] ?? null
  );
}

export class CoordinatorMatcher {
  constructor(
    private readonly store: CoordinatorStore,
    private readonly signer: OfferSigner,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async createOfferForNode(
    job: JobRecord,
    node: ProviderNodeRecord,
    ttlSeconds: number = protocolTiming.offerTtlSeconds,
  ): Promise<StoreResult<SignedJobOffer>> {
    const issuedAt = this.now();
    const offerId = randomUUID();
    const manifest = {
      version: 1 as const,
      offerId,
      jobId: job.id,
      nodeId: node.id,
      workload: job.workload,
      resources: job.resources,
      params: job.params,
      inputDigests: job.inputDigests,
      riskTier: job.riskTier,
      nonce: randomBytes(32).toString("hex"),
      issuedAt: issuedAt.toISOString(),
      expiresAt: new Date(issuedAt.getTime() + ttlSeconds * 1_000).toISOString(),
    };
    const offer: SignedJobOffer = {
      id: offerId,
      manifest,
      signature: this.signer.sign(manifest),
      signatureAlgorithm: "Ed25519",
      keyId: this.signer.keyId,
      approvedAt: null,
      claimedAt: null,
      leaseUntil: null,
    };
    return this.store.createOffer(offer);
  }

  async matchJob(job: JobRecord): Promise<StoreResult<SignedJobOffer> | null> {
    if (job.state !== "POLICY_CHECKED") return null;
    const now = this.now();
    const provider = selectProvider(job, await this.store.listAvailableProviders(), now);
    return provider ? this.createOfferForNode(job, provider) : null;
  }

  async sweep(limit = 25): Promise<number> {
    let matched = 0;
    for (const job of await this.store.listPolicyCheckedJobs(limit)) {
      const result = await this.matchJob(job);
      if (result?.ok) matched += 1;
    }
    return matched;
  }
}
