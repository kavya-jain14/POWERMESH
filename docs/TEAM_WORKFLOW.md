# Team workflow

## Ownership

| Area | Accountable | Reviewer |
| --- | --- | --- |
| Contracts, API, database, Agent, runtime security | Kavya | Gargi |
| Information architecture, design system, frontend, accessibility | Gargi | Kavya |
| Integration, threat model, E2E verification, demo | Shared | Shared |

## First work queue

### Kavya

1. Freeze workload, event, node, offer, and risk schemas.
2. Add PostgreSQL migrations and an append-only job-event table.
3. Implement role boundaries and deterministic state transitions.
4. Build the provider registration, heartbeat, offer, and lease flow.
5. Add the offline sandbox adapter and P0 security tests.

### Gargi

1. Map the requester, provider, approval, job, result, and audit routes.
2. Turn the visual tokens into reusable accessible components.
3. Build the requester composer against contract fixtures.
4. Build provider consent and local-stop states.
5. Build a reconnect-safe job timeline and sanitized result view.

## Handoff contract

Kavya provides versioned schemas, representative success and failure fixtures, and a running mock endpoint before a screen integrates. Gargi provides annotated flows, precise state copy, and expected failure behavior before an endpoint is frozen.

Contract changes require both owners. P0 security or data-loss issues block release.
