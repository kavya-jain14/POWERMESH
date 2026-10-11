/**
 * Server-only bridge to the coordinator API (apps/api, Kavya). Imported only by route handlers under
 * /api/live — never by client components.
 *
 * Why a bridge instead of calling the API from the browser:
 *  - Requester enrollment needs POWERMESH_ENROLLMENT_KEY. That key must never reach browser JavaScript.
 *  - The requester bearer token is kept in an httpOnly, SameSite=Strict cookie scoped to /api/live,
 *    so page scripts (and anything injected into them) can't read it.
 *  - API v0 has no "list my jobs" or event-stream endpoint yet; the bridge fills those gaps from
 *    GET /v1/jobs/:id without inventing states (see listJobs / the events route).
 *
 * Shapes come from `@powermesh/contracts`. JobRecord isn't exported there yet, so CoordinatorJob
 * mirrors apps/api/src/store/types.ts — question for Kavya: export it from contracts (S1).
 */
import { createHash, randomUUID } from "node:crypto";
import {
  type JobState as CoordinatorJobState,
  type JobSubmission,
  jobCreationSchema,
  type RiskDecision,
  type RiskTier,
  type WorkloadRequest,
} from "@powermesh/contracts";
import { cookies } from "next/headers";
import type {
  ApiErrorBody,
  ErrorCode,
  InputFileMeta,
  InputSummary,
  Job,
  RiskBlockedDetails,
  RiskExplanation,
  SubmitJobRequest,
} from "@/contracts-draft/types";
import { getWorkload, WORKLOADS } from "@/contracts-draft/workloads";
import sampleManifest from "@/mock/sample-manifest.json";

export const COORDINATOR_URL = (
  process.env.POWERMESH_API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://127.0.0.1:4000"
).replace(/\/$/, "");
const ENROLLMENT_KEY = process.env.POWERMESH_ENROLLMENT_KEY;
const COMMUNITY_ID = process.env.POWERMESH_COMMUNITY_ID ?? "local-dev";

const TOKEN_COOKIE = "pm_requester";
const JOBS_COOKIE = "pm_live_jobs";
const COOKIE_PATH = "/api/live";
const MAX_REMEMBERED_JOBS = 25;
const MB = 1024 * 1024;

/** Mirrors JobRecord in apps/api/src/store/types.ts. */
export interface CoordinatorJob {
  id: string;
  requesterId: string;
  workload: JobSubmission["workload"];
  resources: WorkloadRequest;
  params: JobSubmission["params"];
  inputDigests: string[];
  riskTier: RiskTier;
  state: CoordinatorJobState;
  createdAt: string;
  updatedAt: string;
}

export const COORDINATOR_TERMINAL: readonly CoordinatorJobState[] = [
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
  "EXPIRED",
];

/* ── Errors → the UI's error envelope ───────────────────────────────────── */

