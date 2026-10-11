/**
 * ⚠️ DRAFT CONTRACTS — frontend side.
 *
 * Follows docs/handoff/answers-from-kavya.md as merged on main (2026-10-10 22:24, "freeze"). Shapes that
 * `@powermesh/contracts` already exports are re-exported from there; the rest mirror the answers until they
 * land in the package. Gaps the answers leave open are marked "proposal" (follow-ups F6/F7).
 *
 * Job states: the answers (Q1, Q2, Q4) use the master-plan table — QUEUED, STAGING, REJECTED, DECLINED,
 * TIMED_OUT — but `jobStates` in packages/contracts still has the older 11-state list. Until F7 is resolved
 * the UI keeps the master-plan table plus the two coordinator-v0 states it sees in live mode
 * (POLICY_CHECKED, APPROVED), so either source renders without inventing anything.
 */
import type {
  ApiErrorCode,
  Artifact as ContractArtifact,
  AuditEventType as ContractAuditEventType,
  GpuBenchmarkResult as ContractGpuBenchmarkResult,
  IsolationCapability as ContractIsolationCapability,
  IsolationLevel as ContractIsolationLevel,
  NetworkHealth as ContractNetworkHealth,
  ProviderPolicy as ContractProviderPolicy,
  TerminalReasonCode as ContractTerminalReasonCode,
  ProviderNodeStatus,
} from "@powermesh/contracts";
import { protocolTiming } from "@powermesh/contracts";

export type Role = "requester" | "provider" | "admin";

/* ── Job states (master plan §3 + Q1/Q2/Q4/Q5) ──────────────────────────── */

export const JOB_STATES = [
  "DRAFT",
  "SUBMITTED",
  "REJECTED",
  "POLICY_CHECKED",
  "QUEUED",
  "OFFERED",
  "DECLINED",
  "APPROVED",
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
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
  "REJECTED",
  "EXPIRED",
  "DECLINED",
  "TIMED_OUT",
];

/**
 * Master plan §3, plus: OFFERED → CANCELLED (Q3), QUEUED → EXPIRED with QUEUE_TIMEOUT (Q2), and the
 * coordinator-v0 states POLICY_CHECKED/APPROVED as `allowedJobTransitions` defines them. DRAFT is client-only (Q5).
 */
