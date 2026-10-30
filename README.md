# PowerMesh

PowerMesh is a secure peer-to-peer compute network that lets people share idle hardware through isolated, consent-based, and risk-aware workloads.

> Share a capability, not a device.

## Fresh-start scope

The first release proves one narrow workflow:

1. A requester submits a declarative workload.
2. The coordinator validates it and assigns a deterministic risk tier.
3. A compatible provider sees the exact resource and network request.
4. The provider explicitly approves or declines the offer.
5. The Agent runs the approved workload inside a constrained sandbox.
6. The Agent validates bounded output bytes and reports only digest metadata; the coordinator records
   the validated lifecycle in its append-only event trail.

No requester receives shell access, host filesystem access, Docker socket access, or a direct connection to a provider device.

## Repository map

```text
apps/
  web/        Requester, provider, approval, and job-status UI (Next.js)
  api/        Coordinator API and policy boundary
  agent/      Provider-side capability and execution Agent
packages/
  contracts/  Shared schemas, states, risk rules, and fixtures
workloads/
  image-transform/  Reviewed offline demo workload
docs/         Architecture, security, ownership, and decisions
```

## Prerequisites

- Node.js 22 or newer
- Corepack
- Docker Desktop or a compatible Docker Engine for PostgreSQL

## Start locally

```bash
corepack enable
pnpm install
pnpm infra:up
cp .env.example .env
pnpm db:migrate
pnpm dev
```

The web app runs at `http://localhost:3000` and the API at `http://localhost:4000`. Without
`DATABASE_URL`, the API intentionally falls back to an in-memory store for contract and UI work.

Initial API routes:

- `GET /v1/workloads` — list coordinator-approved workload releases and parameter schemas
- `POST /v1/jobs` — submit a catalog workload by ID; image and resource policy are server-owned
- `GET /v1/jobs/:id` — read the normalized job state
- `POST /v1/nodes/register` — register or refresh a provider capability record
- `POST /v1/nodes/:id/heartbeat` — publish live capacity without accepting inbound access
- `POST /v1/risk/classify` — explain the deterministic risk decision
- `POST /v1/jobs/:id/offers` — create a short-lived Ed25519-signed provider offer
- `GET /v1/nodes/:id/offers` — let an authenticated Agent poll outbound for pending work
- `POST /v1/nodes/:nodeId/offers/:offerId/approve` — record explicit provider consent
- `POST /v1/nodes/:nodeId/offers/:offerId/claim` — consume the nonce and start a short lease
- `POST /v1/nodes/:nodeId/jobs/:jobId/start` — record authenticated Agent execution
- `POST /v1/nodes/:nodeId/jobs/:jobId/complete` — report bounded hashes and validation status

The matcher runs after job submission and provider heartbeats. It uses fresh heartbeats, exact
capability checks, deterministic least-load ordering, and coordinator-side capacity reservations so
pending offers cannot oversubscribe a node.

Provider registration returns an Agent bearer token once. Keep it in the Agent's OS credential
store; only its SHA-256 digest is persisted. Re-registration rotates the token and requires the
current token. Production also requires a stable base64-encoded Ed25519 private key and separate
coordinator and enrollment keys. Requester identity is derived from its issued bearer credential;
clients cannot submit or read a job as another requester.

## Image-transform workload

Build the reviewed non-root workload image with:

```bash
pnpm workload:image:build
```

Publish it to a registry, use the registry's immutable `name@sha256:...` reference as
`POWERMESH_IMAGE_TRANSFORM_IMAGE`, and restart the API. The requester supplies only validated
`format`, `maxWidth`, and `quality` values; the coordinator supplies the image, limits, and offline
network policy. The current demo transforms an embedded PowerMesh image. Requester artifact upload,
quarantine, and delivery are intentionally not claimed as complete yet.

First set `POWERMESH_COORDINATOR_URL`, `POWERMESH_ENROLLMENT_KEY`, and `POWERMESH_OWNER_ID`, then run
`pnpm --filter @powermesh/agent enroll`. Verify the displayed signing-key fingerprint through a
trusted channel and save the returned node ID as `POWERMESH_NODE_ID`. The Agent token and pinned key
are written to Keychain, Windows DPAPI-backed storage, or Linux Secret Service—not to `.env`.

With `POWERMESH_COORDINATOR_URL`, `POWERMESH_NODE_ID`, and enrolled credentials present in the OS
credential store, the Agent polls outbound for signed offers, verifies the pinned Ed25519 key,
approves according to local policy, claims once, executes, validates output magic bytes, and reports
only sizes and SHA-256 digests. `POWERMESH_AUTO_APPROVE_LOW_RISK=true` is an explicit demo-only local
policy choice; it never enables medium- or high-risk auto-approval.

