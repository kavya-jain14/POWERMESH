/**
 * ⚠️ OFFLINE-DEMO COORDINATOR + LOCAL AGENT — in-memory, rehearsal only (Q30).
 *
 * Stands in for Kavya's API and the provider's Agent so the UI can be rehearsed end to end without a
 * backend. It follows docs/handoff/answers-from-kavya.md (main, 2026-10-10 22:24) and enforces the UI's
 * TRANSITIONS table: any other transition throws. The lease-expiry retry (Q1) is the only extra path.
 *
 * Two personas live here:
 *  - the coordinator (`/api/mock/v1/*`): jobs, offers, nodes, policy, network health, audit;
 *  - the provider's Agent local API (`/api/mock/agent/v1/local/*`, ADR-002 / Q21): it keeps working
 *    while the coordinator is down, so the provider can always stop work.
 *
 * State lives on globalThis so every route handler in the dev server shares one simulation.
 */
import { createHash, createHmac, randomUUID } from "node:crypto";
import manifest from "./sample-manifest.json";
import { PROVIDER_NODE_ID, SAMPLE_SET_ID, USERS, seedNodes, seedPolicies, type MockUser } from "./seed";
import { classifyRisk } from "@/contracts-draft/risk";
import { getWorkload, IMAGE_TRANSFORM } from "@/contracts-draft/workloads";
import { formatBytes, formatInputs } from "@/contracts-draft/format";
import {
  RISK_ORDER,
  SCHEDULING,
  canTransition,
  isTerminal,
  paramSpecs,
  type Actor,
  type AgentLocalState,
  type AgentStopEvent,
  type Artifact,
  type AuditEvent,
  type AuditEventType,
  type ErrorCode,
  type InputFileMeta,
  type Job,
  type JobEvent,
  type JobState,
  type NetworkHealth,
  type Offer,
  type Page,
  type ProviderNode,
  type ProviderPolicy,
  type StopReasonCode,
  type StoppedBy,
  type SubmitJobRequest,
  type TerminalReasonCode,
} from "@/contracts-draft/types";

/* ── Errors ─────────────────────────────────────────────────────────────── */

export class MockApiError extends Error {
  constructor(
    public status: number,
    public code: ErrorCode,
    message: string,
    public fields?: Record<string, string>,
    public details?: unknown,
    public correlationId?: string,
  ) {
    super(message);
  }
}

/** Q30: the offline demo is disabled in production builds unless explicitly turned on. */
export function assertOfflineDemoEnabled() {
  if (process.env.NODE_ENV === "production" && process.env.NEXT_PUBLIC_POWERMESH_OFFLINE_DEMO !== "1") {
    throw new MockApiError(404, "NOT_FOUND", "The offline demo is turned off in production builds. Set NEXT_PUBLIC_POWERMESH_OFFLINE_DEMO=1 to rehearse with it.");
  }
}

/* ── State ──────────────────────────────────────────────────────────────── */

type Listener = (event: JobEvent) => void;

/** Server-side records. `requesterId` and an offer's `nodeId` never leave the store. */
type JobRecord = Job & { requesterId: string };
type OfferRecord = Offer & { nodeId: string; withdrawn?: boolean };

interface StopRun {
  jobId: string;
  requestedAt: string;
  steps: Array<{ step: AgentStopEvent; at: string }>;
}

interface MockState {
  jobs: Map<string, JobRecord>;
  events: Map<string, JobEvent[]>;
  correlation: Map<string, string>;
  offers: Map<string, OfferRecord>;
  nodes: Map<string, ProviderNode>;
  policies: Map<string, ProviderPolicy>;
  audit: AuditEvent[];
  listeners: Map<string, Set<Listener>>;
  streamClosers: Set<() => void>;
  timers: Map<string, Array<ReturnType<typeof setTimeout>>>;
  lastJobByNode: Map<string, string>;
  stops: Map<string, StopRun>;
  flags: {
    coordinatorDown: boolean;
    agentConnected: boolean;
    /** Multiplier on every simulated delay. 1 = demo pace. Never applied to the stop path. */
    pace: number;
    incident: { id: string; title: string; startedAt: string } | null;
  };
  agentStartedAt: string;
  coordinatorLastContactAt: string;
  jobCounter: number;
}

const g = globalThis as unknown as { __powermeshMock?: MockState };

export function state(): MockState {
  if (!g.__powermeshMock) g.__powermeshMock = createState();
  return g.__powermeshMock;
}

function createState(): MockState {
  const now = Date.now();
  const s: MockState = {
    jobs: new Map(),
    events: new Map(),
    correlation: new Map(),
    offers: new Map(),
    nodes: new Map(seedNodes(now).map((n) => [n.id, n])),
    policies: new Map(seedPolicies(now).map((p) => [p.nodeId, p])),
    audit: [],
    listeners: new Map(),
    streamClosers: new Set(),
    timers: new Map(),
    lastJobByNode: new Map(),
    stops: new Map(),
    flags: { coordinatorDown: false, agentConnected: true, pace: 1, incident: null },
    agentStartedAt: new Date(now - 25 * 60_000).toISOString(),
    coordinatorLastContactAt: new Date(now).toISOString(),
    jobCounter: 1040,
  };
  g.__powermeshMock = s;
  seedHistory(s, now);
  return s;
}

export function resetMock(): void {
  const s = g.__powermeshMock;
  if (s) {
    for (const list of s.timers.values()) list.forEach(clearTimeout);
    s.streamClosers.forEach((close) => close());
  }
  g.__powermeshMock = undefined;
  state();
}

/* ── Helpers ────────────────────────────────────────────────────────────── */

const COORDINATOR: Actor = { role: "system", label: "Coordinator" };
const iso = (ms = Date.now()) => new Date(ms).toISOString();
const shortId = () => randomUUID().replace(/-/g, "").slice(0, 10);

function agentActor(node: ProviderNode): Actor {
  return { role: "agent", label: `Agent on ${node.label}` };
}

function pace(ms: number): number {
  return Math.round(ms * state().flags.pace);
}

function schedule(jobId: string, ms: number, fn: () => void, { paced = true } = {}) {
  const s = state();
  const t = setTimeout(
    () => {
      try {
        fn();
      } catch (err) {
        console.error("[offline demo] scheduled step failed", err);
      }
    },
    paced ? pace(ms) : ms,
  );
  const list = s.timers.get(jobId) ?? [];
  list.push(t);
  s.timers.set(jobId, list);
}

function clearTimers(jobId: string) {
  const s = state();
  s.timers.get(jobId)?.forEach(clearTimeout);
  s.timers.delete(jobId);
}

function addAudit(type: AuditEventType, actor: Actor, summary: string, extra: Partial<AuditEvent> = {}, at = iso()): AuditEvent {
  const s = state();
  const event: AuditEvent = {
    id: `aud_${shortId()}`,
    at,
    actor,
    type,
    summary,
    correlationId: extra.jobId ? (s.correlation.get(extra.jobId) ?? randomUUID()) : randomUUID(),
    ...extra,
  };
  s.audit.push(event);
  return event;
}

function pushEvent(job: Job, partial: Omit<JobEvent, "seq" | "id" | "jobId" | "at" | "correlationId" | "attempt">, at = iso()): JobEvent {
  const s = state();
  const list = s.events.get(job.id) ?? [];
  const event: JobEvent = {
    ...partial,
    seq: list.length + 1,
    id: `evt_${shortId()}`,
    jobId: job.id,
    at,
    correlationId: s.correlation.get(job.id)!,
    attempt: job.attempt,
  };
  list.push(event);
  s.events.set(job.id, list);
  s.listeners.get(job.id)?.forEach((fn) => fn(event));
  return event;
}

function log(job: Job, actor: Actor, message: string, extra: Pick<JobEvent, "code" | "reason"> & { at?: string } = {}) {
  pushEvent(job, { type: "log", actor, message, code: extra.code, reason: extra.reason }, extra.at);
}

