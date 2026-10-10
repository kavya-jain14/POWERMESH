/**
 * ⚠️ DRAFT CONTRACTS — provisional, frontend-side only.
 *
 * Kavya owns the real contracts (`packages/contracts`, K2). These types mirror master plan §3 (job states),
 * §4 (risk tiers, network modes), §5 (compatibility contract) and §7 (data model), plus the proposals in
 * docs/design/G1-information-architecture.md §6. When `@powermesh/contracts` v0 is frozen (S1), replace
 * imports of this module with it — the UI must not keep its own copy.
 */

export type Role = "requester" | "provider" | "admin";

/* ── Job states (master plan §3, canonical) ─────────────────────────────── */

export const JOB_STATES = [
  "DRAFT",
  "SUBMITTED",
  "REJECTED",
  "QUEUED",
  "OFFERED",
  "DECLINED",
  "EXPIRED",
  "CLAIMED",
  "STAGING",
  "RUNNING",
  "VALIDATING",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
  "TIMED_OUT",
] as const;

export type JobState = (typeof JOB_STATES)[number];

export const TERMINAL_STATES: readonly JobState[] = [
  "REJECTED",
  "DECLINED",
  "EXPIRED",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
  "TIMED_OUT",
];

/** Allowed transitions, verbatim from master plan §3 "Canonical job states". */
export const TRANSITIONS: Readonly<Record<JobState, readonly JobState[]>> = {
  DRAFT: ["SUBMITTED", "CANCELLED"],
  SUBMITTED: ["REJECTED", "QUEUED"],
  QUEUED: ["OFFERED", "CANCELLED", "EXPIRED"],
  OFFERED: ["CLAIMED", "DECLINED", "EXPIRED"],
  CLAIMED: ["STAGING", "FAILED", "CANCELLED"],
  STAGING: ["RUNNING", "FAILED", "CANCELLED"],
  RUNNING: ["VALIDATING", "FAILED", "CANCELLED", "TIMED_OUT"],
  VALIDATING: ["SUCCEEDED", "FAILED"],
  REJECTED: [],
  DECLINED: [],
  EXPIRED: [],
  SUCCEEDED: [],
  FAILED: [],
  CANCELLED: [],
  TIMED_OUT: [],
};

/**
 * ❓ Kavya (G1 §6 Q1): proposed amendment so one lease-expiry requeue is representable.
 * Not part of the canonical table until both owners agree.
 */
export const PROPOSED_RETRY_TRANSITIONS: Readonly<Partial<Record<JobState, readonly JobState[]>>> = {
  CLAIMED: ["QUEUED"],
  STAGING: ["QUEUED"],
  RUNNING: ["QUEUED"],
};

export function isTerminal(state: JobState): boolean {
  return TERMINAL_STATES.includes(state);
}

export function canTransition(from: JobState, to: JobState, allowProposedRetry = false): boolean {
  if (TRANSITIONS[from].includes(to)) return true;
  return allowProposedRetry && (PROPOSED_RETRY_TRANSITIONS[from]?.includes(to) ?? false);
}

/* ── Risk & network (master plan §4) ────────────────────────────────────── */

export type RiskTier = "LOW" | "MEDIUM" | "HIGH" | "BLOCKED";
export const RISK_ORDER: readonly RiskTier[] = ["LOW", "MEDIUM", "HIGH", "BLOCKED"];

export type NetworkMode = "OFFLINE" | "RESTRICTED" | "OPEN_WEB";

export interface RiskFact {
  /** Stable machine code, e.g. SIGNED_DIGEST_PINNED. */
  code: string;
  /** User-facing sentence. Rendered verbatim — copy reviewed by Gargi. */
  label: string;
  effect: "lowers" | "raises" | "blocks";
  detail?: string;
}

export interface RiskExplanation {
  tier: RiskTier;
  facts: RiskFact[];
  policyVersion: string;
  decidedAt: string;
}

/* ── Compatibility contract (master plan §5) ────────────────────────────── */

export type Os = "linux" | "windows" | "macos";
export type Arch = "amd64" | "arm64";
export type IsolationLevel = "docker-rootless" | "gvisor" | "vm" | "microvm";
export type Accelerator = "none" | "cuda" | "metal";
export type TrustTier = "community" | "verified" | "dedicated";