export class BridgeError extends Error {
  constructor(
    public status: number,
    public code: ErrorCode,
    message: string,
    public fields?: Record<string, string>,
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export function errorResponse(err: unknown): Response {
  const correlationId = `web_${randomUUID().slice(0, 8)}`;
  if (err instanceof BridgeError) {
    const body: ApiErrorBody = {
      error: {
        code: err.code,
        message: err.message,
        fields: err.fields,
        details: err.details,
        correlationId,
      },
    };
    return Response.json(body, { status: err.status, headers: { "Cache-Control": "no-store" } });
  }
  console.error("[live bridge] unhandled", err);
  const body: ApiErrorBody = {
    error: { code: "INTERNAL", message: "Something went wrong in the web server.", correlationId },
  };
  return Response.json(body, { status: 500 });
}

const UPSTREAM_CODE: Record<number, ErrorCode> = {
  400: "VALIDATION_FAILED",
  401: "UNAUTHENTICATED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  410: "OFFER_EXPIRED",
  413: "PAYLOAD_TOO_LARGE",
  422: "RISK_BLOCKED",
  429: "RATE_LIMITED",
};

const UPSTREAM_MESSAGE: Partial<Record<ErrorCode, string>> = {
  VALIDATION_FAILED: "The coordinator rejected the request as invalid.",
  NOT_FOUND: "This job doesn't exist, or it isn't yours.",
  RATE_LIMITED: "The coordinator is rate-limiting requests. Wait a moment and try again.",
};

/* ── Low-level fetch ────────────────────────────────────────────────────── */

interface Upstream<T> {
  status: number;
  body: T;
}

async function upstream<T>(path: string, init: RequestInit = {}): Promise<Upstream<T>> {
  let res: Response;
  try {
    res = await fetch(`${COORDINATOR_URL}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new BridgeError(
      503,
      "UNAVAILABLE",
      `Can't reach the coordinator at ${COORDINATOR_URL}. Start it with \`pnpm dev:api\`.`,
    );
  }
  const body = (await res.json().catch(() => ({}))) as T;
  return { status: res.status, body };
}

function raise(status: number, body: unknown): never {
  const upstreamCode = (body as { error?: string } | null)?.error;
  const code = UPSTREAM_CODE[status] ?? (status >= 500 ? "UNAVAILABLE" : "INTERNAL");
  const message =
    UPSTREAM_MESSAGE[code] ??
    `The coordinator answered ${status}${upstreamCode ? ` (${upstreamCode})` : ""}.`;
  throw new BridgeError(status >= 500 ? 502 : status, code, message);
}

/* ── Requester credential ───────────────────────────────────────────────── */

async function enroll(): Promise<string> {
  if (!ENROLLMENT_KEY) {
    throw new BridgeError(
      503,
      "UNAVAILABLE",
      "The web server can't enroll you: POWERMESH_ENROLLMENT_KEY isn't set. Copy .env.example to .env at the repo root and restart.",
    );
  }
  const { status, body } = await upstream<{ requesterToken?: string; error?: string }>(
    "/v1/requesters/register",
    {
      method: "POST",
      headers: { "x-powermesh-enrollment-key": ENROLLMENT_KEY },
      body: JSON.stringify({ communityId: COMMUNITY_ID }),
    },
  );
  if (status === 401) {
    throw new BridgeError(
      503,
      "UNAVAILABLE",
      "The coordinator refused enrollment: POWERMESH_ENROLLMENT_KEY doesn't match the API's key.",
    );
  }
  if (status !== 201 || !body.requesterToken) raise(status, body);
  const token = body.requesterToken;
  (await cookies()).set(TOKEN_COOKIE, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: COOKIE_PATH,
    maxAge: 60 * 60 * 24 * 30,
  });
  return token;
}

/**
 * Calls the coordinator as this browser's requester. Enrolls on first use, and re-enrolls once if the
 * coordinator no longer knows the token (the in-memory store forgets everyone on restart).
 */
async function asRequester<T>(
  path: string,
  init: RequestInit = {},
): Promise<Upstream<T> & { requester: string }> {
  const jar = await cookies();
  let token = jar.get(TOKEN_COOKIE)?.value ?? (await enroll());
  let res = await upstream<T>(path, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) {
    jar.delete({ name: JOBS_COOKIE, path: COOKIE_PATH });
    token = await enroll();
    res = await upstream<T>(path, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${token}` },
    });
  }
  return { ...res, requester: requesterKey(token) };
}

/** Cache partition for one requester credential. A digest, so raw tokens never sit in memory maps. */
function requesterKey(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function currentRequesterKey(): Promise<string | undefined> {
  const token = (await cookies()).get(TOKEN_COOKIE)?.value;
  return token ? requesterKey(token) : undefined;
}

/* ── Remembered jobs (no GET /v1/jobs in API v0) ────────────────────────── */

async function rememberedJobIds(): Promise<string[]> {
  const raw = (await cookies()).get(JOBS_COOKIE)?.value;
  if (!raw) return [];
  try {
    const ids = JSON.parse(raw) as unknown;
    return Array.isArray(ids)
      ? ids.filter((id): id is string => typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id))
      : [];
  } catch {
    return [];
  }
}

async function rememberJob(id: string): Promise<void> {
  const ids = [id, ...(await rememberedJobIds()).filter((x) => x !== id)].slice(
    0,
    MAX_REMEMBERED_JOBS,
  );
  (await cookies()).set(JOBS_COOKIE, JSON.stringify(ids), {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: COOKIE_PATH,
    maxAge: 60 * 60 * 24 * 30,
  });
}

/* ── Process-local caches (survive HMR, not restarts) ───────────────────── */

interface BridgeMemory {
  /** Input metadata the coordinator doesn't store (it keeps digests only). */
  inputs: Map<string, InputSummary>;
  /** Deterministic: same resources → same decision, so cache by resources. */
  risk: Map<string, RiskDecision>;
  /**
   * Short-lived job snapshots so several open tabs don't trip the API's 100 req/min limit.
   * Keyed by `${requesterKey}:${jobId}` — a snapshot is only ever served back to the credential
   * the coordinator authorised it for.
   */
  jobs: Map<string, { at: number; job: CoordinatorJob }>;
  workloadIds: Map<string, string>;
}

const bridgeGlobal = globalThis as { __pmLiveBridge?: BridgeMemory };
bridgeGlobal.__pmLiveBridge ??= {
  inputs: new Map(),
  risk: new Map(),
  jobs: new Map(),
  workloadIds: new Map(),
};
const memory: BridgeMemory = bridgeGlobal.__pmLiveBridge;
memory.workloadIds ??= new Map();

const JOB_CACHE_MS = 2500;

/* ── Coordinator → UI view model ────────────────────────────────────────── */

async function classify(resources: WorkloadRequest): Promise<RiskDecision> {
  const key = JSON.stringify(resources);
  const cached = memory.risk.get(key);
  if (cached) return cached;
  const { status, body } = await upstream<RiskDecision>("/v1/risk/classify", {
    method: "POST",
    body: JSON.stringify(resources),
  });
  if (status !== 200) raise(status, body);
  memory.risk.set(key, body);
  return body;
}

function explain(decision: RiskDecision, decidedAt: string): RiskExplanation {
  const effect =
    decision.tier === "BLOCKED" ? "blocks" : decision.tier === "LOW" ? "lowers" : "raises";
  return {
    tier: decision.tier,
    facts: decision.reasons.map((label, i) => ({
      code: `COORDINATOR_REASON_${i + 1}` as const,
      label,
      effect,
    })),
    policyVersion: "coordinator v0",
    decidedAt,
  };
}

async function toView(job: CoordinatorJob): Promise<Job> {
  const workload = getWorkload(job.workload.name);
  const decision = await classify(job.resources);
  const inputs = memory.inputs.get(job.id) ?? {
    count: job.inputDigests.length,
    contentTypes: [],
    totalBytes: null,
  };
  return {
    id: job.id,
    requesterLabel: "You",
    workload: {
      id: workload?.id ?? job.workload.name,
      name: workload?.name ?? job.workload.name,
      version: job.workload.version,
      digest: job.workload.imageDigest,
    },
    params: job.params,
    inputs,
    inputDigest: job.inputDigests[0],
    risk: explain({ ...decision, tier: job.riskTier }, job.createdAt),
    networkMode: job.resources.networkMode,
    limits: {
      cpuCores: job.resources.cpu,
      memoryBytes: job.resources.memoryMb * MB,
      diskBytes: null,
      timeoutSeconds: job.resources.timeoutSeconds,
      pidLimit: null,
      maxOutputBytes: job.resources.maxOutputBytes,
    },
    // States are passed through verbatim — the UI renders coordinator states, it doesn't infer them.
    state: job.state,
    attempt: 1,
    maxAttempts: 2,
    assignment: null,
    progress: null,
    usage: null,
    artifacts: [],
    failure: null,
    stoppedBy: null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

/* ── Operations used by the /api/live routes ────────────────────────────── */

export async function fetchJob(id: string, { fresh = false } = {}): Promise<CoordinatorJob> {
  if (!/^[0-9a-f-]{36}$/i.test(id))
    throw new BridgeError(404, "NOT_FOUND", UPSTREAM_MESSAGE.NOT_FOUND ?? "Not found.");
  const who = await currentRequesterKey();
  const cached = who ? memory.jobs.get(`${who}:${id}`) : undefined;
  const terminal = cached && COORDINATOR_TERMINAL.includes(cached.job.state);
  if (cached && !fresh && (terminal || Date.now() - cached.at < JOB_CACHE_MS)) return cached.job;
  const { status, body, requester } = await asRequester<CoordinatorJob>(`/v1/jobs/${id}`);
  if (status !== 200) raise(status, body);
  memory.jobs.set(`${requester}:${id}`, { at: Date.now(), job: body });
  return body;
}

export async function getJobView(id: string): Promise<Job> {
  return toView(await fetchJob(id));
}

export async function listJobViews(): Promise<Job[]> {
  const ids = await rememberedJobIds();
  const jobs = await Promise.all(
    ids.map((id) =>
      fetchJob(id).catch((err) => {
        // A job the coordinator forgot (in-memory store restarted) just drops off the list.
        if (err instanceof BridgeError && (err.code === "NOT_FOUND" || err.code === "FORBIDDEN"))
          return null;
        throw err;
      }),
    ),
  );
  const views = await Promise.all(jobs.filter((j): j is CoordinatorJob => j !== null).map(toView));
  return views.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function inputsFor(req: SubmitJobRequest): { summary: InputSummary; digests: string[] } {
  const files: Array<InputFileMeta & { digest?: string }> = req.sampleSet
    ? sampleManifest.inputs
    : req.inputs;
  return {
    summary: {
      count: files.length,
      contentTypes: [...new Set(files.map((f) => f.contentType))],
      totalBytes: files.reduce((sum, f) => sum + f.bytes, 0),
      files: files.map(({ name, contentType, bytes }) => ({ name, contentType, bytes })),
    },
    // Uploads have no storage pipeline in API v0, so only the bundled sample set carries digests.
    digests: files.flatMap((f) => (f.digest ? [f.digest] : [])),
  };
}

/** The coordinator's catalogue ids (UUIDs) by workload name. Fetched once per process. */
async function coordinatorWorkloadId(name: string): Promise<string> {
  const known = memory.workloadIds.get(name);
  if (known) return known;
  const { status, body } = await upstream<{ workloads?: { id: string; name: string }[] }>(
    "/v1/workloads",
  );
  if (status !== 200) raise(status, body);
  for (const w of body.workloads ?? []) memory.workloadIds.set(w.name, w.id);
  const id = memory.workloadIds.get(name);
  if (!id) {
    throw new BridgeError(
      503,
      "UNAVAILABLE",
      `The coordinator has no "${name}" workload configured. Set POWERMESH_IMAGE_TRANSFORM_IMAGE for the API and restart it.`,
    );
  }
  return id;
}

export async function submitJob(req: SubmitJobRequest): Promise<Job> {
  const workload = getWorkload(req.workloadId);
  if (!workload)
    throw new BridgeError(400, "VALIDATION_FAILED", "Pick a workload from the catalogue.", {
      workloadId: "Unknown workload.",
    });

  const { summary } = inputsFor(req);

  // The catalogue fixes the network mode (offline). A different choice is classified by the coordinator's own policy
  // engine first, so the block and its reasons still come from the real rules.
  if (req.networkMode !== "OFFLINE") {
    const decision = await classify({
      cpu: workload.limits.cpuCores,
      memoryMb: Math.round(workload.limits.memoryBytes / MB),
      timeoutSeconds: workload.limits.timeoutSeconds,
      maxOutputBytes: 50 * MB,
      networkMode: req.networkMode,
      allowedHosts: [],
      needsHostMount: false,
      privileged: false,
      dockerSocket: false,
      deviceAccess: workload.needsDeviceAccess,
      arbitraryImage: workload.runsRequesterCode || !workload.signatureVerified,
    });
    if (!decision.executableInMvp) {
      const details: RiskBlockedDetails = { risk: explain(decision, new Date().toISOString()) };
      throw new BridgeError(
        422,
        "RISK_BLOCKED",
        "This request is blocked by the current safety policy.",
        undefined,
        { ...details },
      );
    }
    throw new BridgeError(
      400,
      "VALIDATION_FAILED",
      "Coordinator v0 runs this workload offline only.",
      { networkMode: "Choose Offline." },
    );
  }

  const candidate = {
    workloadId: await coordinatorWorkloadId(workload.id),
    params: req.params,
    // Artifact upload isn't wired in API v0 (input.available = false), so no digests are sent yet.
    inputDigests: [],
  };

  // Validate against the shared contract before sending, so the error points at our field, not theirs.
  const parsed = jobCreationSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new BridgeError(
      400,
      "VALIDATION_FAILED",
      "This job doesn't fit the coordinator's job contract.",
      {
        [parsed.error.issues[0]?.path.join(".") || "job"]:
          parsed.error.issues[0]?.message ?? "Invalid",
      },
    );
  }

  const { status, body, requester } = await asRequester<{
    job?: CoordinatorJob;
    risk?: RiskDecision;
    error?: string;
  }>("/v1/jobs", {
    method: "POST",
    body: JSON.stringify(parsed.data),
  });
  if (status === 422 && body.risk) {
    // Q6: no job exists. API v0 doesn't return an auditEventId yet.
    const details: RiskBlockedDetails = { risk: explain(body.risk, new Date().toISOString()) };
    throw new BridgeError(
      422,
      "RISK_BLOCKED",
      "This request is blocked by the current safety policy.",
      undefined,
      { ...details },
    );
  }
  if (status === 400 && body.error === "INVALID_WORKLOAD_PARAMS") {
    throw new BridgeError(400, "VALIDATION_FAILED", "The coordinator rejected these settings.", {
      params: "Check the values against their limits.",
    });
  }
  if (status !== 201 || !body.job) raise(status, body);

  const job = body.job;
  if (body.risk) memory.risk.set(JSON.stringify(job.resources), body.risk);
  memory.inputs.set(job.id, summary);
  memory.jobs.set(`${requester}:${job.id}`, { at: Date.now(), job });
  await rememberJob(job.id);
  return toView(job);
}

export async function coordinatorHealth(): Promise<{ reachable: boolean; storage?: string }> {
  try {
    const { status, body } = await upstream<{ status?: string; storage?: string }>("/health");
    return { reachable: status === 200 && body.status === "ok", storage: body.storage };
  } catch {
    return { reachable: false };
  }
}

export const CATALOGUE = WORKLOADS;

/* ── Risk explanation (Gemini on the coordinator; advisory only) ────────── */

export interface RiskExplanationText {
  summary: string;
  reasons: string[];
  providerAdvice: string;
  source: "gemini" | "template";
  label: string;
}

const TIER_SUMMARY: Record<RiskTier, string> = {
  LOW: "PowerMesh policy rates this job low risk: it fits the default sandbox limits.",
  MEDIUM:
    "PowerMesh policy rates this job medium risk: it can run, but only after the provider reviews it.",
  HIGH: "PowerMesh policy rates this job high risk, so it never runs on personal devices.",
  BLOCKED: "PowerMesh policy blocks this job, so it is never scheduled on any provider.",
};

/** Used when the coordinator can't be reached: same rules, no AI. */
function localTemplate(risk: RiskExplanation): RiskExplanationText {
  return {
    summary: TIER_SUMMARY[risk.tier],
    reasons: risk.facts.slice(0, 4).map((f) => f.label),
    providerAdvice:
      risk.tier === "LOW" || risk.tier === "MEDIUM"
        ? "Approve it only if your schedule and limits allow it."
        : "No action is needed; it never reaches a personal device.",
    source: "template",
    label: "Standard explanation from PowerMesh policy rules.",
  };
}

/**
 * Sends only closed-vocabulary facts: fact codes, plus the coordinator's own reason strings (which it re-checks against
 * its allowlist). Never filenames, params or identities. The tier shown stays the policy's; this returns text only.
 */
export async function explainRisk(input: RiskExplanation): Promise<RiskExplanationText> {
  // What blocks or raises the tier matters most, so it goes first.
  const weight = { blocks: 0, raises: 1, lowers: 2 } as const;
  const risk = {
    ...input,
    facts: [...input.facts].sort((a, b) => (weight[a.effect] ?? 3) - (weight[b.effect] ?? 3)),
  };
  const factCodes = risk.facts
    .map((f) => f.code)
    .filter((c) => !c.startsWith("COORDINATOR_REASON_"));
  const reasons = risk.facts
    .filter((f) => f.code.startsWith("COORDINATOR_REASON_"))
    .map((f) => f.label);
  try {
    const { status, body } = await asRequester<{ explanation?: RiskExplanationText }>(
      "/v1/risk/explain",
      {
        method: "POST",
        body: JSON.stringify({ tier: risk.tier, factCodes, reasons }),
      },
    );
    if (status === 200 && body.explanation) return body.explanation;
  } catch {
    /* coordinator unreachable: fall through */
  }
  return localTemplate(risk);
}
