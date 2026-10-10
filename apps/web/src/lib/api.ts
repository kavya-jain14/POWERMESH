/**
 * Browser API client. Paths mirror master plan §7 "API contract v0".
 *
 * Modes (NEXT_PUBLIC_POWERMESH_MODE in the root .env):
 *  - "mock" (default): everything talks to the in-app mock coordinator under /api/mock.
 *  - "live": job endpoints go to /api/live/v1, a server-side bridge to the real coordinator
 *    (apps/api). Surfaces with no coordinator API yet — offers, nodes, policy, network, audit and
 *    the local Agent — stay on the mock until those endpoints exist.
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
  ProviderNode,
  ProviderPolicy,
  SubmitJobRequest,
  WorkloadDefinition,
} from "@/contracts-draft/types";

export const MODE: "mock" | "live" = process.env.NEXT_PUBLIC_POWERMESH_MODE === "live" ? "live" : "mock";
export const IS_LIVE = MODE === "live";
export const API_BASE = process.env.NEXT_PUBLIC_POWERMESH_API ?? "/api/mock/v1";
/** Jobs (submit, list, detail, events, cancel) and the workload catalogue. */
export const JOBS_BASE = IS_LIVE ? "/api/live/v1" : API_BASE;
export const AGENT_BASE = process.env.NEXT_PUBLIC_POWERMESH_AGENT ?? "/api/mock/agent";
/** True while any surface still reads mock data (role switcher, demo controls, the notice strip). */
export const IS_MOCK = API_BASE.startsWith("/api/mock");

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: ErrorCode | "NETWORK",
    message: string,
    public fields?: Record<string, string>,
    public correlationId?: string,
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
    if (body?.error) throw new ApiError(res.status, body.error.code, body.error.message, body.error.fields, body.error.correlationId);
    throw new ApiError(res.status, "INTERNAL", `Request failed (${res.status}).`);
  }
  return (await res.json()) as T;
}

const json = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });

export const api = {
  listJobs: () => request<Job[]>(JOBS_BASE, "/jobs"),
  getJob: (id: string) => request<Job>(JOBS_BASE, `/jobs/${encodeURIComponent(id)}`),
  submitJob: (body: SubmitJobRequest) => request<Job>(JOBS_BASE, "/jobs", json(body)),
  cancelJob: (id: string) => request<Job>(JOBS_BASE, `/jobs/${encodeURIComponent(id)}/cancel`, { method: "POST" }),
  jobEventsUrl: (id: string, after = 0) => `${JOBS_BASE}/jobs/${encodeURIComponent(id)}/events${after ? `?after=${after}` : ""}`,
  listWorkloads: () => request<WorkloadDefinition[]>(JOBS_BASE, "/workloads"),
  liveHealth: () => request<{ reachable: boolean; storage?: string; url: string }>("/api/live/v1", "/health"),
  getOffer: (id: string) => request<Offer>(API_BASE, `/offers/${encodeURIComponent(id)}`),
  decideOffer: (id: string, decision: OfferDecisionRequest["decision"]) =>
    request<Offer>(API_BASE, `/offers/${encodeURIComponent(id)}/decision`, json({ decision })),
  listNodes: () => request<ProviderNode[]>(API_BASE, "/nodes"),
  getPolicy: (nodeId: string) => request<ProviderPolicy>(API_BASE, `/nodes/${encodeURIComponent(nodeId)}/policy`),
  putPolicy: (nodeId: string, body: Partial<ProviderPolicy>) =>
    request<ProviderPolicy>(API_BASE, `/nodes/${encodeURIComponent(nodeId)}/policy`, { method: "PUT", body: JSON.stringify(body) }),
  network: () => request<NetworkHealth>(API_BASE, "/network"),
  audit: (filters: { jobId?: string; nodeId?: string; type?: string } = {}) => {
    const q = new URLSearchParams(Object.entries(filters).filter(([, v]) => v) as Array<[string, string]>).toString();
    return request<AuditEvent[]>(API_BASE, `/audit${q ? `?${q}` : ""}`);
  },
};

export const agent = {
  state: () => request<AgentLocalState>(AGENT_BASE, "/state"),
  stop: () => request<AgentLocalState>(AGENT_BASE, "/stop", { method: "POST" }),
  setAvailability: (available: boolean) => request<AgentLocalState>(AGENT_BASE, "/availability", json({ available })),
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
  incident: { id: string; title: string; openedAt: string } | null;
}
