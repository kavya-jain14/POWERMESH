import type {
  JobState,
  JobSubmission,
  ProviderHeartbeat,
  ProviderRegistration,
  RequesterRegistration,
  RiskDecision,
  RiskTier,
  SignedJobOffer,
} from "@powermesh/contracts";

export interface JobRecord {
  id: string;
  requesterId: string;
  workload: JobSubmission["workload"];
  resources: JobSubmission["resources"];
  params: JobSubmission["params"];
  inputDigests: string[];
  riskTier: RiskTier;
  state: JobState;
  createdAt: string;
  updatedAt: string;
}

export interface ProviderNodeRecord extends ProviderRegistration {
  id: string;
  availableCpu: number;
  availableMemoryMb: number;
  activeJobs: number;
  status: "OFFLINE" | "ONLINE" | "BUSY" | "DRAINING";
  lastHeartbeatAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RequesterRecord {
  id: string;
  communityId: string | null;
  status: "ACTIVE" | "SUSPENDED";
  createdAt: string;
  updatedAt: string;
}

export type OfferFailureReason =
  | "JOB_NOT_FOUND"
  | "NODE_NOT_FOUND"
  | "NODE_UNAVAILABLE"
  | "CAPABILITY_MISMATCH"
  | "INVALID_STATE"
  | "OFFER_NOT_FOUND"
  | "OFFER_EXPIRED"
  | "NODE_MISMATCH"
  | "NONCE_MISMATCH"
  | "NONCE_ALREADY_USED"
  | "LEASE_EXPIRED"
  | "JOB_NOT_CLAIMED";

export type StoreResult<T> = { ok: true; value: T } | { ok: false; reason: OfferFailureReason };

export function providerCanRunJob(
  node: ProviderNodeRecord,
  job: JobRecord,
): OfferFailureReason | null {
  if (node.status !== "ONLINE") return "NODE_UNAVAILABLE";
  if (node.availableCpu < job.resources.cpu || node.availableMemoryMb < job.resources.memoryMb) {
    return "NODE_UNAVAILABLE";
  }
  if (!node.networkModes.includes(job.resources.networkMode)) return "CAPABILITY_MISMATCH";
  if (job.riskTier === "MEDIUM" && !node.isolationLevels.includes("GVISOR")) {
    return "CAPABILITY_MISMATCH";
  }
  return null;
}

export interface CoordinatorStore {
  readonly kind: "memory" | "postgres";
  close(): Promise<void>;
  registerRequester(input: RequesterRegistration, tokenHash: string): Promise<RequesterRecord>;
  authenticateRequester(tokenHash: string): Promise<RequesterRecord | null>;
  createPolicyCheckedJob(input: JobSubmission, risk: RiskDecision): Promise<JobRecord>;
  findJob(id: string): Promise<JobRecord | null>;
  listPolicyCheckedJobs(limit: number): Promise<JobRecord[]>;
  transitionJob(
    id: string,
    nextState: JobState,
    actor: string,
    correlationId: string,
    safePayload?: Record<string, unknown>,
  ): Promise<JobRecord | null>;
  registerProvider(
    input: ProviderRegistration,
    newTokenHash: string,
    currentTokenHash?: string,
  ): Promise<ProviderNodeRecord | null>;
  authenticateProvider(id: string, tokenHash: string): Promise<boolean>;
  findProvider(id: string): Promise<ProviderNodeRecord | null>;
  listAvailableProviders(): Promise<ProviderNodeRecord[]>;
  heartbeatProvider(id: string, heartbeat: ProviderHeartbeat): Promise<ProviderNodeRecord | null>;
  createOffer(offer: SignedJobOffer): Promise<StoreResult<SignedJobOffer>>;
  listPendingOffers(nodeId: string, now: string): Promise<SignedJobOffer[]>;
  approveOffer(offerId: string, nodeId: string, now: string): Promise<StoreResult<SignedJobOffer>>;
  claimOffer(
    offerId: string,
    nodeId: string,
    nonce: string,
    now: string,
    leaseUntil: string,
  ): Promise<StoreResult<SignedJobOffer>>;
  transitionAssignedJob(
    jobId: string,
    nodeId: string,
    nextState: JobState,
    actor: string,
    correlationId: string,
    safePayload?: Record<string, unknown>,
  ): Promise<StoreResult<JobRecord>>;
}