interface TransitionOpts {
  reason?: TerminalReasonCode;
  message?: string;
  at?: string;
  /** Q1 — only for the lease-expiry retry back to QUEUED. */
  leaseRetry?: boolean;
}

function transition(job: JobRecord, to: JobState, actor: Actor, opts: TransitionOpts = {}) {
  const from = job.state;
  if (!canTransition(from, to, opts.leaseRetry)) {
    throw new Error(`[offline demo] undocumented transition ${from} → ${to} for ${job.id}`);
  }
  const at = opts.at ?? iso();
  job.state = to;
  job.updatedAt = at;
  pushEvent(job, { type: "state", state: to, prevState: from, actor, reason: opts.reason, message: opts.message }, at);
  addAudit("JOB_STATE_CHANGED", actor, `${from} → ${to}`, { jobId: job.id, nodeId: job.assignment?.nodeId, reason: opts.reason }, at);
}

/** Q4: a terminal failure carries a reason code valid for its state. */
function endWith(job: JobRecord, to: "REJECTED" | "DECLINED" | "EXPIRED" | "TIMED_OUT" | "FAILED", code: TerminalReasonCode, reason: string, actor: Actor = COORDINATOR, at?: string) {
  job.failure = { code, reason };
  transition(job, to, actor, { reason: code, message: reason, at });
  clearTimers(job.id);
}

/** Q5: the server job starts in SUBMITTED. There's no server-side DRAFT. */
function open(job: JobRecord, actor: Actor, at = iso()) {
  pushEvent(job, { type: "state", state: "SUBMITTED", actor, message: "Submitted for policy check." }, at);
  addAudit("JOB_SUBMITTED", actor, `Submitted ${job.workload.name} v${job.workload.version}`, { jobId: job.id }, at);
}

/* ── Sessions & access ──────────────────────────────────────────────────── */

export function userForRole(role: string | undefined): MockUser {
  if (role === "provider" || role === "admin" || role === "requester") return USERS[role];
  return USERS.requester;
}

function ownsNode(user: MockUser, nodeId: string | undefined): boolean {
  if (!nodeId) return false;
  return state().nodes.get(nodeId)?.ownerId === user.id;
}

function offersFor(jobId: string): OfferRecord[] {
  return [...state().offers.values()].filter((o) => o.jobId === jobId);
}

function canSeeJob(user: MockUser, job: JobRecord): boolean {
  if (user.role === "admin") return true;
  if (user.role === "requester") return job.requesterId === user.id;
  return ownsNode(user, job.assignment?.nodeId) || offersFor(job.id).some((o) => ownsNode(user, o.nodeId));
}

/** Role-scoped projection (Q9, Q24, Q25). Requesters never learn which node or whose device ran their job. */
export function jobView(job: JobRecord, user: MockUser): Job {
  const { requesterId: _owner, ...rest } = structuredClone(job);
  const view: Job = rest;
  if (user.role === "requester" && view.assignment) {
    const { nodeId: _node, ...assignment } = view.assignment;
    view.assignment = { ...assignment, nodeLabel: `Community provider · ${assignment.os}/${assignment.architecture}` };
  }
  if (user.role === "provider") delete view.inputs.files;
  view.artifacts = view.artifacts.map(signArtifact);
  return view;
}

function offerView(offer: OfferRecord): Offer {
  const { nodeId: _node, withdrawn: _w, ...view } = structuredClone(offer);
  return view;
}

/** Requesters never see which node, agent or person ran their job. */
function actorView(actor: Actor, user: MockUser): Actor {
  if (user.role !== "requester") return actor;
  if (actor.role === "agent") return { role: "agent", label: "Provider agent" };
  if (actor.role === "provider") return { role: "provider", label: "Provider" };
  return actor;
}

export function eventView(event: JobEvent, user: MockUser): JobEvent {
  return user.role === "requester" ? { ...event, actor: actorView(event.actor, user) } : event;
}

function findJob(id: string, user: MockUser): JobRecord {
  const job = state().jobs.get(id);
  if (!job || !canSeeJob(user, job)) throw new MockApiError(404, "NOT_FOUND", "We couldn't find that job.");
  return job;
}

export function getJob(id: string, user: MockUser): Job {
  return jobView(findJob(id, user), user);
}

/* Q15: opaque cursors. Clients must not decode them; here it's just an offset in base64url. */
function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ o: offset })).toString("base64url");
}

function decodeCursor(cursor: string | null | undefined): number {
  if (!cursor) return 0;
  try {
    const o = (JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { o?: unknown }).o;
    if (typeof o === "number" && Number.isInteger(o) && o >= 0) return o;
  } catch {
    /* fall through */
  }
  throw new MockApiError(400, "VALIDATION_FAILED", "That page link is no longer valid. Start from the first page.", { cursor: "Invalid cursor." });
}

function paginate<T>(rows: T[], cursor: string | null | undefined, limit: number | null | undefined): Page<T> {
  const size = Math.min(100, Math.max(1, Number.isFinite(limit) && limit ? Math.floor(limit) : 50));
  const start = decodeCursor(cursor);
  const items = rows.slice(start, start + size);
  return { items, nextCursor: start + size < rows.length ? encodeCursor(start + size) : null };
}

export function listJobs(user: MockUser, { cursor, limit }: { cursor?: string | null; limit?: number | null } = {}): Page<Job> {
  const rows = [...state().jobs.values()]
    .filter((j) => canSeeJob(user, j))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((j) => jobView(j, user));
  return paginate(rows, cursor, limit);
}

export function getEvents(jobId: string, user: MockUser, afterSeq = 0): JobEvent[] {
  findJob(jobId, user);
  return (state().events.get(jobId) ?? []).filter((e) => e.seq > afterSeq).map((e) => eventView(e, user));
}

export function subscribe(jobId: string, fn: Listener): () => void {
  const s = state();
  const set = s.listeners.get(jobId) ?? new Set();
  set.add(fn);
  s.listeners.set(jobId, set);
  return () => set.delete(fn);
}

export function registerStream(close: () => void): () => void {
  const s = state();
  s.streamClosers.add(close);
  return () => s.streamClosers.delete(close);
}

export function assertCoordinatorUp() {
  if (state().flags.coordinatorDown) {
    throw new MockApiError(503, "UNAVAILABLE", "The coordinator is unreachable. Jobs already running on providers continue.");
  }
}

/* ── Artifacts (Q14: scoped 10-minute URLs; failed checks → url null) ──── */

const ARTIFACT_SECRET = "offline-demo-only-not-a-secret";
const ARTIFACT_TTL_MS = 10 * 60_000;

function passed(a: Artifact): boolean {
  return a.validation.length > 0 && a.validation.every((c) => c.passed);
}

function signArtifact(a: Artifact): Artifact {
  if (!passed(a)) return { ...a, url: null, urlExpiresAt: null };
  const exp = Date.now() + ARTIFACT_TTL_MS;
  const sig = createHmac("sha256", ARTIFACT_SECRET).update(`${a.id}.${exp}`).digest("hex").slice(0, 32);
  return { ...a, url: `/api/mock/v1/artifacts/${a.id}?exp=${exp}&sig=${sig}`, urlExpiresAt: iso(exp) };
}