## Windows NVIDIA proof

The GPU demo is a real cross-device path: a requester submits the fixed `gpu-benchmark` catalogue
workload, the coordinator matches a live CUDA-capable node, and the provider Agent launches the
digest-pinned container with only the selected NVIDIA device. The validated result contains the
actual GPU model, CUDA runtime, compute capability, matrix dimensions, kernel duration and checksum.

On Windows the Agent runs inside WSL2 and Docker Desktop supplies NVIDIA GPU passthrough. This
development profile is enabled explicitly with `POWERMESH_ALLOW_DESKTOP_SANDBOX=true` and is never
reported as rootless isolation. Follow [`docs/demo/windows-gpu-demo.md`](docs/demo/windows-gpu-demo.md)
for the two-laptop runbook.

Build the CUDA workload locally with:

```bash
pnpm workload:gpu:build
```

## Web app (Gargi)

`apps/web` covers the six surfaces in master plan §6: Job Composer, Flight Recorder, Provider Console,
Approval Sheet, Control Room and Policy & Audit. Its design system lives in `packages/ui`
(theme "2077": tokens, components, `pnpm check:contrast`). Living status and decisions: [`context.md`](context.md).

The UI runs in one of two modes, set by `NEXT_PUBLIC_POWERMESH_MODE` in the root `.env`:

- **`offline-demo`** (default; `mock` is an alias): an in-app simulator under `/api/mock` that follows the
  v0 contract answers (`docs/handoff/answers-from-kavya.md`). It also simulates the provider's Agent local
  API (ADR-002). Every surface and state works with no backend, for design work and demo rehearsal. A
  strip at the top of each page says "Offline demo data". Off in production builds unless
  `NEXT_PUBLIC_POWERMESH_OFFLINE_DEMO=1`.
- **`live`**: job submission, job list, job detail and the live timeline go to the coordinator API
  through a server-side bridge (`/api/live/v1`). The bridge holds the enrollment credential and keeps
  the requester token in an httpOnly cookie, so no credential ever reaches browser JavaScript. Surfaces
  with no API yet (provider console, offers, network health, audit) use the simulator in development
  and say so.

```bash
pnpm dev:api   # coordinator on :4000 (in-memory store unless DATABASE_URL is set)
pnpm dev:web   # web on :3000
```

Demo click path (offline demo, about 2 minutes):

1. **Requester** → New job → Demo sample set → Submit. Watch the Flight Recorder move through its states.
2. Switch to **Provider** → "Review request" → read the Approval Sheet → **Approve once**.
3. Back as **Requester**, open the job: live timeline, limits, then the validated result.
4. Run another job and, as Provider, press **Stop job** (or Ctrl + .) while it runs.
5. As **Admin**: Control Room for health and nodes, Policy & Audit to trace why a job was allowed or blocked.

## Quality checks

The provider Agent bounds each coordinator request to 15 seconds, including reading its JSON response body. A stalled call is aborted and the polling loop can recover instead of waiting indefinitely. An already-sent mutation may have reached the coordinator before a timeout; the deadline does not imply that it was rolled back. Individual cancellation while an offer is still awaiting approval remains a separate integration boundary.

```bash
pnpm check
```

This runs formatting/lint checks, TypeScript validation, unit tests, and production builds across the workspace.

## Security baseline

- Default network mode is `OFFLINE`; restricted egress must name exact destinations.
- Jobs requesting privileged mode, host mounts, the Docker socket, or raw device access are blocked.
- Provider execution is rootless and receives a per-job workspace only.
- CPU, memory, PID, disk, and wall-clock limits are mandatory.
- The provider can stop work locally even if the coordinator is unavailable.
- Container isolation is never described as impenetrable. The runtime reports the isolation it actually verified.

The provider Agent advertises execution only after detecting Linux rootless Docker. Offline jobs use
`--network=none`; restricted jobs use a per-job internal network whose only egress path is a
digest-pinned, quota-limited allowlist proxy. Medium-risk work additionally requires gVisor.

Read [the architecture](docs/ARCHITECTURE.md), [security baseline](docs/SECURITY_BASELINE.md), and [team workflow](docs/TEAM_WORKFLOW.md) before implementing a new execution path.

## Ownership

- Kavya: backend, contracts, security policy, Agent, infrastructure
- Gargi: product flows, design system, frontend, accessibility
- Shared: integration, threat-model reviews, end-to-end tests, and demo readiness

## Current phase

Phase 1 — Secure execution loop. The catalog, automatic matcher, authenticated Agent loop, sandbox
adapter, and offline image-transform workload are implemented. Artifact transport and provider UI
integration remain the next milestone.
