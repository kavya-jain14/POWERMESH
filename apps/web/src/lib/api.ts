/**
 * Browser API client. Paths follow docs/handoff/answers-from-kavya.md (main, 2026-10-10 22:24).
 *
 * Modes (NEXT_PUBLIC_POWERMESH_MODE in the root .env):
 *  - "offline-demo" (default; "mock" is accepted as an old alias): everything talks to the in-app
 *    simulator under /api/mock. Rehearsal only (Q30): off in production builds unless
 *    NEXT_PUBLIC_POWERMESH_OFFLINE_DEMO=1.
 *  - "live": job endpoints go to /api/live/v1, a server-side bridge to the real coordinator
 *    (apps/api). Surfaces with no coordinator API yet stay on the simulator in development.
 *
 * The Provider Console talks to the provider's own Agent (Q21 / ADR-002). In production that's the
 * Agent's origin, http://127.0.0.1:4765; the offline demo simulates it under /api/mock/agent.
 */
import type {
  AgentLocalState,
  ApiErrorBody,
  AuditEvent,
  ErrorCode,
  Job,
  NetworkHealth,
  Offer,
  OfferDecisionRequest,
  Page,
  ProviderNode,
  ProviderPolicy,
  SubmitJobRequest,
  WorkloadDefinition,
} from "@/contracts-draft/types";

export const MODE: "offline-demo" | "live" = process.env.NEXT_PUBLIC_POWERMESH_MODE === "live" ? "live" : "offline-demo";
export const IS_LIVE = MODE === "live";
export const API_BASE = process.env.NEXT_PUBLIC_POWERMESH_API ?? "/api/mock/v1";
/** Jobs (submit, list, detail, events, cancel) and the workload catalogue. */
export const JOBS_BASE = IS_LIVE ? "/api/live/v1" : API_BASE;
/** The provider's Agent local API (ADR-002). */
export const AGENT_BASE = process.env.NEXT_PUBLIC_POWERMESH_AGENT ?? "/api/mock/agent/v1/local";
/** Q30: the simulator only answers in development, or when explicitly enabled for a rehearsal build. */
export const OFFLINE_DEMO_ENABLED = process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_POWERMESH_OFFLINE_DEMO === "1";
/** True while any surface still reads simulator data (role switcher, demo controls, the notice strip). */
export const USES_SIMULATOR = API_BASE.startsWith("/api/mock") && OFFLINE_DEMO_ENABLED;

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: ErrorCode | "NETWORK",
    message: string,
    public fields?: Record<string, string>,
    public correlationId?: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

async function request<T>(base: string, path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      ...init,
      headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}), ...init?.headers },
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, "NETWORK", base === AGENT_BASE ? "Can't reach the PowerMesh Agent on this device." : "Can't reach the coordinator.");
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
    if (body?.error) throw new ApiError(res.status, body.error.code, body.error.message, body.error.fields, body.error.correlationId, body.error.details);
    throw new ApiError(res.status, "INTERNAL", `Request failed (${res.status}).`);
  }
  return (await res.json()) as T;
}

const json = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });

function query(params: Record<string, string | number | null | undefined>): string {
  const q = new URLSearchParams(Object.entries(params).flatMap(([k, v]) => (v === undefined || v === null || v === "" ? [] : [[k, String(v)]]))).toString();
  return q ? `?${q}` : "";
}

export interface AuditQuery {
  jobId?: string;
  nodeId?: string;
  type?: string;
  q?: string;
}

const enc = encodeURIComponent;

export const api = {
  listJobs: (page: { cursor?: string | null; limit?: number } = {}) => request<Page<Job>>(JOBS_BASE, `/jobs${query(page)}`),
  getJob: (id: string) => request<Job>(JOBS_BASE, `/jobs/${enc(id)}`),
  submitJob: (body: SubmitJobRequest) => request<Job>(JOBS_BASE, "/jobs", json(body)),
  cancelJob: (id: string) => request<Job>(JOBS_BASE, `/jobs/${enc(id)}/cancel`, { method: "POST" }),
  jobEventsUrl: (id: string, after = 0) => `${JOBS_BASE}/jobs/${enc(id)}/events${after ? `?after=${after}` : ""}`,
  listWorkloads: () => request<WorkloadDefinition[]>(JOBS_BASE, "/workloads"),
  liveHealth: () => request<{ reachable: boolean; storage?: string; url: string }>("/api/live/v1", "/health"),
  getOffer: (id: string) => request<Offer>(API_BASE, `/offers/${enc(id)}`),
  listNodes: () => request<ProviderNode[]>(API_BASE, "/nodes"),
  getPolicy: (nodeId: string) => request<ProviderPolicy>(API_BASE, `/nodes/${enc(nodeId)}/policy`),
  putPolicy: (nodeId: string, body: Partial<ProviderPolicy>) =>
    request<ProviderPolicy>(API_BASE, `/nodes/${enc(nodeId)}/policy`, { method: "PUT", body: JSON.stringify(body) }),
  network: () => request<NetworkHealth>(API_BASE, "/network"),
  audit: (filters: AuditQuery = {}, page: { cursor?: string | null; limit?: number } = {}) =>
    request<Page<AuditEvent>>(API_BASE, `/audit${query({ ...filters, ...page })}`),
  /** Q17: POST /v1/audit/exports — the server builds the complete, redacted file. */
  exportAudit: async (filters: AuditQuery, format: "csv" | "json"): Promise<{ blob: Blob; filename: string }> => {
    let res: Response;
    try {
      res = await fetch(`${API_BASE}/audit/exports`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format, filters }),
        cache: "no-store",
      });
    } catch {
      throw new ApiError(0, "NETWORK", "Can't reach the coordinator.");
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
      throw new ApiError(res.status, body?.error.code ?? "INTERNAL", body?.error.message ?? `Export failed (${res.status}).`);
    }
    const filename = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? `powermesh-audit.${format}`;
    return { blob: await res.blob(), filename };
  },
};

/** Q21 / ADR-002: the provider's own Agent. Works while the coordinator is down. */
export const agent = {
  state: () => request<AgentLocalState>(AGENT_BASE, "/state"),
  stop: () => request<AgentLocalState>(AGENT_BASE, "/stop", { method: "POST" }),
  setAvailability: (available: boolean) => request<AgentLocalState>(AGENT_BASE, "/availability", json({ available })),
  decideOffer: (id: string, decision: OfferDecisionRequest["decision"]) => request<Offer>(AGENT_BASE, `/offers/${enc(id)}/decision`, json({ decision })),
};

export const devApi = {
  status: () => request<DevFlags>("/api/mock", "/dev"),
  send: (body: { action: string; value?: number }) => request<DevFlags>("/api/mock", "/dev", json(body)),
  setRole: (role: string) => request<{ role: string }>("/api/mock", "/session", json({ role })),
};

export interface DevFlags {
  coordinatorDown: boolean;
  agentConnected: boolean;
  pace: number;
  incident: { id: string; title: string; startedAt: string } | null;
}