export function resolveArtifact(id: string, exp: string | null, sig: string | null): { artifact: Artifact; file: string } {
  const expMs = Number(exp);
  if (!exp || !sig || !Number.isFinite(expMs)) throw new MockApiError(403, "FORBIDDEN", "Missing artifact token.");
  if (expMs < Date.now()) throw new MockApiError(403, "FORBIDDEN", "This download link expired. Reopen the job to get a fresh one.");
  const expected = createHmac("sha256", ARTIFACT_SECRET).update(`${id}.${expMs}`).digest("hex").slice(0, 32);
  if (expected !== sig) throw new MockApiError(403, "FORBIDDEN", "Invalid artifact token.");
  for (const job of state().jobs.values()) {
    const artifact = job.artifacts.find((a) => a.id === id);
    if (!artifact) continue;
    if (!passed(artifact)) throw new MockApiError(403, "FORBIDDEN", "This file failed validation and can't be downloaded.");
    const out = manifest.outputs.find((o) => o.name === artifact.name);
    if (!out) break;
    return { artifact, file: out.file };
  }
  throw new MockApiError(404, "NOT_FOUND", "Artifact not found.");
}

function buildOutputs(jobId: string): Artifact[] {
  return manifest.outputs.map((o) => ({
    id: `art_${shortId()}`,
    jobId,
    direction: "output" as const,
    name: o.name,
    contentType: o.contentType,
    sizeBytes: o.bytes,
    digest: o.digest,
    url: null,
    urlExpiresAt: null,
    validation: [
      { code: "TYPE_MATCH", label: "File signature matches image/webp", passed: true },
      { code: "SIZE_LIMIT", label: `Within ${formatBytes(IMAGE_TRANSFORM.output.maxBytesPerFile)} output limit`, passed: true },
      { code: "SCHEMA", label: "Allowed output type for this workload", passed: true },
      { code: "DIGEST", label: "Digest recorded and matches upload", passed: true },
    ],
  }));
}

/* ── Submit ─────────────────────────────────────────────────────────────── */

function inputDigest(files: InputFileMeta[]): string {
  return "sha256:" + createHash("sha256").update(JSON.stringify(files)).digest("hex");
}

function sampleInputs(): InputFileMeta[] {
  return manifest.inputs.map((i) => ({ name: i.name, contentType: i.contentType, bytes: i.bytes }));
}

function blankJob(id: string, user: MockUser, at: string): Omit<JobRecord, "workload" | "params" | "inputs" | "inputDigest" | "risk" | "networkMode" | "limits"> {
  return {
    id,
    requesterId: user.id,
    requesterLabel: user.label,
    state: "SUBMITTED",
    attempt: 1,
    maxAttempts: 2,
    assignment: null,
    progress: null,
    usage: null,
    artifacts: [],
    failure: null,
    stoppedBy: null,
    createdAt: at,
    updatedAt: at,
  };
}

export function submitJob(req: SubmitJobRequest, user: MockUser): Job {
  assertCoordinatorUp();
  if (user.role !== "requester") throw new MockApiError(403, "FORBIDDEN", "Only requesters can submit jobs.");

  const workload = getWorkload(req.workloadId);
  if (!workload) throw new MockApiError(400, "VALIDATION_FAILED", "Choose a workload from the catalogue.", { workloadId: "Unknown workload." });
  if (workload.availability.status !== "available") {
    throw new MockApiError(400, "VALIDATION_FAILED", workload.availability.reason, { workloadId: workload.availability.reason });
  }

  // Q8: dotted field keys — workloadId, inputs, inputs.<n>, networkMode, limits.<field>, params.<name>.
  const fields: Record<string, string> = {};
  const files = req.sampleSet === SAMPLE_SET_ID ? sampleInputs() : (req.inputs ?? []);
  const schema = workload.input;
  if (files.length === 0) fields.inputs = "Add at least one image.";
  if (files.length > schema.maxFiles) fields.inputs = `Up to ${schema.maxFiles} files per job.`;
  files.forEach((f, i) => {
    if (!schema.contentTypes.includes(f.contentType)) fields[`inputs.${i}`] = `${f.name} isn't an accepted type (PNG, JPEG or WebP).`;
    else if (f.bytes > schema.maxBytesPerFile) fields[`inputs.${i}`] = `${f.name} is larger than ${formatBytes(schema.maxBytesPerFile)}.`;
  });
  const total = files.reduce((n, f) => n + f.bytes, 0);
  if (total > schema.maxTotalBytes) {
    throw new MockApiError(413, "PAYLOAD_TOO_LARGE", `These inputs add up to ${formatBytes(total)}. The limit is ${formatBytes(schema.maxTotalBytes)}.`, {
      inputs: `Total size is over ${formatBytes(schema.maxTotalBytes)}.`,
    });
  }

  const params: Record<string, string | number> = {};
  for (const spec of paramSpecs(workload.paramsSchema)) {
    const raw = req.params?.[spec.key] ?? spec.default;
    if (spec.type === "enum") {
      if (!spec.options.some((o) => o.value === raw)) fields[`params.${spec.key}`] = "Choose one of the listed options.";
      params[spec.key] = String(raw);
    } else {
      const n = Number(raw);
      const offStep = spec.step ? (n - spec.min) % spec.step !== 0 : false;
      if (!Number.isInteger(n) || n < spec.min || n > spec.max || offStep) {
        fields[`params.${spec.key}`] = `Enter a whole number from ${spec.min} to ${spec.max}${spec.step ? ` in steps of ${spec.step}` : ""}.`;
      }
      params[spec.key] = n;
    }
  }

  if (req.networkMode !== "OPEN_WEB" && !workload.allowedNetworkModes.includes(req.networkMode)) {
    fields.networkMode = "This workload only runs offline.";
  }
  if (Object.keys(fields).length) throw new MockApiError(400, "VALIDATION_FAILED", "Some fields need attention.", fields);

  const requester: Actor = { role: "requester", label: user.label };
  const risk = classifyRisk(workload, req.networkMode);

  // Q6: blocked work never becomes a job. 422 + a standalone audit event; its id is the reference.
  if (risk.tier === "BLOCKED" || risk.tier === "HIGH") {
    const correlationId = randomUUID();
    const reason = risk.tier === "HIGH" ? "ROUTE_DEDICATED_ONLY" : "RISK_BLOCKED";
    const audit = addAudit("JOB_REJECTED", requester, `Submission blocked before scheduling: ${workload.name} (${risk.tier} risk)`, { reason, correlationId });
    throw new MockApiError(422, "RISK_BLOCKED", "This request is blocked by the current safety policy.", undefined, { auditEventId: audit.id, risk }, correlationId);
  }

  const s = state();
  const now = iso();
  const id = `job_${++s.jobCounter}`;
  s.correlation.set(id, randomUUID());
  const job: JobRecord = {
    ...blankJob(id, user, now),
    workload: { id: workload.id, name: workload.name, version: workload.version, digest: workload.imageDigest },
    params,
    inputs: { count: files.length, contentTypes: [...new Set(files.map((f) => f.contentType))], totalBytes: total, files },
    inputDigest: inputDigest(files),
    risk,
    networkMode: req.networkMode,
    limits: workload.limits,
  };
  s.jobs.set(id, job);
  open(job, requester, now);

  schedule(id, 900, () => {
    enqueue(job, `Policy check passed: ${risk.tier} risk.`);
  });

  return jobView(job, user);
}

/* ── Queue, matching & offers (Q2, Q10, Q23) ────────────────────────────── */

/** Enters QUEUED and starts its own five-minute timeout (Q2). */
function enqueue(job: JobRecord, message: string, opts: TransitionOpts = {}) {
  transition(job, "QUEUED", COORDINATOR, { message, ...opts });
  const attempt = job.attempt;
  schedule(job.id, SCHEDULING.queueTimeoutSeconds * 1000, () => {
    if (job.state !== "QUEUED" || job.attempt !== attempt) return;
    endWith(job, "EXPIRED", "QUEUE_TIMEOUT", "No compatible provider was free within 5 minutes.");
  });
  schedule(job.id, 900, () => tryMatch(job));
}

function nodeIsReachable(node: ProviderNode): boolean {
  return node.id === PROVIDER_NODE_ID ? state().flags.agentConnected : node.status !== "offline";
}

