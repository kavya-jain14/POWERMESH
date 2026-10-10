/**
 * ⚠️ MOCK COORDINATOR + LOCAL AGENT — in-memory, dev/demo only.
 *
 * Stands in for Kavya's API (K1–K11) so the UI can be built and rehearsed against live behaviour.
 * It enforces the canonical state table (contracts-draft TRANSITIONS) — any undocumented transition
 * throws. The one exception is the *proposed* lease-expiry requeue (G1 §6 Q1), flagged where used.
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
  canTransition,
  isTerminal,
  type Actor,
  type AgentLocalState,
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
  type ProviderNode,
  type ProviderPolicy,
  type StopReasonCode,
  type SubmitJobRequest,
} from "@/contracts-draft/types";

/* ── Errors ─────────────────────────────────────────────────────────────── */

export class MockApiError extends Error {
  constructor(
    public status: number,
    public code: ErrorCode,
    message: string,
    public fields?: Record<string, string>,
  ) {
    super(message);
  }
}

/* ── State ──────────────────────────────────────────────────────────────── */

type Listener = (event: JobEvent) => void;

interface MockState {
  jobs: Map<string, Job>;
  events: Map<string, JobEvent[]>;
  correlation: Map<string, string>;
  offers: Map<string, Offer>;
  nodes: Map<string, ProviderNode>;
  policies: Map<string, ProviderPolicy>;
  audit: AuditEvent[];
  listeners: Map<string, Set<Listener>>;
  streamClosers: Set<() => void>;
  timers: Map<string, Array<ReturnType<typeof setTimeout>>>;
  lastJobByNode: Map<string, string>;
  stopping: Set<string>;
  flags: {
    coordinatorDown: boolean;
    agentConnected: boolean;
    /** Multiplier on every simulated delay. 1 = demo pace. */
    pace: number;
    incident: { id: string; title: string; openedAt: string } | null;
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
    stopping: new Set(),
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

const COORDINATOR: Actor = { role: "coordinator", label: "Coordinator" };
const iso = (ms = Date.now()) => new Date(ms).toISOString();
const shortId = () => randomUUID().replace(/-/g, "").slice(0, 10);

function agentActor(node: ProviderNode): Actor {
  return { role: "agent", label: `Agent on ${node.label}` };
}

function pace(ms: number): number {
  return Math.round(ms * state().flags.pace);
}

function schedule(jobId: string, ms: number, fn: () => void) {
  const s = state();
  const t = setTimeout(() => {
    try {
      fn();
    } catch (err) {
      console.error("[mock] scheduled step failed", err);
    }
  }, pace(ms));
  const list = s.timers.get(jobId) ?? [];
  list.push(t);
  s.timers.set(jobId, list);
}

function clearTimers(jobId: string) {
  const s = state();
  s.timers.get(jobId)?.forEach(clearTimeout);
  s.timers.delete(jobId);
}

function addAudit(type: AuditEventType, actor: Actor, summary: string, extra: Partial<AuditEvent> = {}, at = iso()) {
  const s = state();
  s.audit.push({
    id: `aud_${shortId()}`,
    at,
    actor,
    type,
    summary,
    correlationId: extra.jobId ? (s.correlation.get(extra.jobId) ?? `corr_${shortId()}`) : `corr_${shortId()}`,
    ...extra,
  });
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

function log(job: Job, actor: Actor, message: string, at?: string) {
  pushEvent(job, { type: "log", actor, message }, at);
}

interface TransitionOpts {
  reason?: string;
  message?: string;
  at?: string;
  /** G1 §6 Q1 proposal — only used for lease-expiry requeue. */
  proposedRetry?: boolean;
}

function transition(job: Job, to: JobState, actor: Actor, opts: TransitionOpts = {}) {
  const from = job.state;
  if (!canTransition(from, to, opts.proposedRetry)) {
    throw new Error(`[mock] undocumented transition ${from} → ${to} for ${job.id}`);
  }
  const at = opts.at ?? iso();
  job.state = to;
  job.updatedAt = at;
  pushEvent(job, { type: "state", state: to, prevState: from, actor, reason: opts.reason, message: opts.message }, at);
  addAudit(
    to === "REJECTED" ? "JOB_REJECTED" : "JOB_STATE_CHANGED",
    actor,
    `${from} → ${to}`,
    { jobId: job.id, nodeId: job.assignment?.nodeId, reason: opts.reason },
    at,
  );
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

function canSeeJob(user: MockUser, job: Job): boolean {
  if (user.role === "admin") return true;
  if (user.role === "requester") return job.requesterId === user.id;
  return ownsNode(user, job.assignment?.nodeId);
}

/** Role-scoped projection. Requesters never learn which node or whose device ran their job. */
export function jobView(job: Job, user: MockUser): Job {
  const view: Job = structuredClone(job);
  if (user.role === "requester" && view.assignment) {
    const node = state().nodes.get(view.assignment.nodeId);
    view.assignment = {
      ...view.assignment,
      nodeId: "redacted",
      nodeLabel: node ? `Community provider · ${node.os}/${node.arch}` : "Community provider",
    };
  }
  if (user.role === "provider") {
    delete view.inputs.files;
  }
  if (view.artifacts) view.artifacts = view.artifacts.map(signArtifact);
  return view;
}

/** Requesters never see which node, agent or person ran their job (G1 §1). */
function actorView(actor: Actor, user: MockUser): Actor {
  if (user.role !== "requester") return actor;
  if (actor.role === "agent") return { role: "agent", label: "Provider agent" };
  if (actor.role === "provider") return { role: "provider", label: "Provider" };
  return actor;
}

export function eventView(event: JobEvent, user: MockUser): JobEvent {
  return user.role === "requester" ? { ...event, actor: actorView(event.actor, user) } : event;
}

export function getJob(id: string, user: MockUser): Job {
  const job = state().jobs.get(id);
  if (!job || !canSeeJob(user, job)) throw new MockApiError(404, "NOT_FOUND", "We couldn't find that job.");
  return jobView(job, user);
}

export function listJobs(user: MockUser): Job[] {
  return [...state().jobs.values()]
    .filter((j) => canSeeJob(user, j))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((j) => jobView(j, user));
}

export function getEvents(jobId: string, user: MockUser, afterSeq = 0): JobEvent[] {
  getJob(jobId, user);
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

/* ── Artifacts (scoped, expiring URLs) ──────────────────────────────────── */

const ARTIFACT_SECRET = "mock-only-not-a-secret";
const ARTIFACT_TTL_MS = 10 * 60_000;

function signArtifact(a: Artifact): Artifact {
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
    const artifact = job.artifacts?.find((a) => a.id === id);
    if (artifact) {
      const out = manifest.outputs.find((o) => o.name === artifact.name);
      if (!out) break;
      return { artifact, file: out.file };
    }
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
    size: o.bytes,
    digest: o.digest,
    url: "",
    urlExpiresAt: "",
    validation: [
      { code: "TYPE_MATCH", label: "File signature matches image/webp", passed: true },
      { code: "SIZE_LIMIT", label: `Within ${formatBytes(IMAGE_TRANSFORM.outputSchema.maxFileBytes)} output limit`, passed: true },
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

export function submitJob(req: SubmitJobRequest, user: MockUser): Job {
  assertCoordinatorUp();
  if (user.role !== "requester") throw new MockApiError(403, "FORBIDDEN", "Only requesters can submit jobs.");

  const workload = getWorkload(req.workloadId);
  if (!workload) throw new MockApiError(400, "VALIDATION_FAILED", "Choose a workload from the catalogue.", { workloadId: "Unknown workload." });
  if (workload.availability.status !== "available") {
    throw new MockApiError(400, "VALIDATION_FAILED", workload.availability.reason, { workloadId: workload.availability.reason });
  }

  const fields: Record<string, string> = {};
  const files = req.sampleSet === SAMPLE_SET_ID ? sampleInputs() : req.inputs ?? [];
  const schema = workload.inputSchema;
  if (files.length === 0) fields.inputs = "Add at least one image.";
  if (files.length > schema.maxFiles) fields.inputs = `Up to ${schema.maxFiles} files per job.`;
  const badType = files.find((f) => !schema.accept.includes(f.contentType));
  if (badType) fields.inputs = `${badType.name} isn't an accepted type (PNG, JPEG or WebP).`;
  const tooBig = files.find((f) => f.bytes > schema.maxFileBytes);
  if (tooBig) fields.inputs = `${tooBig.name} is larger than ${formatBytes(schema.maxFileBytes)}.`;
  const total = files.reduce((n, f) => n + f.bytes, 0);
  if (total > schema.maxTotalBytes) fields.inputs = `Total size is over ${formatBytes(schema.maxTotalBytes)}.`;

  const params: Record<string, string | number> = {};
  for (const spec of workload.params) {
    const raw = req.params?.[spec.key] ?? spec.default;
    if (spec.type === "enum") {
      if (!spec.options.some((o) => o.value === raw)) fields[spec.key] = "Choose one of the listed options.";
      params[spec.key] = String(raw);
    } else {
      const n = Number(raw);
      if (!Number.isInteger(n) || n < spec.min || n > spec.max) fields[spec.key] = `Enter a whole number from ${spec.min} to ${spec.max}.`;
      params[spec.key] = n;
    }
  }

  if (req.networkMode !== "OPEN_WEB" && !workload.allowedNetworkModes.includes(req.networkMode)) {
    fields.networkMode = "This workload only runs offline.";
  }
  if (Object.keys(fields).length) throw new MockApiError(400, "VALIDATION_FAILED", "Some fields need attention.", fields);

  const s = state();
  const now = iso();
  const id = `job_${++s.jobCounter}`;
  s.correlation.set(id, `corr_${shortId()}`);
  const risk = classifyRisk(workload, req.networkMode);
  const job: Job = {
    id,
    requesterId: user.id,
    requesterLabel: user.label,
    workloadId: workload.id,
    workloadName: workload.name,
    workloadVersion: workload.version,
    workloadDigest: workload.imageDigest,
    params,
    inputs: { count: files.length, contentTypes: [...new Set(files.map((f) => f.contentType))], totalBytes: total, files },
    inputDigest: inputDigest(files),
    risk,
    networkMode: req.networkMode,
    limits: workload.limits,
    state: "DRAFT",
    attempt: 1,
    createdAt: now,
    updatedAt: now,
  };
  s.jobs.set(id, job);
  const requester: Actor = { role: "requester", label: user.label };
  transition(job, "SUBMITTED", requester, { message: "Submitted for policy check." });
  addAudit("JOB_SUBMITTED", requester, `Submitted ${workload.name} v${workload.version}`, { jobId: id });

  schedule(id, 900, () => {
    if (risk.tier === "BLOCKED" || risk.tier === "HIGH") {
      const reasons = risk.facts.filter((f) => f.effect === "blocks").map((f) => f.label);
      transition(job, "REJECTED", COORDINATOR, {
        reason: risk.tier === "BLOCKED" ? "RISK_BLOCKED" : "ROUTE_DEDICATED_ONLY",
        message: reasons.join(" ") || "Rejected by policy before scheduling.",
      });
      return;
    }
    transition(job, "QUEUED", COORDINATOR, { message: `Policy check passed: ${risk.tier} risk.` });
    schedule(id, 900, () => tryMatch(job));
  });

  return jobView(job, user);
}

/* ── Matching & offers ──────────────────────────────────────────────────── */

function nodeIsReachable(node: ProviderNode): boolean {
  return node.id === PROVIDER_NODE_ID ? state().flags.agentConnected : node.status !== "offline";
}

function compatibleNode(job: Job): ProviderNode | undefined {
  const s = state();
  const workload = getWorkload(job.workloadId)!;
  return [...s.nodes.values()].find((node) => {
    const policy = s.policies.get(node.id);
    if (!policy || node.status !== "available" || !nodeIsReachable(node)) return false;
    if (!policy.allowedWorkloads.includes(job.workloadId)) return false;
    if (RISK_ORDER.indexOf(job.risk.tier) > RISK_ORDER.indexOf(policy.riskMax)) return false;
    if (!policy.networkModes.includes(job.networkMode) || !node.capability.networkModes.includes(job.networkMode)) return false;
    // Must meet isolation with a *verified* level, never a declared one.
    if (!node.capability.isolation.verified.includes(workload.minIsolation)) return false;
    return job.limits.memoryBytes <= policy.resourceCaps.memoryBytes && job.limits.cpuCores <= policy.resourceCaps.cpuCores;
  });
}

function tryMatch(job: Job) {
  if (job.state !== "QUEUED") return;
  const s = state();
  const node = compatibleNode(job);
  if (!node) {
    const already = (s.events.get(job.id) ?? []).some((e) => e.type === "log" && e.message?.startsWith("No compatible provider") && e.attempt === job.attempt);
    if (!already) log(job, COORDINATOR, "No compatible provider is available right now. Waiting in the queue.");
    return;
  }
  const policy = s.policies.get(node.id)!;
  const workload = getWorkload(job.workloadId)!;
  const offer: Offer = {
    id: `off_${shortId()}`,
    jobId: job.id,
    nodeId: node.id,
    workload: {
      id: workload.id,
      name: workload.name,
      version: workload.version,
      digest: workload.imageDigest,
      signatureVerified: workload.signatureVerified,
      publisher: workload.publisher,
      summary: workload.summary,
    },
    inputs: { count: job.inputs.count, contentTypes: job.inputs.contentTypes, totalBytes: job.inputs.totalBytes },
    params: job.params,
    limits: job.limits,
    networkMode: job.networkMode,
    risk: job.risk,
    requesterLabel: job.requesterLabel,
    createdAt: iso(),
    expiresAt: iso(Date.now() + pace(60_000)),
    status: "pending",
  };
  s.offers.set(offer.id, offer);
  transition(job, "OFFERED", COORDINATOR, { message: "Offered to a compatible provider. Waiting for their approval." });
  addAudit("OFFER_CREATED", COORDINATOR, "Offer sent to a compatible provider", { jobId: job.id, nodeId: node.id });

  if (policy.consentMode === "auto") {
    schedule(job.id, 1000, () => {
      if (offer.status !== "pending") return;
      offer.status = "auto_approved";
      offer.decidedAt = iso();
      offer.policyRule = `Auto-approve: ${workload.name} v${workload.version}, up to ${policy.riskMax} risk, ${policy.networkModes.join("/")} only.`;
      addAudit("OFFER_AUTO_APPROVED", agentActor(node), offer.policyRule, { jobId: job.id, nodeId: node.id });
      startRun(job, node);
    });
  }

  schedule(job.id, 60_000, () => {
    if (offer.status !== "pending") return;
    offer.status = "expired";
    addAudit("OFFER_EXPIRED", COORDINATOR, "Offer expired without a decision", { jobId: job.id, nodeId: node.id });
    transition(job, "EXPIRED", COORDINATOR, { reason: "OFFER_EXPIRED", message: "No provider accepted in time." });
  });
}

export function getOffer(id: string, user: MockUser): Offer {
  const offer = state().offers.get(id);
  if (!offer || (user.role !== "admin" && !ownsNode(user, offer.nodeId))) throw new MockApiError(404, "NOT_FOUND", "We couldn't find that request.");
  return offer;
}

export function decideOffer(id: string, decision: "approve" | "decline", user: MockUser): Offer {
  if (user.role !== "provider") throw new MockApiError(403, "FORBIDDEN", "Only the provider who owns this node can decide.");
  const s = state();
  const offer = getOffer(id, user);
  if (offer.status === "expired" || Date.parse(offer.expiresAt) < Date.now()) {
    throw new MockApiError(409, "OFFER_EXPIRED", "This request expired before a decision was made.");
  }
  if (offer.status !== "pending") throw new MockApiError(409, "CONFLICT", "This request was already decided.");
  const job = s.jobs.get(offer.jobId)!;
  const node = s.nodes.get(offer.nodeId)!;
  const provider: Actor = { role: "provider", label: user.label };
  offer.decidedAt = iso();
  if (decision === "approve") {
    offer.status = "approved";
    addAudit("OFFER_APPROVED", provider, "Approved once", { jobId: job.id, nodeId: node.id });
    startRun(job, node);
  } else {
    offer.status = "declined";
    addAudit("OFFER_DECLINED", provider, "Declined", { jobId: job.id, nodeId: node.id });
    transition(job, "DECLINED", provider, { reason: "PROVIDER_DECLINED", message: "The provider declined this request." });
  }
  return offer;
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

function startRun(job: Job, node: ProviderNode) {
  const s = state();
  const agent = agentActor(node);
  const isolation = node.capability.isolation.verified.includes("gvisor") ? "gvisor" : node.capability.isolation.verified[0] ?? node.capability.runtime;
  job.assignment = { nodeId: node.id, nodeLabel: node.label, isolation, leaseUntil: iso(Date.now() + 30_000) };
  node.status = "busy";
  s.lastJobByNode.set(node.id, job.id);
  transition(job, "CLAIMED", agent, { message: "Assignment claimed. Manifest signature, nonce and expiry verified." });

  schedule(job.id, 1000, () => {
    transition(job, "STAGING", agent, { message: "Staging inputs read-only." });
    log(job, agent, `Staged ${formatInputs(job.inputs)} into /input (read-only). Input digest verified.`);
    schedule(job.id, 1400, () => {
      const startedAt = Date.now();
      job.progress = { done: 0, total: job.inputs.count };
      job.usage = usageAt(job, 0, job.inputs.count, startedAt);
      transition(job, "RUNNING", agent, { message: `Sandbox started · rootless · ${isolation} · network: none.` });
      runStep(job, node, 0, startedAt);
    });
  });
}

function runStep(job: Job, node: ProviderNode, done: number, startedAt: number) {
  const total = job.inputs.count;
  schedule(job.id, 2600, () => {
    if (job.state !== "RUNNING") return;
    const next = done + 1;
    job.progress = { done: next, total };
    job.usage = usageAt(job, next, total, startedAt);
    if (job.assignment) job.assignment.leaseUntil = iso(Date.now() + 30_000);
    pushEvent(job, { type: "progress", progress: job.progress, usage: job.usage, actor: agentActor(node), message: `Processed image ${next} of ${total}.` });
    if (next < total) {
      runStep(job, node, next, startedAt);
      return;
    }
    schedule(job.id, 800, () => finish(job, node));
  });
}

function finish(job: Job, node: ProviderNode) {
  const agent = agentActor(node);
  transition(job, "VALIDATING", agent, { message: "Checking output type, size and digest." });
  schedule(job.id, 1600, () => {
    job.artifacts = buildOutputs(job.id);
    log(job, agent, `${job.artifacts.length} output(s) passed type, size and schema checks. Uploaded with a short-lived scoped token.`);
    addAudit("ARTIFACT_VALIDATED", agent, `${job.artifacts.length} outputs validated`, { jobId: job.id, nodeId: node.id });
    transition(job, "SUCCEEDED", COORDINATOR, { message: "Result validated and ready." });
    log(job, agent, "Sandbox removed. Workspace cleanup verified.");
    addAudit("WORKSPACE_CLEANED", agent, "Workspace cleanup verified", { jobId: job.id, nodeId: node.id });
    node.status = "available";
    clearTimers(job.id);
    requeueWaiting();
  });
}

function requeueWaiting() {
  for (const job of state().jobs.values()) if (job.state === "QUEUED") tryMatch(job);
}

/* ── Stop / cancel ──────────────────────────────────────────────────────── */

const STOPPABLE: JobState[] = ["CLAIMED", "STAGING", "RUNNING"];

function stopJob(job: Job, actor: Actor, reasonCode: StopReasonCode, node?: ProviderNode) {
  clearTimers(job.id);
  if (node) {
    const agent = agentActor(node);
    log(job, agent, "Network revoked for this sandbox.");
    log(job, agent, "Sandbox sent SIGTERM; forced stop after 3 s deadline if still running.");
  }
  job.stoppedBy = { ...actor, reasonCode };
  transition(job, "CANCELLED", actor, {
    reason: reasonCode,
    message: reasonCode === "PROVIDER_STOP" ? "Stopped by the provider on their device." : reasonCode === "REQUESTER_CANCEL" ? "Cancelled by the requester." : "Stopped by an admin.",
  });
  addAudit("JOB_STOPPED", actor, `Stopped (${reasonCode})`, { jobId: job.id, nodeId: node?.id, reason: reasonCode });
  if (node) {
    log(job, agentActor(node), "Workspace cleanup verified.");
    addAudit("WORKSPACE_CLEANED", agentActor(node), "Workspace cleanup verified", { jobId: job.id, nodeId: node.id });
  }
}

export function cancelJob(id: string, user: MockUser): Job {
  assertCoordinatorUp();
  const s = state();
  const job = s.jobs.get(id);
  if (!job || !canSeeJob(user, job)) throw new MockApiError(404, "NOT_FOUND", "We couldn't find that job.");
  if (user.role === "provider") throw new MockApiError(403, "FORBIDDEN", "Providers stop jobs from their Provider Console.");
  if (!canTransition(job.state, "CANCELLED")) {
    throw new MockApiError(409, "CONFLICT", job.state === "OFFERED" ? "This job is waiting on a provider decision and can't be cancelled yet." : "This job can no longer be cancelled.");
  }
  const node = job.assignment ? s.nodes.get(job.assignment.nodeId) : undefined;
  stopJob(job, { role: user.role, label: user.label }, user.role === "admin" ? "ADMIN_STOP" : "REQUESTER_CANCEL", STOPPABLE.includes(job.state) ? node : undefined);
  if (node && node.status === "busy") node.status = "available";
  return jobView(job, user);
}

/* ── Local Agent (G1 §6 Q9 proposal): works even when the coordinator is down ── */

function providerNode(user: MockUser): ProviderNode {
  if (user.role !== "provider") throw new MockApiError(403, "FORBIDDEN", "The local Agent only answers to this device's provider.");
  return state().nodes.get(PROVIDER_NODE_ID)!;
}

export function agentState(user: MockUser): AgentLocalState {
  const s = state();
  const node = providerNode(user);
  if (s.flags.agentConnected) node.heartbeatAt = iso();
  if (!s.flags.coordinatorDown) s.coordinatorLastContactAt = iso();
  const jobs = [...s.jobs.values()].filter((j) => j.assignment?.nodeId === node.id);
  const active = jobs.find((j) => STOPPABLE.includes(j.state) || j.state === "VALIDATING") ?? null;
  const pending = [...s.offers.values()].find((o) => o.nodeId === node.id && o.status === "pending" && Date.parse(o.expiresAt) > Date.now()) ?? null;
  const lastId = s.lastJobByNode.get(node.id);
  const last = lastId ? s.jobs.get(lastId) ?? null : null;
  return {
    agent: { connected: s.flags.agentConnected, version: node.agentVersion, startedAt: s.agentStartedAt },
    coordinator: { reachable: !s.flags.coordinatorDown, lastContactAt: s.coordinatorLastContactAt },
    node: structuredClone(node),
    policy: structuredClone(s.policies.get(node.id)!),
    pendingOffer: pending ? structuredClone(pending) : null,
    activeJob: active ? jobView(active, user) : null,
    lastJob: last && isTerminal(last.state) ? jobView(last, user) : null,
    stopping: s.stopping.has(node.id),
  };
}

export function agentStop(user: MockUser): AgentLocalState {
  const s = state();
  const node = providerNode(user);
  const job = [...s.jobs.values()].find((j) => j.assignment?.nodeId === node.id && STOPPABLE.includes(j.state));
  if (!job) throw new MockApiError(409, "CONFLICT", "Nothing is running on this device.");
  s.stopping.add(node.id);
  clearTimers(job.id);
  log(job, { role: "provider", label: user.label }, "Stop requested on this device.");
  // Local termination happens regardless of coordinator reachability.
  setTimeout(() => {
    stopJob(job, { role: "provider", label: user.label }, "PROVIDER_STOP", node);
    s.stopping.delete(node.id);
    // Safety default: after an emergency stop, pause new requests until the provider resumes.
    node.status = "paused";
    // Fixed delay: the kill path is never slowed by demo pacing (target ≤ 5 s, master plan §4).
  }, 1200);
  return agentState(user);
}

export function agentSetAvailability(user: MockUser, available: boolean): AgentLocalState {
  const s = state();
  const node = providerNode(user);
  if (node.status === "busy" && !available) {
    // Pausing doesn't stop the current job; it only stops new offers.
    s.policies.get(node.id)!.updatedAt = iso();
  }
  if (node.status !== "busy") node.status = available ? "available" : "paused";
  if (available) requeueWaiting();
  return agentState(user);
}

/* ── Policy ─────────────────────────────────────────────────────────────── */

export function getPolicy(nodeId: string, user: MockUser): ProviderPolicy {
  assertCoordinatorUp();
  if (user.role === "requester" || (user.role === "provider" && !ownsNode(user, nodeId))) {
    throw new MockApiError(403, "FORBIDDEN", "You can only view policy for your own node.");
  }
  const policy = state().policies.get(nodeId);
  if (!policy) throw new MockApiError(404, "NOT_FOUND", "Unknown node.");
  return policy;
}

export function putPolicy(nodeId: string, body: Partial<ProviderPolicy>, user: MockUser): ProviderPolicy {
  assertCoordinatorUp();
  if (user.role !== "provider" || !ownsNode(user, nodeId)) throw new MockApiError(403, "FORBIDDEN", "Only this node's provider can change its policy.");
  const current = getPolicy(nodeId, user);
  const fields: Record<string, string> = {};
  if (body.riskMax && !["LOW", "MEDIUM"].includes(body.riskMax)) fields.riskMax = "Personal nodes accept LOW or MEDIUM only.";
  if (body.networkModes?.includes("OPEN_WEB")) fields.networkModes = "Open internet isn't available on personal nodes.";
  if (body.schedule?.mode === "window" && (!/^\d\d:\d\d$/.test(body.schedule.start) || !/^\d\d:\d\d$/.test(body.schedule.end))) {
    fields.schedule = "Use 24-hour times like 18:00.";
  }
  if (Object.keys(fields).length) throw new MockApiError(400, "VALIDATION_FAILED", "Some fields need attention.", fields);
  const next: ProviderPolicy = { ...current, ...body, nodeId, updatedAt: iso() };
  state().policies.set(nodeId, next);
  addAudit("POLICY_UPDATED", { role: "provider", label: user.label }, "Provider policy updated", { nodeId });
  requeueWaiting();
  return next;
}

/* ── Nodes, health, audit ───────────────────────────────────────────────── */

export function listNodes(user: MockUser): ProviderNode[] {
  assertCoordinatorUp();
  const nodes = [...state().nodes.values()].map((n) => ({ ...n, status: nodeIsReachable(n) ? n.status : ("offline" as const) }));
  if (user.role === "admin") return nodes;
  if (user.role === "provider") return nodes.filter((n) => n.ownerId === user.id);
  return [];
}

export function networkHealth(): NetworkHealth {
  assertCoordinatorUp();
  const s = state();
  const nodes = [...s.nodes.values()].map((n) => (nodeIsReachable(n) ? n.status : "offline"));
  const count = (st: string) => nodes.filter((n) => n === st).length;
  const jobs = [...s.jobs.values()];
  const counts = { total: nodes.length, available: count("available"), busy: count("busy"), offline: count("offline"), paused: count("paused") };
  const recentLeaseExpiry = s.audit.some((a) => a.type === "LEASE_EXPIRED" && Date.now() - Date.parse(a.at) < 5 * 60_000);
  let status: NetworkHealth["status"] = "healthy";
  let reason = `${counts.available} provider${counts.available === 1 ? "" : "s"} ready, ${counts.busy} busy.`;
  if (s.flags.incident) {
    status = "incident";
    reason = s.flags.incident.title;
  } else if (counts.available + counts.busy === 0) {
    status = "no_providers";
    reason = "No providers are accepting work right now. New jobs will wait in the queue.";
  } else if (recentLeaseExpiry) {
    status = "degraded";
    reason = "A provider stopped sending heartbeats in the last 5 minutes. Affected jobs were requeued or failed.";
  }
  return {
    status,
    reason,
    coordinator: { reachable: true },
    nodes: counts,
    activeJobs: jobs.filter((j) => ["CLAIMED", "STAGING", "RUNNING", "VALIDATING"].includes(j.state)).length,
    queuedJobs: jobs.filter((j) => ["SUBMITTED", "QUEUED", "OFFERED"].includes(j.state)).length,
    incident: s.flags.incident ?? undefined,
    checkedAt: iso(),
  };
}

export function listAudit(user: MockUser, filters: { jobId?: string; nodeId?: string; type?: string }): AuditEvent[] {
  assertCoordinatorUp();
  const s = state();
  return s.audit
    .filter((a) => {
      if (user.role === "requester") {
        const job = a.jobId ? s.jobs.get(a.jobId) : undefined;
        if (!job || job.requesterId !== user.id) return false;
      } else if (user.role === "provider") {
        const job = a.jobId ? s.jobs.get(a.jobId) : undefined;
        if (!ownsNode(user, a.nodeId) && !ownsNode(user, job?.assignment?.nodeId)) return false;
      }
      if (filters.jobId && a.jobId !== filters.jobId) return false;
      if (filters.nodeId && a.nodeId !== filters.nodeId) return false;
      if (filters.type && a.type !== filters.type) return false;
      return true;
    })
    .sort((a, b) => b.at.localeCompare(a.at))
    .map((a) => (user.role === "requester" ? { ...a, nodeId: undefined, actor: actorView(a.actor, user) } : a));
}

/* ── Dev controls (demo rehearsal: network failure, provider disappears) ── */

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
        if (job.assignment?.nodeId !== node.id || !STOPPABLE.includes(job.state)) continue;
        clearTimers(job.id);
        schedule(job.id, 8000, () => expireLease(job, node));
      }
      break;
    }
    case "agent-reconnect": {
      s.flags.agentConnected = true;
      const node = s.nodes.get(PROVIDER_NODE_ID)!;
      const hasJob = [...s.jobs.values()].some((j) => j.assignment?.nodeId === node.id && STOPPABLE.includes(j.state));
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
      s.flags.incident = { id: `inc_${shortId()}`, title: "Admin is investigating unusual output validation failures.", openedAt: iso() };
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

function expireLease(job: Job, node: ProviderNode) {
  if (!STOPPABLE.includes(job.state)) return;
  const workload = getWorkload(job.workloadId)!;
  log(job, COORDINATOR, "Agent missed heartbeats — lease expired.");
  addAudit("LEASE_EXPIRED", COORDINATOR, "Lease expired — the provider stopped sending heartbeats", { jobId: job.id, nodeId: node.id, reason: "HEARTBEAT_MISSED" });
  node.status = "offline";
  if (workload.idempotent && job.attempt === 1) {
    job.attempt = 2;
    job.assignment = undefined;
    job.progress = undefined;
    job.usage = undefined;
    // ⚠️ G1 §6 Q1 proposal — not in the canonical table yet.
    transition(job, "QUEUED", COORDINATOR, { proposedRetry: true, reason: "LEASE_EXPIRED", message: "Requeued once — this workload is safe to retry." });
    schedule(job.id, 600, () => tryMatch(job));
  } else {
    transition(job, "FAILED", COORDINATOR, { reason: "PROVIDER_OFFLINE", message: "The provider went offline and this job can't be retried." });
    job.failure = { code: "PROVIDER_OFFLINE", reason: "The provider went offline and this job can't be retried." };
  }
}

/* ── Seed history ───────────────────────────────────────────────────────── */

function seedHistory(s: MockState, now: number) {
  const req: Actor = { role: "requester", label: USERS.requester.label };
  const prov: Actor = { role: "provider", label: USERS.provider.label };
  const node = s.nodes.get(PROVIDER_NODE_ID)!;
  const agent = agentActor(node);
  const files = sampleInputs();

  const make = (id: string, minutesAgo: number, networkMode: Job["networkMode"] = "OFFLINE"): Job => {
    const at = iso(now - minutesAgo * 60_000);
    s.correlation.set(id, `corr_${shortId()}`);
    const job: Job = {
      id,
      requesterId: USERS.requester.id,
      requesterLabel: USERS.requester.label,
      workloadId: IMAGE_TRANSFORM.id,
      workloadName: IMAGE_TRANSFORM.name,
      workloadVersion: IMAGE_TRANSFORM.version,
      workloadDigest: IMAGE_TRANSFORM.imageDigest,
      params: { format: "webp", maxWidth: 1600, quality: 82 },
      inputs: { count: files.length, contentTypes: ["image/png"], totalBytes: files.reduce((n, f) => n + f.bytes, 0), files },
      inputDigest: inputDigest(files),
      risk: classifyRisk(IMAGE_TRANSFORM, networkMode, new Date(at)),
      networkMode,
      limits: IMAGE_TRANSFORM.limits,
      state: "DRAFT",
      attempt: 1,
      createdAt: at,
      updatedAt: at,
    };
    s.jobs.set(id, job);
    return job;
  };
  const step = (job: Job, to: JobState, actor: Actor, secondsAfter: number, opts: TransitionOpts = {}) =>
    transition(job, to, actor, { ...opts, at: iso(Date.parse(job.createdAt) + secondsAfter * 1000) });

  // 1. Succeeded — the reference happy path.
  const ok = make("job_1031", 140);
  step(ok, "SUBMITTED", req, 0);
  step(ok, "QUEUED", COORDINATOR, 1, { message: "Policy check passed: LOW risk." });
  step(ok, "OFFERED", COORDINATOR, 2);
  ok.assignment = { nodeId: node.id, nodeLabel: node.label, isolation: "gvisor", leaseUntil: iso(Date.parse(ok.createdAt) + 60_000) };
  step(ok, "CLAIMED", agent, 14);
  step(ok, "STAGING", agent, 15);
  step(ok, "RUNNING", agent, 17);
  ok.progress = { done: 3, total: 3 };
  ok.usage = { cpuCores: 0.82, memoryBytes: 268 * 1024 * 1024, diskBytes: 11 * 1024 * 1024, elapsedSeconds: 9 };
  step(ok, "VALIDATING", agent, 26);
  ok.artifacts = buildOutputs(ok.id);
  step(ok, "SUCCEEDED", COORDINATOR, 28, { message: "Result validated and ready." });

  // 2. Rejected — open internet requested.
  const rej = make("job_1034", 95, "OPEN_WEB");
  step(rej, "SUBMITTED", req, 0);
  step(rej, "REJECTED", COORDINATOR, 1, { reason: "RISK_BLOCKED", message: "Open internet isn't allowed on personal devices." });

  // 3. Stopped by the provider.
  const stop = make("job_1036", 70);
  step(stop, "SUBMITTED", req, 0);
  step(stop, "QUEUED", COORDINATOR, 1);
  step(stop, "OFFERED", COORDINATOR, 2);
  stop.assignment = { nodeId: node.id, nodeLabel: node.label, isolation: "gvisor", leaseUntil: iso(Date.parse(stop.createdAt) + 60_000) };
  step(stop, "CLAIMED", agent, 9);
  step(stop, "STAGING", agent, 10);
  step(stop, "RUNNING", agent, 12);
  stop.progress = { done: 1, total: 3 };
  stop.stoppedBy = { ...prov, reasonCode: "PROVIDER_STOP" };
  step(stop, "CANCELLED", prov, 16, { reason: "PROVIDER_STOP", message: "Stopped by the provider on their device." });

  // 4. Failed output validation.
  const bad = make("job_1038", 40);
  step(bad, "SUBMITTED", req, 0);
  step(bad, "QUEUED", COORDINATOR, 1);
  step(bad, "OFFERED", COORDINATOR, 2);
  bad.assignment = { nodeId: node.id, nodeLabel: node.label, isolation: "gvisor", leaseUntil: iso(Date.parse(bad.createdAt) + 60_000) };
  step(bad, "CLAIMED", agent, 8);
  step(bad, "STAGING", agent, 9);
  step(bad, "RUNNING", agent, 11);
  step(bad, "VALIDATING", agent, 20);
  bad.failure = { code: "OUTPUT_VALIDATION_FAILED", reason: "An output file wasn't a valid image (type check failed). It was discarded and never stored." };
  step(bad, "FAILED", agent, 21, { reason: "OUTPUT_VALIDATION_FAILED", message: bad.failure.reason });

  s.lastJobByNode.set(node.id, bad.id);
}
