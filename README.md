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
6. The coordinator validates the result and records an append-only event trail.

No requester receives shell access, host filesystem access, Docker socket access, or a direct connection to a provider device.

## Repository map

```text
apps/
  web/        Requester, provider, approval, and job-status UI
  api/        Coordinator API and policy boundary
  agent/      Provider-side capability and execution Agent
packages/
  contracts/  Shared schemas, states, risk rules, and fixtures
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
pnpm dev
```

The web app runs at `http://localhost:3000` and the API at `http://localhost:4000`.

## Quality checks

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

Read [the architecture](docs/ARCHITECTURE.md), [security baseline](docs/SECURITY_BASELINE.md), and [team workflow](docs/TEAM_WORKFLOW.md) before implementing a new execution path.

## Ownership

- Kavya: backend, contracts, security policy, Agent, infrastructure
- Gargi: product flows, design system, frontend, accessibility
- Shared: integration, threat-model reviews, end-to-end tests, and demo readiness

## Current phase

Phase 0 — Align. Freeze contracts and safety claims before building the real execution path.