function compatibleNode(job: Job): ProviderNode | undefined {
  const s = state();
  const workload = getWorkload(job.workload.id)!;
  return [...s.nodes.values()].find((node) => {
    const policy = s.policies.get(node.id);
    if (!policy || node.status !== "available" || !nodeIsReachable(node)) return false;
    if (!policy.allowedWorkloads.includes(job.workload.id)) return false;
    if (RISK_ORDER.indexOf(job.risk.tier) > RISK_ORDER.indexOf(policy.riskMax)) return false;
    if (job.networkMode === "OPEN_WEB" || !policy.networkModes.includes(job.networkMode) || !node.capability.networkModes.includes(job.networkMode)) return false;
    // Must meet isolation with a *verified* level from a passed probe, never a declared one (Q11).
    if (node.capability.isolation.probeStatus !== "verified" || !node.capability.isolation.verified.includes(workload.minimumIsolation)) return false;
    const caps = policy.resourceCaps;
    return job.limits.memoryBytes <= caps.memoryBytes && job.limits.cpuCores <= caps.cpuCores && job.limits.timeoutSeconds <= caps.timeoutSeconds;
  });
}

function tryMatch(job: JobRecord) {
  if (job.state !== "QUEUED") return;
  const s = state();
  const node = compatibleNode(job);
  if (!node) {
    const waiting = "No compatible provider is available right now. Waiting in the queue.";
    const already = (s.events.get(job.id) ?? []).some((e) => e.type === "log" && e.message === waiting && e.attempt === job.attempt);
    if (!already) log(job, COORDINATOR, waiting);
    return;
  }

  const policy = s.policies.get(node.id)!;
  const workload = getWorkload(job.workload.id)!;
  const offer: OfferRecord = {
    id: `off_${shortId()}`,
    jobId: job.id,
    nodeId: node.id,
    workload: { ...job.workload, signatureVerified: workload.signatureVerified, publisher: workload.publisher, summary: workload.summary },
    inputs: { count: job.inputs.count, contentTypes: job.inputs.contentTypes, totalBytes: job.inputs.totalBytes },
    params: job.params,
    limits: job.limits,
    networkMode: job.networkMode,
    risk: job.risk,
    requesterLabel: job.requesterLabel,
    createdAt: iso(),
    expiresAt: iso(Date.now() + pace(SCHEDULING.offerTtlSeconds * 1000)),
    status: "pending",
    policyRule: null,
  };
  s.offers.set(offer.id, offer);
  transition(job, "OFFERED", COORDINATOR, { message: "Offered to a compatible provider. Waiting for their approval." });
  addAudit("OFFER_CREATED", COORDINATOR, "Offer sent to a compatible provider", { jobId: job.id, nodeId: node.id });

  if (policy.consentMode === "auto") {
    schedule(job.id, 1000, () => {
      if (offer.status !== "pending") return;
      offer.status = "auto_approved";
      offer.decidedAt = iso();
      // Q23: the Agent decides against its local policy; the rule is a versioned code plus contracts copy.
      offer.policyRule = {
        code: "AUTO_APPROVE_WORKLOAD_RISK_NETWORK",
        label: `Auto-approve ${workload.name} v${workload.version}, up to ${policy.riskMax} risk, ${policy.networkModes.join("/")} only.`,
        policyVersion: "provider-policy-v1",
      };
      addAudit("OFFER_AUTO_APPROVED", agentActor(node), offer.policyRule.label, { jobId: job.id, nodeId: node.id, reason: offer.policyRule.code });
      startRun(job, node);
    });
  }

  schedule(job.id, SCHEDULING.offerTtlSeconds * 1000, () => {
    if (offer.status !== "pending") return;
    // Q2: an unanswered offer ends the job. No silent re-offer in v0.
    offer.status = "expired";
    offer.decidedAt = iso();
    addAudit("OFFER_EXPIRED", COORDINATOR, "Offer expired without a decision", { jobId: job.id, nodeId: node.id, reason: "OFFER_EXPIRED" });
    endWith(job, "EXPIRED", "OFFER_EXPIRED", "The provider didn't answer in time.");
  });
}

export function getOffer(id: string, user: MockUser): Offer {
  const offer = state().offers.get(id);
  if (!offer || (user.role !== "admin" && !ownsNode(user, offer.nodeId))) throw new MockApiError(404, "NOT_FOUND", "We couldn't find that request.");
  return offerView(offer);
}

/* ── Execution ──────────────────────────────────────────────────────────── */

function usageAt(job: Job, done: number, total: number, startedAt: number): Job["usage"] {
  const frac = total ? done / total : 0;
  return {
    cpuCores: Math.round((0.55 + 0.35 * Math.random()) * 100) / 100,
    memoryBytes: Math.round((150 + 170 * Math.random()) * 1024 * 1024),
    diskBytes: Math.round((job.inputs.totalBytes ?? 0) * (1 + 0.6 * frac)),
    elapsedSeconds: Math.round((Date.now() - startedAt) / 1000),
  };
}

function bestIsolation(node: ProviderNode) {
  const verified = node.capability.isolation.verified;
  return verified.includes("gvisor") ? "gvisor" : (verified[0] ?? node.capability.runtime);
}

function startRun(job: JobRecord, node: ProviderNode) {
  if (job.state !== "OFFERED") return;
  const s = state();
  const agent = agentActor(node);
  const isolation = bestIsolation(node);
  job.assignment = {
    nodeId: node.id,
    nodeLabel: node.label,
    os: node.os,
    architecture: node.arch,
    isolation,
    leaseUntil: iso(Date.now() + SCHEDULING.leaseSeconds * 1000),
  };
  node.status = "busy";
  s.lastJobByNode.set(node.id, job.id);
  transition(job, "CLAIMED", agent, { message: "Assignment claimed. Manifest signature, nonce and expiry verified." });

  schedule(job.id, 1000, () => {
    // Q25: staged under generated names; the provider never sees requester file names.
    transition(job, "STAGING", agent, { message: "Staging inputs read-only." });
    log(job, agent, `Staged ${formatInputs(job.inputs)} into /input (read-only) as input-001… Input digest verified.`);
    schedule(job.id, 1400, () => {
      const startedAt = Date.now();
      job.progress = { done: 0, total: job.inputs.count, unit: "images" };
      job.usage = usageAt(job, 0, job.inputs.count, startedAt);
      transition(job, "RUNNING", agent, { message: `Sandbox started · rootless · ${isolation} · network: none.` });
      runStep(job, node, 0, startedAt);
    });
  });
}

function runStep(job: JobRecord, node: ProviderNode, done: number, startedAt: number) {
  const total = job.inputs.count;
  schedule(job.id, 2600, () => {
    if (job.state !== "RUNNING") return;
    const next = done + 1;
    job.progress = { done: next, total, unit: "images" };
    job.usage = usageAt(job, next, total, startedAt);
    if (job.assignment) job.assignment.leaseUntil = iso(Date.now() + SCHEDULING.leaseSeconds * 1000);
    pushEvent(job, { type: "progress", progress: job.progress, usage: job.usage ?? undefined, actor: agentActor(node), message: `Processed image ${next} of ${total}.` });
    if (next < total) {
      runStep(job, node, next, startedAt);
      return;
    }
    schedule(job.id, 800, () => finish(job, node));
  });
}

function finish(job: JobRecord, node: ProviderNode) {
  const agent = agentActor(node);
  transition(job, "VALIDATING", agent, { message: "Checking output type, size and digest." });
  schedule(job.id, 1600, () => {
    job.artifacts = buildOutputs(job.id);
    log(job, agent, `${job.artifacts.length} output(s) passed type, size and schema checks. Uploaded with a short-lived scoped token.`);
    addAudit("ARTIFACT_VALIDATED", agent, `${job.artifacts.length} outputs validated`, { jobId: job.id, nodeId: node.id });
    transition(job, "SUCCEEDED", COORDINATOR, { message: "Result validated and ready." });
    log(job, agent, "Sandbox removed. Workspace cleanup verified.", { code: "WORKSPACE_CLEANED" });
    addAudit("WORKSPACE_CLEANED", agent, "Workspace cleanup verified", { jobId: job.id, nodeId: node.id });
    node.status = "available";
    clearTimers(job.id);
    requeueWaiting();
  });
}