export interface ResourceLimits {
  cpuCores: number;
  memoryBytes: number;
  diskBytes: number;
  wallClockSeconds: number;
  pids: number;
}

/* ── Workloads ──────────────────────────────────────────────────────────── */

export type ParamSpec =
  | { key: string; label: string; type: "enum"; options: Array<{ value: string; label: string }>; default: string; hint?: string }
  | { key: string; label: string; type: "int"; min: number; max: number; step?: number; default: number; unit?: string; hint?: string };

export interface WorkloadDefinition {
  id: string;
  name: string;
  version: string;
  summary: string;
  publisher: string;
  imageDigest: string;
  signatureVerified: boolean;
  /** Whether it executes requester-provided code (never true for MVP catalogue). */
  runsRequesterCode: boolean;
  needsSecrets: boolean;
  needsDeviceAccess: boolean;
  inputSchema: { accept: string[]; maxFiles: number; maxFileBytes: number; maxTotalBytes: number };
  outputSchema: { contentTypes: string[]; maxFileBytes: number };
  params: ParamSpec[];
  allowedNetworkModes: NetworkMode[];
  minIsolation: IsolationLevel;
  limits: ResourceLimits;
  idempotent: boolean;
  /** Catalogue availability for personal providers. */
  availability: { status: "available" } | { status: "unavailable"; reason: string };
}

/* ── Jobs ───────────────────────────────────────────────────────────────── */

export interface Actor {
  role: Role | "coordinator" | "agent";
  label: string;
}

export interface InputFileMeta {
  name: string;
  contentType: string;
  bytes: number;
}

export interface InputSummary {
  count: number;
  contentTypes: string[];
  totalBytes: number;
  /** Present only for the requester who owns the job and for admins. */
  files?: InputFileMeta[];
}

export interface ArtifactValidationCheck {
  code: string;
  label: string;
  passed: boolean;
}

export interface Artifact {
  id: string;
  jobId: string;
  direction: "input" | "output";
  name: string;
  contentType: string;
  size: number;
  digest: string;
  /** Short-lived scoped URL. Never permanent, never public. */
  url: string;
  urlExpiresAt: string;
  validation: ArtifactValidationCheck[];
}

export interface ResourceUsage {
  cpuCores: number;
  memoryBytes: number;
  diskBytes: number;
  elapsedSeconds: number;
}

export type StopReasonCode = "PROVIDER_STOP" | "REQUESTER_CANCEL" | "ADMIN_STOP";

export interface Job {
  id: string;
  requesterId: string;
  requesterLabel: string;
  workloadId: string;
  workloadName: string;
  workloadVersion: string;
  workloadDigest: string;
  params: Record<string, string | number>;
  inputs: InputSummary;
  inputDigest: string;
  risk: RiskExplanation;
  networkMode: NetworkMode;
  limits: ResourceLimits;
  state: JobState;
  attempt: number;
  createdAt: string;
  updatedAt: string;
  /** Node label is shown; node address never exists in any contract. */
  assignment?: { nodeId: string; nodeLabel: string; isolation: IsolationLevel; leaseUntil: string };
  progress?: { done: number; total: number };
  usage?: ResourceUsage;
  artifacts?: Artifact[];
  failure?: { code: string; reason: string };
  stoppedBy?: Actor & { reasonCode: StopReasonCode };
}

export type JobEventType = "state" | "progress" | "log" | "heartbeat";

export interface JobEvent {
  /** Monotonic per-job sequence; also the SSE `id` for Last-Event-ID resume. */
  seq: number;
  id: string;
  jobId: string;
  type: JobEventType;
  state?: JobState;
  prevState?: JobState;
  progress?: { done: number; total: number };
  usage?: ResourceUsage;
  message?: string;
  reason?: string;
  actor: Actor;
  at: string;
  correlationId: string;
  attempt: number;
}

/* ── Provider side ──────────────────────────────────────────────────────── */

export interface Capability {
  runtime: IsolationLevel;
  cpuCores: number;
  memoryBytes: number;
  diskBytes: number;
  accelerator: Accelerator;
  networkModes: NetworkMode[];
  /** Declared by config vs verified by an Agent probe (K12). UI shows only `verified` as active. */
  isolation: { declared: IsolationLevel[]; verified: IsolationLevel[]; probedAt: string };
}