export const TRANSITIONS: Readonly<Record<JobState, readonly JobState[]>> = {
  DRAFT: ["SUBMITTED", "CANCELLED"],
  SUBMITTED: ["REJECTED", "QUEUED", "POLICY_CHECKED", "FAILED", "CANCELLED"],
  POLICY_CHECKED: ["OFFERED", "FAILED", "CANCELLED"],
  QUEUED: ["OFFERED", "CANCELLED", "EXPIRED"],
  OFFERED: ["CLAIMED", "APPROVED", "DECLINED", "EXPIRED", "CANCELLED"],
  APPROVED: ["CLAIMED", "EXPIRED", "CANCELLED"],
  CLAIMED: ["STAGING", "RUNNING", "EXPIRED", "FAILED", "CANCELLED"],
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

/** Q1 (agreed): one lease-expiry retry of an idempotent job, back to QUEUED with attempt 2. Only on LEASE_EXPIRED. */
export const RETRY_TRANSITIONS: Readonly<Partial<Record<JobState, readonly JobState[]>>> = {
  CLAIMED: ["QUEUED"],
  STAGING: ["QUEUED"],
  RUNNING: ["QUEUED"],
};

export function isTerminal(state: JobState): boolean {
  return TERMINAL_STATES.includes(state);
}

export function canTransition(from: JobState, to: JobState, leaseRetry = false): boolean {
  if (TRANSITIONS[from].includes(to)) return true;
  return leaseRetry && (RETRY_TRANSITIONS[from]?.includes(to) ?? false);
}

/** Q2, Q1, Q10. Coordinator-owned; the UI uses them for copy and the offline demo. */
export const SCHEDULING = {
  queueTimeoutSeconds: 300,
  offerTtlSeconds: protocolTiming.offerTtlSeconds,
  maxAttempts: 2,
  leaseSeconds: protocolTiming.executionLeaseSeconds,
  leaseGraceSeconds: protocolTiming.leaseExpiryGraceSeconds,
} as const;

/** Q19, from packages/contracts: SSE heartbeat 5 s, stale after 12 s; reconnect backoff capped at 15 s. */
export const STREAM_TIMING = {
  heartbeatSeconds: protocolTiming.sseHeartbeatSeconds,
  staleAfterSeconds: protocolTiming.sseStaleAfterSeconds,
  maxBackoffSeconds: 15,
} as const;

/* ── Reason codes (Q4, packages/contracts terminal.ts) ──────────────────── */

export type TerminalReasonCode = ContractTerminalReasonCode;
export type StopReasonCode = "REQUESTER_CANCEL" | "PROVIDER_STOP" | "ADMIN_STOP";

/* ── Risk & network (Q7) ────────────────────────────────────────────────── */

export type RiskTier = "LOW" | "MEDIUM" | "HIGH" | "BLOCKED";
export const RISK_ORDER: readonly RiskTier[] = ["LOW", "MEDIUM", "HIGH", "BLOCKED"];

export type NetworkMode = "OFFLINE" | "RESTRICTED" | "OPEN_WEB";

export type RiskFactCode =
  | "SIGNED_DIGEST_PINNED"
  | "UNSIGNED_OR_UNPINNED"
  | "NO_REQUESTER_CODE"
  | "RUNS_REQUESTER_CODE"
  | "CODE_WITH_OPEN_WEB"
  | "NETWORK_OFFLINE"
  | "NETWORK_RESTRICTED"
  | "NETWORK_OPEN_WEB"
  | "SECRETS_OR_DEVICES"
  | "BOUNDED_SCHEMAS"
  | "UNBOUNDED_SCHEMAS"
  | "ROUTE_DEDICATED_ONLY"
  | "PRIVILEGED_EXECUTION"
  | "HOST_FILESYSTEM_ACCESS"
  | "DOCKER_SOCKET_ACCESS"
  | "RAW_DEVICE_ACCESS"
  | "RESOURCE_ENVELOPE_ELEVATED";

export interface RiskFact {
  /**
   * A RiskFactCode. The live bridge passes coordinator v0 reasons through as `COORDINATOR_REASON_<n>`
   * until the API emits codes.
   */
  code: RiskFactCode | `COORDINATOR_REASON_${number}`;
  /** Hydrated from the copy table keyed by code (Q7). Never branch on this text. */
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

/* ── Compatibility contract (Q11, packages/contracts capabilities.ts) ──── */

export type Os = "linux" | "windows" | "macos";
export type Arch = "amd64" | "arm64";
export type IsolationLevel = ContractIsolationLevel;
export type IsolationCapability = ContractIsolationCapability;
export type Accelerator = "none" | "cuda" | "metal";
export type TrustTier = "community" | "verified" | "dedicated";

export interface ResourceLimits {
  cpuCores: number;
  memoryBytes: number;
  /** null = not part of the job's contract yet (coordinator API v0 has no disk, PID or output fields). */
  diskBytes: number | null;
  timeoutSeconds: number;
  pidLimit: number | null;
  maxOutputBytes: number | null;
}

/* ── Workloads (Q28) ────────────────────────────────────────────────────── */

export type ParamSchema =
  | { type: "string"; enum: string[]; default?: string; title: string; description?: string }
  | {
      type: "integer";
      minimum: number;
      maximum: number;
      multipleOf?: number;
      default?: number;
      title: string;
      description?: string;
      "x-unit"?: string;
    };

export interface ParamsSchema {
  type: "object";
  additionalProperties: false;
  required: string[];
  properties: Record<string, ParamSchema>;
}

export interface WorkloadDefinition {
  id: string;
  name: string;
  version: string;
  summary: string;
  publisher: string;
  /** Release-time digest. Anything that isn't a full sha256 is invalid (Q28). */
  imageDigest: string;
  signatureVerified: boolean;
  /** Whether it executes requester-provided code (never true for MVP catalogue). */
  runsRequesterCode: boolean;
  needsSecrets: boolean;
  needsDeviceAccess: boolean;
  accelerator?: Accelerator;
  input: {
    contentTypes: string[];
    maxFiles: number;
    maxBytesPerFile: number;
    maxTotalBytes: number;
  };
  output: { contentTypes: string[]; maxBytesPerFile: number };
  paramsSchema: ParamsSchema;
  allowedNetworkModes: NetworkMode[];
  minimumIsolation: IsolationLevel;
  limits: ResourceLimits;
  idempotent: boolean;
  /** Catalogue availability for personal providers. */
  availability: { status: "available" } | { status: "unavailable"; reason: string };
}

export const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/;

/** Q28: "reject any definition without a valid sha256 digest". */
export function hasValidDigest(workload: Pick<WorkloadDefinition, "imageDigest">): boolean {
  return SHA256_DIGEST.test(workload.imageDigest);
}

/** A form field derived from one `paramsSchema` property. */
export type ParamSpec =
  | {
      key: string;
      label: string;
      type: "enum";
      options: Array<{ value: string; label: string }>;
      default: string;
      hint?: string;
    }
  | {
      key: string;
      label: string;
      type: "int";
      min: number;
      max: number;
      step?: number;
      default: number;
      unit?: string;
      hint?: string;
    };

/**
 * Q28: controls come from the schema's title, description and x-unit. Enum values have no display labels
 * in the schema, so the demo workload keeps a tested fallback for its own values.
 */
const ENUM_LABEL_FALLBACK: Record<string, string> = { webp: "WebP", jpeg: "JPEG", png: "PNG" };

export function paramSpecs(schema: ParamsSchema): ParamSpec[] {
  return Object.entries(schema.properties).map(([key, p]) => {
    if (p.type === "string") {
      return {
        key,
        label: p.title,
        type: "enum",
        options: p.enum.map((value) => ({ value, label: ENUM_LABEL_FALLBACK[value] ?? value })),
        default: p.default ?? p.enum[0] ?? "",
        hint: p.description,
      };
    }
    return {
      key,
      label: p.title,
      type: "int",
      min: p.minimum,
      max: p.maximum,
      step: p.multipleOf,
      default: p.default ?? p.minimum,
      unit: p["x-unit"],
      hint: p.description,
    };
  });
}

/* ── Jobs (Q9) ──────────────────────────────────────────────────────────── */

export interface Actor {
  role: Role | "agent" | "system";
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
  /** null when the source didn't report sizes (coordinator API v0 stores input digests only). */
  totalBytes: number | null;
  /** Requester-only metadata (Q25). Providers never receive file names. */
  files?: InputFileMeta[];
}

/** Q14 (packages/contracts artifacts.ts): url null, or any failed check, means never preview or download. */
export type Artifact = ContractArtifact;

export function isDownloadable(a: Artifact): boolean {
  return a.url !== null && a.validation.length > 0 && a.validation.every((c) => c.passed);
}

export interface ResourceUsage {
  cpuCores: number;
  memoryBytes: number;
  diskBytes: number;
  elapsedSeconds: number;
}

export interface StoppedBy {
  role: "requester" | "provider" | "admin";
  label: string;
  reasonCode: StopReasonCode;
}

export interface Job {
  id: string;
  state: JobState;
  requesterLabel: string;
  workload: { id: string; name: string; version: string; digest: string };
  inputs: InputSummary;
  /** Not in the Q9 shape; kept for the Flight Recorder's "Input digest" fact (follow-ups F6). */
  inputDigest?: string;
  params: Record<string, string | number | boolean>;
  limits: ResourceLimits;
  networkMode: NetworkMode;
  accelerator?: Accelerator;
  resultSummary?: ContractGpuBenchmarkResult;
  risk: RiskExplanation;
  attempt: 1 | 2;
  maxAttempts: 2;
  /** Requesters get coarse os/architecture and a generic label; nodeId is absent (Q24). */
  assignment: null | {
    nodeId?: string;
    nodeLabel: string;
    os: string;
    architecture: string;
    isolation: IsolationLevel;
    leaseUntil: string;
  };
  progress: null | { done: number; total: number; unit?: string };
  usage: null | ResourceUsage;
  artifacts: Artifact[];
  /** Why a job ended in REJECTED, DECLINED, EXPIRED, TIMED_OUT or FAILED. Copy comes from REASON_COPY. */
  failure: null | { code: TerminalReasonCode; reason: string };
  stoppedBy: null | StoppedBy;
  createdAt: string;
  updatedAt: string;
}

/** Q22: Agent stop events. "Stopped by you" is anchored to PROCESS_KILLED; cleanup is measured separately. */
export type AgentStopEvent =
  | "NETWORK_REVOKED"
  | "TERMINATION_REQUESTED"
  | "PROCESS_KILLED"
  | "WORKSPACE_CLEANED";

export type JobEventType = "state" | "progress" | "log";

export interface JobEvent {
  /** Monotonic per-job sequence; also the SSE `id` for Last-Event-ID resume. */
  seq: number;
  id: string;
  jobId: string;
  type: JobEventType;
  state?: JobState;
  prevState?: JobState;
  progress?: { done: number; total: number; unit?: string };
  usage?: ResourceUsage;
  message?: string;
  reason?: string;
  /** Proposal (F6): machine code for timeline-only events — stop steps (Q22) and LEASE_EXPIRED (Q1). */
  code?: AgentStopEvent | "LEASE_EXPIRED" | "HEARTBEAT_MISSED";
  actor: Actor;
  at: string;
  correlationId: string;
  attempt: number;
}

/* ── Provider side (Q10–Q13, Q21–Q23) ───────────────────────────────────── */

export interface Capability {
  runtime: IsolationLevel;
  cpuCores: number;
  memoryBytes: number;
  diskBytes: number;
  accelerator: Accelerator;
  networkModes: NetworkMode[];
  isolation: IsolationCapability;
}

export type NodeStatus = ProviderNodeStatus;

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

/** Q13 (packages/contracts provider.ts) plus the node it belongs to and when it last changed. */
export type ProviderPolicy = ContractProviderPolicy & { nodeId: string; updatedAt: string };
export type PolicySchedule = ProviderPolicy["schedule"];

export type OfferStatus = "pending" | "approved" | "auto_approved" | "declined" | "expired";

/** Q10. */
export interface Offer {
  id: string;
  jobId: string;
  workload: {
    id: string;
    name: string;
    version: string;
    digest: string;
    signatureVerified: boolean;
    publisher: string;
    summary: string;
  };
  /** No filenames — the provider sees counts, types and sizes only (Q25). */
  inputs: Omit<InputSummary, "files">;
  params: Record<string, string | number | boolean>;
  limits: ResourceLimits;
  networkMode: NetworkMode;
  risk: RiskExplanation;
  /** Pseudonymous community display label (Q10). */
  requesterLabel: string;
  createdAt: string;
  expiresAt: string;
  status: OfferStatus;
  /** Q23: resolved from a versioned rule code. Render `label`; keep code/version for audit. */
  policyRule: null | { code: string; label: string; policyVersion: string };
  decidedAt?: string;
}

/**
 * Q21 / ADR-002: GET /v1/local/state on the Agent's own origin (127.0.0.1:4765). The Agent reads coordinator
 * state over its outbound channel; stop, availability and decisions are handled locally.
 */
export interface AgentLocalState {
  agent: { version: string; startedAt: string };
  /** As seen by the Agent over its outbound channel. */
  coordinator: { reachable: boolean; lastContactAt: string };
  node: ProviderNode;
  policy: ProviderPolicy;
  pendingOffer: Offer | null;
  activeJob: Job | null;
  /** Most recent job this node stopped or finished, for the "stopped" state. */
  lastJob: Job | null;
  /** Q22 stop events for an in-flight or just-finished local stop. */
  stop: {
    jobId: string;
    requestedAt: string;
    steps: Array<{ step: AgentStopEvent; at: string }>;
  } | null;
}

/* ── Control room / audit (Q15–Q17) ────────────────────────────────────── */

/** Q16 (packages/contracts platform.ts). Branch on reasonCode, render reason. */
export type NetworkHealth = ContractNetworkHealth;

/** Q17 (packages/contracts platform.ts). */
export type AuditEventType = ContractAuditEventType;

export interface AuditEvent {
  id: string;
  at: string;
  actor: Actor;
  type: AuditEventType;
  /** A blocked submission has no job (Q6); its audit event id is the reference. */
  jobId?: string;
  nodeId?: string;
  summary: string;
  reason?: string;
  correlationId: string;
}

/** Q15: cursor pages for jobs and audit. Cursors are opaque — never construct or decode them. */
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/* ── Errors (Q8, packages/contracts api.ts) ─────────────────────────────── */

export type ErrorCode = ApiErrorCode;

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    /** Safe user copy. Never credentials, paths, stack traces, SQL or upstream bodies. */
    message: string;
    /** Dotted keys: workloadId, inputs, inputs.<n>, networkMode, allowedHosts, limits.<field>, params.<name>. */
    fields?: Record<string, string>;
    correlationId: string;
    details?: unknown;
  };
}

/** `details` of a 422 RISK_BLOCKED (Q6). No job row exists; the audit event id is the reference. */
export interface RiskBlockedDetails {
  /** Absent from coordinator API v0 responses so far. */
  auditEventId?: string;
  risk: RiskExplanation;
}

/* ── Requests ───────────────────────────────────────────────────────────── */

export interface SubmitJobRequest {
  workloadId: string;
  params: Record<string, string | number | boolean>;
  networkMode: NetworkMode;
  inputs: InputFileMeta[];
  /** Offline-demo convenience: use the bundled demo sample set. Becomes inputArtifactIds (Q27). */
  sampleSet?: string;
}

export interface OfferDecisionRequest {
  decision: "approve" | "decline";
}