function requeueWaiting() {
  for (const job of state().jobs.values()) if (job.state === "QUEUED") tryMatch(job);
}

/* ── Stop / cancel (Q3, Q22) ─────────────────────────────────────────────── */

/** States where a sandbox may exist on the provider, so the Agent must run its stop sequence. */
const SANDBOX_STATES: JobState[] = ["CLAIMED", "STAGING", "RUNNING"];

const STOP_COPY: Record<AgentStopEvent, string> = {
  NETWORK_REVOKED: "Network revoked for this sandbox.",
  TERMINATION_REQUESTED: "Sandbox asked to exit.",
  PROCESS_KILLED: "Sandbox process killed and confirmed gone.",
  WORKSPACE_CLEANED: "Workspace cleanup verified.",
};

function stoppedByFor(actor: Actor, reasonCode: StopReasonCode): StoppedBy {
  const role = actor.role === "requester" || actor.role === "provider" ? actor.role : "admin";
  return { role, label: actor.label, reasonCode };
}

function stopMessage(reasonCode: StopReasonCode): string {
  return reasonCode === "PROVIDER_STOP" ? "Stopped by the provider on their device." : reasonCode === "REQUESTER_CANCEL" ? "Cancelled by the requester." : "Stopped by an admin.";
}

/**
 * The Agent's local stop sequence (Q22). The clock starts when the Agent records the request and ends at
 * PROCESS_KILLED, which is when the job becomes CANCELLED. Cleanup is separate. Fixed timings: never paced.
 */
function runStopSequence(job: JobRecord, node: ProviderNode, actor: Actor, reasonCode: StopReasonCode, { pauseAfter }: { pauseAfter: boolean }) {
  const s = state();
  const agent = agentActor(node);
  clearTimers(job.id);
  const run: StopRun = { jobId: job.id, requestedAt: iso(), steps: [] };
  s.stops.set(node.id, run);
  log(job, actor, reasonCode === "PROVIDER_STOP" ? "The provider asked their Agent to stop this job." : "Stop requested; relayed to the provider's Agent.");
  const step = (name: AgentStopEvent) => {
    run.steps.push({ step: name, at: iso() });
    log(job, agent, STOP_COPY[name], { code: name });
    addAudit(name, agent, STOP_COPY[name], { jobId: job.id, nodeId: node.id, reason: reasonCode });
  };
  schedule(job.id, 150, () => step("NETWORK_REVOKED"), { paced: false });
  schedule(job.id, 300, () => step("TERMINATION_REQUESTED"), { paced: false });
  schedule(
    job.id,
    1100,
    () => {
      step("PROCESS_KILLED");
      job.stoppedBy = stoppedByFor(actor, reasonCode);
      transition(job, "CANCELLED", actor, { reason: reasonCode, message: stopMessage(reasonCode) });
      addAudit("JOB_STOPPED", actor, `Stopped (${reasonCode})`, { jobId: job.id, nodeId: node.id, reason: reasonCode });
    },
    { paced: false },
  );
  schedule(
    job.id,
    1700,
    () => {
      step("WORKSPACE_CLEANED");
      if (pauseAfter) {
        // Q12: after a provider emergency stop, no new offers until the provider resumes.
        node.status = "paused";
        addAudit("POLICY_UPDATED", agent, "Sharing paused after an emergency stop. Waiting for the provider to resume.", { nodeId: node.id });
      } else if (node.status === "busy") {
        node.status = "available";
        requeueWaiting();
      }
    },
    { paced: false },
  );
}

/** POST /v1/jobs/:id/cancel — requester (or admin). Q3: allowed while OFFERED; the offer is withdrawn. */
export function cancelJob(id: string, user: MockUser): Job {
  assertCoordinatorUp();
  const job = findJob(id, user);
  if (user.role === "provider") throw new MockApiError(403, "FORBIDDEN", "Providers stop jobs from their Provider Console.");
  if (!canTransition(job.state, "CANCELLED")) throw new MockApiError(409, "CONFLICT", "This job can no longer be cancelled.");
  const actor: Actor = { role: user.role, label: user.label };
  const reasonCode: StopReasonCode = user.role === "admin" ? "ADMIN_STOP" : "REQUESTER_CANCEL";
  const node = job.assignment?.nodeId ? state().nodes.get(job.assignment.nodeId) : undefined;
  if (node && SANDBOX_STATES.includes(job.state)) {
    if (!nodeIsReachable(node)) {
      throw new MockApiError(409, "CONFLICT", "The provider's Agent isn't connected, so the stop can't be delivered. Its lease expires on its own.");
    }
    runStopSequence(job, node, actor, reasonCode, { pauseAfter: false });
    return jobView(job, user);
  }
  for (const offer of offersFor(job.id)) {
    if (offer.status === "pending") {
      // Q3: withdrawn atomically; a later decision or claim on it gets 409.
      offer.withdrawn = true;
      offer.status = "expired";
      offer.decidedAt = iso();
    }
  }
  clearTimers(job.id);
  job.stoppedBy = stoppedByFor(actor, reasonCode);
  transition(job, "CANCELLED", actor, { reason: reasonCode, message: stopMessage(reasonCode) });
  addAudit("JOB_STOPPED", actor, `Cancelled before it ran (${reasonCode})`, { jobId: job.id, reason: reasonCode });
  return jobView(job, user);
}

/* ── Provider's Agent: local API (Q21 / ADR-002) ────────────────────────── */

function providerNode(user: MockUser): ProviderNode {
  if (user.role !== "provider") throw new MockApiError(403, "FORBIDDEN", "This console belongs to the provider who paired with this device's Agent.");
  return state().nodes.get(PROVIDER_NODE_ID)!;
}

/** The Agent process itself is down: its local origin can't load (simulated by "Agent connected" off). */
function assertAgentRunning() {
  if (!state().flags.agentConnected) {
    throw new MockApiError(503, "UNAVAILABLE", "The PowerMesh Agent on this device isn't running.");
  }
}

const ACTIVE_STATES: JobState[] = ["CLAIMED", "STAGING", "RUNNING", "VALIDATING"];

/** GET /v1/local/state — answers even while the coordinator is down. */
export function agentState(user: MockUser): AgentLocalState {
  assertAgentRunning();
  const s = state();
  const node = providerNode(user);
  node.heartbeatAt = iso();
  if (!s.flags.coordinatorDown) s.coordinatorLastContactAt = iso();
  const jobs = [...s.jobs.values()].filter((j) => j.assignment?.nodeId === node.id);
  const active = jobs.find((j) => ACTIVE_STATES.includes(j.state)) ?? null;
  const pending = [...s.offers.values()].find((o) => o.nodeId === node.id && o.status === "pending" && Date.parse(o.expiresAt) > Date.now()) ?? null;
  const lastId = s.lastJobByNode.get(node.id);
  const last = lastId ? (s.jobs.get(lastId) ?? null) : null;
  const stop = s.stops.get(node.id) ?? null;
  return {
    agent: { version: node.agentVersion, startedAt: s.agentStartedAt },
    coordinator: { reachable: !s.flags.coordinatorDown, lastContactAt: s.coordinatorLastContactAt },
    node: structuredClone(node),
    policy: structuredClone(s.policies.get(node.id)!),
    pendingOffer: pending ? offerView(pending) : null,
    activeJob: active ? jobView(active, user) : null,
    lastJob: last && isTerminal(last.state) ? jobView(last, user) : null,
    stop: stop ? structuredClone(stop) : null,
  };
}