export type NodeStatus = "offline" | "available" | "busy" | "paused";

export interface ProviderNode {
  id: string;
  ownerId: string;
  ownerLabel: string;
  label: string;
  os: Os;
  arch: Arch;
  agentVersion: string;
  trustTier: TrustTier;
  heartbeatAt: string;
  status: NodeStatus;
  capability: Capability;
}

export interface ProviderPolicy {
  nodeId: string;
  allowedWorkloads: string[];
  riskMax: Exclude<RiskTier, "BLOCKED" | "HIGH">;
  consentMode: "ask" | "auto";
  schedule: { mode: "always" } | { mode: "window"; start: string; end: string };
  networkModes: NetworkMode[];
  resourceCaps: { cpuCores: number; memoryBytes: number; diskBytes: number };
  updatedAt: string;
}

export type OfferStatus = "pending" | "approved" | "auto_approved" | "declined" | "expired";

export interface Offer {
  id: string;
  jobId: string;
  nodeId: string;
  workload: { id: string; name: string; version: string; digest: string; signatureVerified: boolean; publisher: string; summary: string };
  /** No filenames — the provider sees counts, types and sizes only. */
  inputs: Omit<InputSummary, "files">;
  params: Record<string, string | number>;
  limits: ResourceLimits;
  networkMode: NetworkMode;
  risk: RiskExplanation;
  requesterLabel: string;
  createdAt: string;
  expiresAt: string;
  status: OfferStatus;
  decidedAt?: string;
  /** When auto-approved: the policy rule that allowed it, in words. */
  policyRule?: string;
}

/** Local Agent view (G1 §6 Q9 proposal): what the provider's own machine reports over loopback. */
export interface AgentLocalState {
  agent: { connected: boolean; version: string; startedAt: string };
  coordinator: { reachable: boolean; lastContactAt: string };
  node: ProviderNode;
  policy: ProviderPolicy;
  pendingOffer: Offer | null;
  activeJob: Job | null;
  /** Most recent job this node stopped or finished, for the "stopped" state. */
  lastJob: Job | null;
  stopping: boolean;
}

/* ── Control room / audit ───────────────────────────────────────────────── */

export interface NetworkHealth {
  status: "healthy" | "degraded" | "no_providers" | "incident";
  reason: string;
  coordinator: { reachable: boolean };
  nodes: { total: number; available: number; busy: number; offline: number; paused: number };
  activeJobs: number;
  queuedJobs: number;
  incident?: { id: string; title: string; openedAt: string };
  checkedAt: string;
}

export type AuditEventType =
  | "JOB_SUBMITTED"
  | "JOB_REJECTED"
  | "JOB_STATE_CHANGED"
  | "OFFER_CREATED"
  | "OFFER_APPROVED"
  | "OFFER_AUTO_APPROVED"
  | "OFFER_DECLINED"
  | "OFFER_EXPIRED"
  | "JOB_STOPPED"
  | "LEASE_EXPIRED"
  | "NODE_CONNECTED"
  | "NODE_DISCONNECTED"
  | "POLICY_UPDATED"
  | "ARTIFACT_VALIDATED"
  | "WORKSPACE_CLEANED";

export interface AuditEvent {
  id: string;
  at: string;
  actor: Actor;
  type: AuditEventType;
  jobId?: string;
  nodeId?: string;
  summary: string;
  reason?: string;
  correlationId: string;
}

/* ── Errors (G1 §6 Q4 proposal) ─────────────────────────────────────────── */

export type ErrorCode =
  | "VALIDATION_FAILED"
  | "RISK_BLOCKED"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "CONFLICT"
  | "OFFER_EXPIRED"
  | "RATE_LIMITED"
  | "UNAVAILABLE"
  | "INTERNAL";

export interface ApiErrorBody {
  error: { code: ErrorCode; message: string; fields?: Record<string, string>; correlationId: string };
}

/* ── Requests ───────────────────────────────────────────────────────────── */

export interface SubmitJobRequest {
  workloadId: string;
  params: Record<string, string | number>;
  networkMode: NetworkMode;
  inputs: InputFileMeta[];
  /** Mock-only convenience: use the bundled demo sample set. */
  sampleSet?: string;
}

export interface OfferDecisionRequest {
  decision: "approve" | "decline";
}