/** POST /v1/local/stop — handled on the device; never waits for the coordinator. */
export function agentStop(user: MockUser): AgentLocalState {
  assertAgentRunning();
  const s = state();
  const node = providerNode(user);
  const job = [...s.jobs.values()].find((j) => j.assignment?.nodeId === node.id && SANDBOX_STATES.includes(j.state));
  if (!job) throw new MockApiError(409, "CONFLICT", "Nothing is running on this device.");
  const inFlight = s.stops.get(node.id);
  if (!(inFlight?.jobId === job.id && !inFlight.steps.some((x) => x.step === "PROCESS_KILLED"))) {
    runStopSequence(job, node, { role: "provider", label: user.label }, "PROVIDER_STOP", { pauseAfter: true });
  }
  return agentState(user);
}

/** POST /v1/local/availability — pausing never stops the current job. */
export function agentSetAvailability(user: MockUser, available: boolean): AgentLocalState {
  assertAgentRunning();
  const node = providerNode(user);
  const provider: Actor = { role: "provider", label: user.label };
  if (available && node.status === "paused") {
    node.status = "available";
    addAudit("POLICY_UPDATED", provider, "Provider resumed sharing", { nodeId: node.id });
    requeueWaiting();
  } else if (!available && node.status === "available") {
    node.status = "paused";
    addAudit("POLICY_UPDATED", provider, "Provider paused new requests", { nodeId: node.id });
  }
  return agentState(user);
}

/** POST /v1/local/offers/:id/decision — the Agent signs it and mirrors it to the coordinator. */
export function agentDecideOffer(id: string, decision: "approve" | "decline", user: MockUser): Offer {
  assertAgentRunning();
  const s = state();
  const node = providerNode(user);
  const offer = s.offers.get(id);
  if (!offer || offer.nodeId !== node.id) throw new MockApiError(404, "NOT_FOUND", "We couldn't find that request.");
  if (s.flags.coordinatorDown) {
    throw new MockApiError(503, "UNAVAILABLE", "The coordinator is unreachable, so your decision can't be confirmed. The request will expire on its own; nothing runs.");
  }
  if (offer.withdrawn) throw new MockApiError(409, "CONFLICT", "The requester cancelled this job before you decided.");
  if (offer.status === "expired" || Date.parse(offer.expiresAt) < Date.now()) {
    throw new MockApiError(409, "OFFER_EXPIRED", "This request expired before a decision was made.");
  }
  if (offer.status !== "pending") throw new MockApiError(409, "CONFLICT", "This request was already decided.");
  const job = s.jobs.get(offer.jobId)!;
  const provider: Actor = { role: "provider", label: user.label };
  offer.decidedAt = iso();
  if (decision === "approve") {
    offer.status = "approved";
    addAudit("OFFER_APPROVED", provider, "Approved once", { jobId: job.id, nodeId: node.id });
    schedule(job.id, 600, () => startRun(job, node));
  } else {
    // Q2: a decline ends the job in v0.
    offer.status = "declined";
    addAudit("OFFER_DECLINED", provider, "Declined", { jobId: job.id, nodeId: node.id, reason: "PROVIDER_DECLINED" });
    endWith(job, "DECLINED", "PROVIDER_DECLINED", "The provider declined this request.", provider);
  }
  return offerView(offer);
}

/* ── Policy (Q13) ───────────────────────────────────────────────────────── */

export function getPolicy(nodeId: string, user: MockUser): ProviderPolicy {
  assertCoordinatorUp();
  if (user.role === "requester" || (user.role === "provider" && !ownsNode(user, nodeId))) {
    throw new MockApiError(403, "FORBIDDEN", "You can only view policy for your own node.");
  }
  const policy = state().policies.get(nodeId);
  if (!policy) throw new MockApiError(404, "NOT_FOUND", "Unknown node.");
  return policy;
}

function isIanaZone(tz: unknown): boolean {
  if (typeof tz !== "string" || !tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function putPolicy(nodeId: string, body: Partial<ProviderPolicy>, user: MockUser): ProviderPolicy {
  assertCoordinatorUp();
  if (user.role !== "provider" || !ownsNode(user, nodeId)) throw new MockApiError(403, "FORBIDDEN", "Only this node's provider can change its policy.");
  const current = getPolicy(nodeId, user);
  const node = state().nodes.get(nodeId)!;
  const fields: Record<string, string> = {};
  if (body.riskMax && !["LOW", "MEDIUM"].includes(body.riskMax)) fields.riskMax = "Personal nodes accept LOW or MEDIUM only.";
  if ((body.networkModes as string[] | undefined)?.includes("OPEN_WEB")) fields.networkModes = "Open internet isn't available on personal nodes.";
  if (body.schedule) {
    if (body.schedule.mode === "window") {
      if (!HHMM.test(body.schedule.start)) fields["schedule.start"] = "Use a 24-hour time like 18:00.";
      if (!HHMM.test(body.schedule.end)) fields["schedule.end"] = "Use a 24-hour time like 08:00.";
      if (body.schedule.start === body.schedule.end) fields["schedule.end"] = "The window must end at a different time than it starts.";
    }
    if (!isIanaZone(body.schedule.timezone)) fields["schedule.timezone"] = "Choose a time zone from the list.";
  }
  const caps = body.resourceCaps;
  if (caps) {
    const cap = node.capability;
    const positiveInt = (n: number) => Number.isInteger(n) && n > 0;
    if (!(caps.cpuCores > 0 && caps.cpuCores <= cap.cpuCores)) fields["resourceCaps.cpuCores"] = `Enter more than 0 and at most ${cap.cpuCores} cores.`;
    if (!(positiveInt(caps.memoryBytes) && caps.memoryBytes <= cap.memoryBytes)) fields["resourceCaps.memoryBytes"] = `Enter more than 0 and at most ${formatBytes(cap.memoryBytes)}.`;
    if (!(positiveInt(caps.diskBytes) && caps.diskBytes <= cap.diskBytes)) fields["resourceCaps.diskBytes"] = `Enter more than 0 and at most ${formatBytes(cap.diskBytes)}.`;
    if (!(positiveInt(caps.timeoutSeconds) && caps.timeoutSeconds <= 86_400)) fields["resourceCaps.timeoutSeconds"] = "Enter a run time from 1 second to 24 hours.";
    if (!positiveInt(caps.pidLimit)) fields["resourceCaps.pidLimit"] = "Enter a whole number of processes above 0.";
    if (!positiveInt(caps.maxOutputBytes)) fields["resourceCaps.maxOutputBytes"] = "Enter an output size above 0.";
  }
  if (Object.keys(fields).length) throw new MockApiError(400, "VALIDATION_FAILED", "Some fields need attention.", fields);
  const next: ProviderPolicy = { ...current, ...body, nodeId, updatedAt: iso() };
  state().policies.set(nodeId, next);
  addAudit("POLICY_UPDATED", { role: "provider", label: user.label }, "Provider policy updated", { nodeId });
  requeueWaiting();
  return next;
}

/* ── Nodes, health, audit (Q15–Q17) ─────────────────────────────────────── */

export function listNodes(user: MockUser): ProviderNode[] {
  assertCoordinatorUp();
  const nodes = [...state().nodes.values()].map((n) => ({ ...n, status: nodeIsReachable(n) ? n.status : ("offline" as const) }));
  if (user.role === "admin") return nodes;
  if (user.role === "provider") return nodes.filter((n) => n.ownerId === user.id);
  return [];
}

/** Q16: status + reasonCode are coordinator policy; reason comes from shared copy. */
const HEALTH_COPY: Record<NetworkHealth["reasonCode"], (n: NetworkHealth["nodes"]) => string> = {
  OK: (n) => `${n.available} provider${n.available === 1 ? "" : "s"} ready, ${n.busy} busy.`,
  NO_PROVIDERS: () => "No providers are accepting work right now. New jobs wait in the queue for up to 5 minutes.",
  RECENT_LEASE_EXPIRY: () => "A provider stopped sending heartbeats in the last 5 minutes. Affected jobs were retried once or failed.",
  OPEN_INCIDENT: () => "Admins are investigating an incident. Jobs keep running.",
};

export function networkHealth(): NetworkHealth {
  assertCoordinatorUp();
  const s = state();
  const nodes = [...s.nodes.values()].map((n) => (nodeIsReachable(n) ? n.status : "offline"));
  const count = (st: string) => nodes.filter((n) => n === st).length;
  const jobs = [...s.jobs.values()];
  const counts = { total: nodes.length, available: count("available"), busy: count("busy"), offline: count("offline"), paused: count("paused") };
  const recentLeaseExpiry = s.audit.some((a) => a.type === "LEASE_EXPIRED" && Date.now() - Date.parse(a.at) < 5 * 60_000);
  let status: NetworkHealth["status"] = "healthy";
  let reasonCode: NetworkHealth["reasonCode"] = "OK";
  if (s.flags.incident) {
    status = "incident";
    reasonCode = "OPEN_INCIDENT";
  } else if (counts.available + counts.busy === 0) {
    status = "no_providers";
    reasonCode = "NO_PROVIDERS";
  } else if (recentLeaseExpiry) {
    status = "degraded";
    reasonCode = "RECENT_LEASE_EXPIRY";
  }
  return {
    status,
    reasonCode,
    reason: HEALTH_COPY[reasonCode](counts),
    coordinator: "online",
    nodes: counts,
    activeJobs: jobs.filter((j) => ACTIVE_STATES.includes(j.state)).length,
    queuedJobs: jobs.filter((j) => ["SUBMITTED", "QUEUED", "OFFERED"].includes(j.state)).length,
    incident: s.flags.incident ?? undefined,
    checkedAt: iso(),
  };
}

export interface AuditFilters {
  jobId?: string;
  nodeId?: string;
  type?: string;
  q?: string;
}

function auditRows(user: MockUser, filters: AuditFilters): AuditEvent[] {
  assertCoordinatorUp();
  const s = state();
  const q = filters.q?.trim().toLowerCase();
  return s.audit
    .filter((a) => {
      if (user.role === "requester") {
        const job = a.jobId ? s.jobs.get(a.jobId) : undefined;
        const ownBlocked = !a.jobId && a.type === "JOB_REJECTED" && a.actor.role === "requester" && a.actor.label === user.label;
        if (!ownBlocked && (!job || job.requesterId !== user.id)) return false;
      } else if (user.role === "provider") {
        const job = a.jobId ? s.jobs.get(a.jobId) : undefined;
        if (!ownsNode(user, a.nodeId) && !ownsNode(user, job?.assignment?.nodeId)) return false;
      }
      if (filters.jobId && a.jobId !== filters.jobId) return false;
      if (filters.nodeId && a.nodeId !== filters.nodeId) return false;
      if (filters.type && a.type !== filters.type) return false;
      // Q17: server-side search over safe summary, ids and reason codes.
      if (q && ![a.summary, a.reason, a.id, a.jobId, a.correlationId].some((v) => v?.toLowerCase().includes(q))) return false;
      return true;
    })
    .sort((a, b) => b.at.localeCompare(a.at))
    .map((a) => (user.role === "requester" ? { ...a, nodeId: undefined, actor: actorView(a.actor, user) } : a));
}

export function listAudit(user: MockUser, filters: AuditFilters, page: { cursor?: string | null; limit?: number | null } = {}): Page<AuditEvent> {
  return paginate(auditRows(user, filters), page.cursor, page.limit);
}

/** POST /v1/audit/exports — complete, authorised and redacted on the server (Q17). */
export function exportAudit(user: MockUser, filters: AuditFilters): AuditEvent[] {
  return auditRows(user, filters);
}

/* ── Demo controls (rehearsal: network failure, provider disappears) ────── */

export type DevAction =
  | { action: "agent-disconnect" }
  | { action: "agent-reconnect" }
  | { action: "coordinator-down" }
  | { action: "coordinator-up" }
  | { action: "incident-open" }
  | { action: "incident-close" }
  | { action: "pace"; value: number }
  | { action: "reset" };

export function devControl(cmd: DevAction) {
  const s = state();
  switch (cmd.action) {
    case "agent-disconnect": {
      s.flags.agentConnected = false;
      const node = s.nodes.get(PROVIDER_NODE_ID)!;
      addAudit("NODE_DISCONNECTED", agentActor(node), "Agent stopped sending heartbeats", { nodeId: node.id });
      for (const job of s.jobs.values()) {
        if (job.assignment?.nodeId !== node.id || !SANDBOX_STATES.includes(job.state)) continue;
        clearTimers(job.id);
        // Q19: 30 s lease plus 10 s grace — real timings, not demo-paced.
        const ms = (SCHEDULING.leaseSeconds + SCHEDULING.leaseGraceSeconds) * 1000;
        log(job, COORDINATOR, `The provider's Agent stopped sending heartbeats. The lease expires in ${ms / 1000}s if it doesn't come back.`, { code: "HEARTBEAT_MISSED" });
        schedule(job.id, ms, () => expireLease(job, node), { paced: false });
      }
      break;
    }
    case "agent-reconnect": {
      s.flags.agentConnected = true;
      const node = s.nodes.get(PROVIDER_NODE_ID)!;
      const hasJob = [...s.jobs.values()].some((j) => j.assignment?.nodeId === node.id && SANDBOX_STATES.includes(j.state));
      if ((node.status === "busy" && !hasJob) || node.status === "offline") node.status = "available";
      node.heartbeatAt = iso();
      addAudit("NODE_CONNECTED", agentActor(node), "Agent reconnected over its outbound channel", { nodeId: node.id });
      requeueWaiting();
      break;
    }
    case "coordinator-down":
      s.flags.coordinatorDown = true;
      s.streamClosers.forEach((close) => close());
      break;
    case "coordinator-up":
      s.flags.coordinatorDown = false;
      s.coordinatorLastContactAt = iso();
      break;
    case "incident-open":
      s.flags.incident = { id: randomUUID(), title: "Unusual output validation failures", startedAt: iso() };
      break;
    case "incident-close":
      s.flags.incident = null;
      break;
    case "pace":
      s.flags.pace = Math.min(5, Math.max(0.1, cmd.value));
      break;
    case "reset":
      resetMock();
      break;
  }
  return devStatus();
}

export function devStatus() {
  const s = state();
  return { ...s.flags };
}

function expireLease(job: JobRecord, node: ProviderNode) {
  if (!SANDBOX_STATES.includes(job.state)) return;
  const workload = getWorkload(job.workload.id)!;
  const retryScheduled = workload.idempotent && job.attempt < SCHEDULING.maxAttempts;
  log(job, COORDINATOR, retryScheduled ? "Lease expired. Retrying on another eligible provider." : "Lease expired. No retry left.", {
    code: "LEASE_EXPIRED",
    reason: "LEASE_EXPIRED",
  });
  addAudit("LEASE_EXPIRED", COORDINATOR, `Lease expired for attempt ${job.attempt}; retry ${retryScheduled ? "scheduled" : "not possible"}`, {
    jobId: job.id,
    nodeId: node.id,
    reason: "LEASE_EXPIRED",
  });
  node.status = "offline";
  if (retryScheduled) {
    // Q1: same job, attempt 2, back to QUEUED, then the normal offer sequence.
    job.attempt = 2;
    job.assignment = null;
    job.progress = null;
    job.usage = null;
    enqueue(job, "Requeued once — this workload is safe to repeat.", { leaseRetry: true, reason: "LEASE_EXPIRED" });
  } else {
    endWith(job, "FAILED", "LEASE_EXPIRED", "The provider stopped responding, and the one retry was already used.");
  }
}

/* ── Seed history ───────────────────────────────────────────────────────── */

function seedHistory(s: MockState, now: number) {
  const req: Actor = { role: "requester", label: USERS.requester.label };
  const prov: Actor = { role: "provider", label: USERS.provider.label };
  const node = s.nodes.get(PROVIDER_NODE_ID)!;
  const agent = agentActor(node);
  const files = sampleInputs();
  const at = (job: Job, seconds: number) => iso(Date.parse(job.createdAt) + seconds * 1000);

  const make = (id: string, minutesAgo: number): JobRecord => {
    const createdAt = iso(now - minutesAgo * 60_000);
    s.correlation.set(id, randomUUID());
    const job: JobRecord = {
      ...blankJob(id, USERS.requester, createdAt),
      workload: { id: IMAGE_TRANSFORM.id, name: IMAGE_TRANSFORM.name, version: IMAGE_TRANSFORM.version, digest: IMAGE_TRANSFORM.imageDigest },
      params: { format: "webp", maxWidth: 1600, quality: 82 },
      inputs: { count: files.length, contentTypes: ["image/png"], totalBytes: files.reduce((n, f) => n + f.bytes, 0), files },
      inputDigest: inputDigest(files),
      risk: classifyRisk(IMAGE_TRANSFORM, "OFFLINE", new Date(createdAt)),
      networkMode: "OFFLINE",
      limits: IMAGE_TRANSFORM.limits,
    };
    s.jobs.set(id, job);
    open(job, req, createdAt);
    return job;
  };
  const step = (job: JobRecord, to: JobState, actor: Actor, secondsAfter: number, opts: TransitionOpts = {}) =>
    transition(job, to, actor, { ...opts, at: at(job, secondsAfter) });
  const offer = (job: JobRecord, secondsAfter: number, status: Offer["status"]) => {
    const workload = IMAGE_TRANSFORM;
    const id = `off_${shortId()}`;
    s.offers.set(id, {
      id,
      jobId: job.id,
      nodeId: node.id,
      workload: { ...job.workload, signatureVerified: workload.signatureVerified, publisher: workload.publisher, summary: workload.summary },
      inputs: { count: job.inputs.count, contentTypes: job.inputs.contentTypes, totalBytes: job.inputs.totalBytes },
      params: job.params,
      limits: job.limits,
      networkMode: job.networkMode,
      risk: job.risk,
      requesterLabel: job.requesterLabel,
      createdAt: at(job, secondsAfter),
      expiresAt: at(job, secondsAfter + SCHEDULING.offerTtlSeconds),
      decidedAt: at(job, secondsAfter + 10),
      status,
      policyRule: null,
    });
  };
  const claim = (job: JobRecord, secondsAfter: number) => {
    job.assignment = { nodeId: node.id, nodeLabel: node.label, os: node.os, architecture: node.arch, isolation: "gvisor", leaseUntil: at(job, secondsAfter + SCHEDULING.leaseSeconds) };
    step(job, "CLAIMED", agent, secondsAfter);
    step(job, "STAGING", agent, secondsAfter + 1);
  };

  // 1. Succeeded — the reference happy path.
  const ok = make("job_1031", 140);
  step(ok, "QUEUED", COORDINATOR, 1, { message: "Policy check passed: LOW risk." });
  step(ok, "OFFERED", COORDINATOR, 2);
  offer(ok, 2, "approved");
  claim(ok, 14);
  step(ok, "RUNNING", agent, 17);
  ok.progress = { done: 3, total: 3, unit: "images" };
  ok.usage = { cpuCores: 0.82, memoryBytes: 268 * 1024 * 1024, diskBytes: 11 * 1024 * 1024, elapsedSeconds: 9 };
  step(ok, "VALIDATING", agent, 26);
  ok.artifacts = buildOutputs(ok.id);
  step(ok, "SUCCEEDED", COORDINATOR, 28, { message: "Result validated and ready." });

  // 2. Blocked — open internet requested. Q6: no job, only a standalone audit event.
  s.audit.push({
    id: "aud_seed_open_web",
    at: iso(now - 95 * 60_000),
    actor: req,
    type: "JOB_REJECTED",
    summary: "Submission blocked before scheduling: Image transform (BLOCKED risk, open internet requested)",
    reason: "RISK_BLOCKED",
    correlationId: randomUUID(),
  });

  // 3. Stopped by the provider, with the Agent's stop events (Q22).
  const stop = make("job_1036", 70);
  step(stop, "QUEUED", COORDINATOR, 1);
  step(stop, "OFFERED", COORDINATOR, 2);
  offer(stop, 2, "approved");
  claim(stop, 9);
  step(stop, "RUNNING", agent, 12);
  stop.progress = { done: 1, total: 3, unit: "images" };
  log(stop, prov, "The provider asked their Agent to stop this job.", { at: at(stop, 15) });
  (["NETWORK_REVOKED", "TERMINATION_REQUESTED", "PROCESS_KILLED"] as const).forEach((code, i) => log(stop, agent, STOP_COPY[code], { code, at: at(stop, 15.2 + i * 0.3) }));
  stop.stoppedBy = { role: "provider", label: prov.label, reasonCode: "PROVIDER_STOP" };
  step(stop, "CANCELLED", prov, 16.1, { reason: "PROVIDER_STOP", message: stopMessage("PROVIDER_STOP") });
  log(stop, agent, STOP_COPY.WORKSPACE_CLEANED, { code: "WORKSPACE_CLEANED", at: at(stop, 16.8) });

  // 4. Declined by the provider (Q2: terminal for the job).
  const dec = make("job_1037", 55);
  step(dec, "QUEUED", COORDINATOR, 1);
  step(dec, "OFFERED", COORDINATOR, 2);
  offer(dec, 2, "declined");
  dec.failure = { code: "PROVIDER_DECLINED", reason: "The provider declined this request." };
  step(dec, "DECLINED", prov, 12, { reason: "PROVIDER_DECLINED", message: dec.failure.reason });

  // 5. Failed output validation (Q14): the failed file stays visible with url null.
  const bad = make("job_1038", 40);
  step(bad, "QUEUED", COORDINATOR, 1);
  step(bad, "OFFERED", COORDINATOR, 2);
  offer(bad, 2, "approved");
  claim(bad, 8);
  step(bad, "RUNNING", agent, 11);
  step(bad, "VALIDATING", agent, 20);
  bad.artifacts = [
    {
      id: `art_${shortId()}`,
      jobId: bad.id,
      direction: "output",
      name: "output-002.webp",
      contentType: "image/webp",
      sizeBytes: 48_213,
      digest: "sha256:0f3c51a9d2b84e67c1a05f9e3d7b2c4a6e8f0a1b3c5d7e9f2a4b6c8d0e1f3a5b",
      url: null,
      urlExpiresAt: null,
      validation: [
        { code: "TYPE_MATCH", label: "File signature matches image/webp", passed: false },
        { code: "SIZE_LIMIT", label: `Within ${formatBytes(IMAGE_TRANSFORM.output.maxBytesPerFile)} output limit`, passed: true },
        { code: "SCHEMA", label: "Allowed output type for this workload", passed: true },
      ],
    },
  ];
  addAudit("ARTIFACT_VALIDATED", agent, "1 output failed the type check and was quarantined", { jobId: bad.id, nodeId: node.id, reason: "OUTPUT_VALIDATION_FAILED" }, at(bad, 21));
  bad.failure = { code: "OUTPUT_VALIDATION_FAILED", reason: "An output file wasn't a valid image (type check failed)." };
  step(bad, "FAILED", agent, 21, { reason: "OUTPUT_VALIDATION_FAILED", message: bad.failure.reason });

  s.lastJobByNode.set(node.id, bad.id);
}
