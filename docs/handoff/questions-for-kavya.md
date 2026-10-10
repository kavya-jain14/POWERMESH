# Questions for Kavya — frontend ↔ backend contract (v0)

**From:** Gargi (product design, frontend) · **To:** Kavya / Kavya's agent (backend, security, infrastructure)
**Date:** 2026-10-10 · **Goal:** close these so we can freeze contracts v0 (master plan task **S1**) and swap the
frontend's draft types for `packages/contracts`.

---

## Instructions for the replying agent

You are answering on Kavya's behalf. Read these first — they are the source of truth:

1. `context.md` — Part B is the Fresh-Start Master Plan v1.0 (single source of truth). Part A is live status.
2. `docs/design/G1-information-architecture.md` — routes, role matrix, flows, state → copy table.
3. `apps/web/src/contracts-draft/types.ts` — the frontend's **provisional** types. They encode every proposal below.
4. `apps/web/src/mock/store.ts` — the in-app mock coordinator. It shows exactly how the UI expects each answer to behave.

**Decision rights (master plan §8):**
- Kavya has final say on security boundary, data model, runtime feasibility and backend sequencing.
- Gargi has final say on navigation, visual system, interaction patterns, accessibility and user-facing language.
- Anything that changes the **job contract, risk explanation or demo path** needs both. Mark those answers
  `needs_both: true` and Gargi will confirm.

**How to reply:**
- Answer every question using the reply block format at the end of this document (one block per question).
- `decision` must be one of: `accept` (take the proposal as written), `accept_with_changes`, `reject`
  (give the alternative), `defer` (say until when and what the UI should do meanwhile), `need_info`.
- If you change a shape, give the exact TypeScript or JSON. Don't describe it in prose.
- If an answer needs a new ADR, say so and give the ADR title.
- Don't invent job states or event names that aren't in the master plan, unless the question explicitly
  proposes an amendment.
- If a question is wrong or based on a misreading of the plan, say so plainly.

**Priority key:**
- **P-S1**: blocks the contract freeze. Answer first.
- **P-2**: needed before Phase 2 (real execution) integration.
- **P-later**: can wait until after the offline vertical slice works.

---

## A. Job contract and state machine

### Q1 — How is a lease-expiry retry represented? · P-S1 · needs both

**Context.** K11 says a killed Agent should let an eligible job "requeue once", and the Flight Recorder has a
"retrying" critical state. But the canonical table (§3) has no transition from CLAIMED, STAGING or RUNNING back
to QUEUED.

**UI today.** It uses a flagged proposal: `CLAIMED | STAGING | RUNNING → QUEUED`, with `job.attempt` going from
1 to 2 and a log event "Agent missed heartbeats — lease expired" first. Code: `PROPOSED_RETRY_TRANSITIONS` in
`types.ts` and `expireLease()` in `store.ts`. The UI groups the timeline by `attempt`.

**Options.**
- (a) Amend the table: add `→ QUEUED` from those three states, only when `reason = LEASE_EXPIRED`, the workload
  is idempotent and `attempt < 2`.
- (b) Keep the job terminal (`FAILED`) and create a new child job that links to the original.
- (c) Model attempts as Assignments, so the job state stays put while a new Assignment is made.

**Need back.** The chosen option, the exact field(s) the UI reads to show "attempt N", and the event sequence.

### Q2 — Are DECLINED and EXPIRED (of an offer) terminal for the job? · P-S1 · needs both

**Context.** The canonical table makes `OFFERED → DECLINED / EXPIRED` terminal. In practice the matcher might
offer the job to another node instead.

**UI today.** Both are treated as terminal. Copy: "The provider declined this request." / "No provider accepted
in time."

**Need back.** Terminal, or re-offer? If re-offer, which state does the job go back to, how many re-offers are
allowed, and is there a separate queue timeout (`QUEUED → EXPIRED`)? If so, how long is it?

### Q3 — Can a requester cancel while OFFERED? · P-S1 · needs both

**Context.** The table has no `OFFERED → CANCELLED`, and none from SUBMITTED or VALIDATING either.

**UI today.** The Cancel button is disabled during OFFERED. Its explanation reads: "You can cancel once the
provider responds or the request expires (within a minute)."

**Proposal.** Add `OFFERED → CANCELLED`. The coordinator withdraws the offer, and the Agent treats a later
decision on it as `409 CONFLICT`.

**Need back.** Accept or reject. If rejected, confirm the current UX is intended.

### Q4 — What are the stop/cancel reason codes? · P-S1

**Context.** The plan says the coordinator records who stopped the job and why.

**UI today.** `CANCELLED` always comes with `reason` set to one of `PROVIDER_STOP`, `REQUESTER_CANCEL` or
`ADMIN_STOP`. The job also gets a `stoppedBy: { role, label, reasonCode }` field.

**Need back.** The final enum of reason codes for every terminal state (`REJECTED`, `FAILED`, `CANCELLED`,
`TIMED_OUT`, `EXPIRED`, `DECLINED`). The UI renders failure copy from these, so please list the full set.
Codes the mock uses today: `RISK_BLOCKED`, `ROUTE_DEDICATED_ONLY`, `OFFER_EXPIRED`, `PROVIDER_DECLINED`,
`OUTPUT_VALIDATION_FAILED`, `PROVIDER_OFFLINE`, `LEASE_EXPIRED`, `HEARTBEAT_MISSED`.

### Q5 — Is DRAFT stored server-side? · P-2

**UI today.** DRAFT exists only in the browser. `POST /v1/jobs` creates the job directly in SUBMITTED. The
mock still emits a `DRAFT → SUBMITTED` event so the timeline starts cleanly.

**Need back.** Either "DRAFT is client-only", or the endpoint for saving drafts.

### Q6 — How is a blocked submission returned? · P-S1

**Context.** Blocked jobs must be rejected before scheduling.

**UI today.** `POST /v1/jobs` returns `201` with a job that becomes `REJECTED` within about a second, carrying
the risk facts. The Composer also previews risk and disables Submit, but the server is the authority.

**Option.** Return `422` with code `RISK_BLOCKED` and the risk object, so no job record is created.

**Need back.** 201 + REJECTED job, or 422 with no job. If 422, does it still produce an audit event, and
under which ID?

---

## B. Payload shapes

### Q7 — Risk explanation object · P-S1 · needs both

**Proposal (already used by the UI):**

```ts
interface RiskExplanation {
  tier: "LOW" | "MEDIUM" | "HIGH" | "BLOCKED";
  facts: Array<{ code: string; label: string; effect: "lowers" | "raises" | "blocks"; detail?: string }>;
  policyVersion: string;
  decidedAt: string; // ISO 8601
}
```

The UI renders `label` **verbatim**, so labels are user-facing copy owned by Gargi. The fact codes the UI
preview uses today are: `SIGNED_DIGEST_PINNED`, `UNSIGNED_OR_UNPINNED`, `NO_REQUESTER_CODE`,
`RUNS_REQUESTER_CODE`, `CODE_WITH_OPEN_WEB`, `NETWORK_OFFLINE`, `NETWORK_RESTRICTED`, `NETWORK_OPEN_WEB`,
`SECRETS_OR_DEVICES`, `BOUNDED_SCHEMAS`, `UNBOUNDED_SCHEMAS`, `ROUTE_DEDICATED_ONLY`. See
`apps/web/src/contracts-draft/risk.ts`.

**Need back.**
- The final shape.
- The final list of fact codes from K5.
- Whether labels live in the policy engine or in a copy table keyed by code. Gargi prefers a copy table in
  `packages/contracts` so wording can change without touching policy logic.

### Q8 — Error envelope · P-S1

**Proposal (already used by the UI):**

```ts
interface ApiErrorBody {
  error: {
    code: "VALIDATION_FAILED" | "RISK_BLOCKED" | "NOT_FOUND" | "FORBIDDEN" | "CONFLICT"
        | "OFFER_EXPIRED" | "RATE_LIMITED" | "UNAVAILABLE" | "INTERNAL";
    message: string;                 // safe to show to users
    fields?: Record<string, string>; // field key → message, for VALIDATION_FAILED
    correlationId: string;
  };
}
```

**Need back.**
- The final shape and code list.
- Confirmation that `message` never contains secrets, paths or internal stack details.
- The field keys for `POST /v1/jobs` validation. The UI maps `workloadId`, `inputs`, `networkMode`, and each
  param key.

### Q9 — Job view · P-S1

**UI today:** see `interface Job` in `types.ts`. Fields not in the master plan's minimum list (§7):
`requesterLabel`, `workloadName`, `workloadVersion`, `workloadDigest`, `inputs` (summary), `limits`,
`attempt`, `assignment { nodeId, nodeLabel, isolation, leaseUntil }`, `progress { done, total }`,
`usage { cpuCores, memoryBytes, diskBytes, elapsedSeconds }`, `artifacts`, `failure { code, reason }` and
`stoppedBy`.

**Need back.** Which of these the API will provide, and their exact names and units (bytes, seconds, cores as
a decimal).

### Q10 — Offer payload for the Approval Sheet · P-S1

**Proposal:** `interface Offer` in `types.ts`. It contains:
- workload `{ id, name, version, digest, signatureVerified, publisher, summary }`;
- inputs `{ count, contentTypes, totalBytes }`, deliberately **without filenames**;
- `params`, `limits`, `networkMode`, `risk`, `requesterLabel`;
- `createdAt`, `expiresAt` and `status: pending | approved | auto_approved | declined | expired`;
- `policyRule` (a plain-language sentence for auto-approvals).

**Need back.**
- Accept or change the shape.
- Is the requester's display name OK to show the provider?
- What is the offer TTL? The UI assumes 60 s and shows a countdown.

### Q11 — Node capability view: declared vs verified isolation · P-S1

**Context.** K12 says the UI must never claim an isolation level the Agent didn't actually verify.

**Proposal:**
`capability.isolation = { declared: IsolationLevel[], verified: IsolationLevel[], probedAt }`, where
`IsolationLevel = "docker-rootless" | "gvisor" | "vm" | "microvm"`. The UI shows only `verified` as active. The
matcher must use only `verified`.

**Need back.**
- Accept the shape.
- The final enum names.
- What a failed or pending probe looks like: an empty `verified` list, or a separate status?

### Q12 — Node status enum and post-stop behaviour · P-2

**UI today:** `NodeStatus = "offline" | "available" | "busy" | "paused"`.

After a provider's emergency stop, the mock sets the node to `paused`, so no new offers arrive until the
provider clicks "Resume sharing". This is a UX safety default proposed by Gargi.

**Need back.** The final enum, and whether auto-pause after a provider stop is OK on the backend side.

### Q13 — Provider policy shape · P-2

**UI today:** `interface ProviderPolicy` contains:
- `allowedWorkloads` and `riskMax` (only `LOW | MEDIUM` can be chosen);
- `consentMode: ask | auto`;
- `schedule: { mode: "always" } | { mode: "window", start: "HH:MM", end: "HH:MM" }`. The window can cross
  midnight. Timezone: ❓;
- `networkModes` and `resourceCaps { cpuCores, memoryBytes, diskBytes }`.

**Need back.**
- Accept the shape.
- Which timezone schedules use (node-local?).
- The validation rules and error field keys for `PUT /v1/nodes/:id/policy`.

### Q14 — Artifact metadata and URLs · P-2

**UI today:**
- **Shape:** `Artifact { id, jobId, direction, name, contentType, size, digest, url, urlExpiresAt, validation[] }`,
  where `validation` is a list of `{ code, label, passed }`.
- **URLs:** short-lived and signed (the mock uses `?exp=&sig=`, 10-minute TTL). They are refreshed by
  re-fetching the job.
- **Preview rules:** the UI only previews `image/png`, `image/jpeg` and `image/webp` when every check passed.
  Everything else is download-only.
- **Headers the UI expects** (the mock already sends them): `X-Content-Type-Options: nosniff`,
  `Content-Security-Policy: default-src 'none'; sandbox`, and `Content-Disposition: attachment` for downloads.

**Need back.**
- The final shape.
- The URL TTL.
- Whether `validation[]` is provided per artifact.
- How a failed validation is represented: the artifact is dropped and the job FAILS, or the artifact stays
  with `passed:false`.

---

## C. Endpoints

### Q15 — Read endpoints missing from API v0 · P-S1

The screens need these, and the mock already serves them at the paths below (under `/api/mock/v1`):

| Endpoint | Used by | Role scoping the UI assumes |
| --- | --- | --- |
| `GET /v1/jobs` | Job list, Control Room | requester: own jobs · provider: jobs assigned to own nodes · admin: all |
| `GET /v1/workloads` | Job Composer | everyone; includes unavailable workloads, with a reason |
| `GET /v1/nodes` | Control Room, Provider Console | requester: none · provider: own · admin: all |
| `GET /v1/network` | Control Room | everyone (aggregate counts only) |
| `GET /v1/offers/:id` | Approval Sheet deep link | the owning provider and admin |

**Need back.** Add, rename or reject each one. Also: is pagination needed on `GET /v1/jobs` and
`GET /v1/audit` for v0? If so, what's the cursor format?

### Q16 — Network health object · P-2

**UI today:**
`NetworkHealth { status: healthy | degraded | no_providers | incident, reason, coordinator, nodes { total, available, busy, offline, paused }, activeJobs, queuedJobs, incident?, checkedAt }`.

`reason` is a user-facing sentence. Rules the mock uses: `incident` when one is open; `no_providers` when 0
nodes are available or busy; `degraded` when there was a lease expiry in the last 5 minutes.

**Need back.** The shape, and who defines the `degraded` rule.

### Q17 — Audit query · P-2

**UI today:**
- `GET /v1/audit?jobId=&nodeId=&type=` returns `AuditEvent { id, at, actor, type, jobId?, nodeId?, summary, reason?, correlationId }`.
- Search is client-side, and export (CSV/JSON) is client-side over what's on screen.
- Event types the UI labels: `JOB_SUBMITTED`, `JOB_REJECTED`, `JOB_STATE_CHANGED`, `OFFER_CREATED`,
  `OFFER_APPROVED`, `OFFER_AUTO_APPROVED`, `OFFER_DECLINED`, `OFFER_EXPIRED`, `JOB_STOPPED`, `LEASE_EXPIRED`,
  `NODE_CONNECTED`, `NODE_DISCONNECTED`, `POLICY_UPDATED`, `ARTIFACT_VALIDATED`, `WORKSPACE_CLEANED`.

**Need back.**
- The final event-type enum.
- Should audit export be server-side (K13)?
- A `q` search parameter, or keep search client-side?

---

## D. Realtime

### Q18 — SSE event stream shape · P-S1 · needs both

**Proposal (already used by the UI)** for `GET /v1/jobs/:id/events`:
- SSE `id` = a per-job sequence number that only ever increases. It's used for `Last-Event-ID` resume.
- SSE `event` is one of `state`, `progress`, `log` or `heartbeat`.
- `data` is a `JobEvent { seq, id, jobId, type, state?, prevState?, progress?, usage?, message?, reason?, actor, at, correlationId, attempt }`.
- `heartbeat` events carry no `id`, so they don't move the resume point.
- On reconnect, the UI resumes from `Last-Event-ID` natively, or uses `?after=<seq>` when it reconnects
  manually. It drops any `seq` it has already seen.

**Need back.**
- Accept the shape.
- Is `?after=` OK as a fallback parameter?
- Does a finished job's stream replay the full history, then close?

### Q19 — Heartbeat interval and stale threshold · P-2

**UI today:** expects a server heartbeat every **5 s**. It marks the stream "stale" after **12 s** with no
messages, and retries the connection with backoff of 1 s, 2 s, 4 s, 8 s, then 15 s at most. Separately, the
mock's Agent lease is 30 s, and a missed heartbeat expires it after about 8 s (demo pacing).

**Need back.** The real SSE heartbeat interval, the Agent heartbeat interval, the lease length, and the expiry
grace period. The UI copy will quote these.

### Q20 — Does any event or audit row ever contain sensitive data? · P-S1

**Need back.** Confirmation that `message`, `reason`, `summary` and `safePayload` never contain: file paths,
filenames visible to providers, IP addresses, tokens or secrets. If they might, tell us which fields need
escaping or redaction. The UI renders all of them as plain text, never as HTML.

---

## E. Provider and Agent architecture

### Q21 — Where does the Provider Console talk to? · P-S1 · ADR needed

**Context.** The kill switch must work **without** the coordinator (§4 kill path, and a release blocker).
Offer decisions are signed with the Agent's identity (`POST /v1/offers/:id/decision`).

**Proposal.**
- The web app reads general state from the coordinator.
- **Stop** and **offer decision** go to a **local Agent endpoint** on loopback only, protected by a local
  token. The coordinator mirrors the result.
- If the local endpoint is down, the UI shows "Agent unreachable".

**UI today.** The mock exposes `GET /agent/state`, `POST /agent/stop` and `POST /agent/availability`
(`NEXT_PUBLIC_POWERMESH_AGENT`; see `AgentLocalState` in `types.ts`). Decisions currently go through the
coordinator path.

**Need back.**
- Accept or propose an alternative.
- The local endpoint's base URL and port convention, and how the browser authenticates to it (local token? an
  origin allowlist?).
- Whether decisions also go local.
- The ADR title.

**Watch out for:** a web page served from the coordinator's origin calling `127.0.0.1` will hit CORS and
private-network-access rules. We may need the Agent to serve its own small console page instead. Please
weigh in.

### Q22 — Is the kill path's timing observable? · P-2

**Context.** The target is CANCELLED with the process terminated within 5 s.

**UI today.** It shows "Stopping…", then "Stopped by you at HH:MM:SS".

**Need back.** Will the Agent emit separate events for "network revoked", "SIGTERM sent", "forced kill" and
"cleanup verified"? The timeline shows them if they exist. Also, which event marks the 5 s measurement point
for acceptance test S4?

### Q23 — Auto-approval audit · P-2

**UI today.** When `consentMode = auto`, the offer gets `status: auto_approved` plus a `policyRule` sentence, and
an `OFFER_AUTO_APPROVED` audit event is written.

**Need back.** Does the Agent or the coordinator make the auto-approve decision? And where does the
`policyRule` text come from?

---

## F. Security and privacy

### Q24 — Redaction for requesters · P-S1

**Context.** G1 says requesters never see the provider address, the node identity or the owner's identity.

**UI today.** The mock redacts the following for requesters:
- `assignment.nodeLabel` becomes "Community provider · os/arch", and `nodeId` becomes `"redacted"`;
- an event or audit actor with role `agent` becomes "Provider agent";
- an actor with role `provider` becomes "Provider";
- audit `nodeId` is removed.

**Need back.** Confirm this happens **server-side** in the real API, and whether showing `os/arch` and the
isolation level to requesters is acceptable.

### Q25 — Can providers see input filenames? · P-S1

**UI today.** Providers see only the input count, types and total size. The `inputs.files` list is removed for
the provider role.

**Need back.** Confirm. Should filenames be replaced server-side before staging, for example with
`input-001.png`?

### Q26 — Authentication for v0 (K4) · P-2

**UI today.** A mock `pm_role` cookie, switched from the sidebar. Every page still checks the role on the
server, and the mock API returns 403 for cross-role calls.

**Need back.**
- The auth method (the plan suggests magic link or hackathon OAuth).
- The session mechanism (cookie name, httpOnly, SameSite).
- Can one user hold several roles? The UI's role switcher assumes yes.
- How the web app learns the current user's role, e.g. a `GET /v1/me` endpoint.

### Q27 — Upload path for requester inputs · P-2

**UI today.** In mock mode, uploads send only `{ name, contentType, bytes }`. The real flow needs a scoped
upload.

**Need back.** The flow: (a) a pre-signed PUT per file and then submit with artifact IDs, or (b) a multipart
`POST`. Also which checks run client-side vs server-side (MIME sniffing, size, archive limits), so the UI
doesn't promise checks that don't exist.

---

## G. Workload, repo and process

### Q28 — image-transform workload definition · P-S1

**UI today** (`apps/web/src/contracts-draft/workloads.ts`):
- **Inputs:** PNG, JPEG or WebP; at most 12 files, 10 MB each, 50 MB in total.
- **Params:**
  - `format` ∈ {webp, jpeg, png};
  - `maxWidth` 256–4096 px, step 64, default 1600;
  - `quality` 40–95, default 82.
- **Limits:** 1 CPU, 512 MB RAM, 1 GB disk, 300 s, 64 PIDs.
- **Isolation:** at least `docker-rootless`.
- **Idempotent:** yes.
- **Digest:** a placeholder.

**Need back.** The real definition, or a pointer to `workloads/image-transform`. Should the UI render params
from the definition's JSON Schema? The UI wants the schema to carry label, hint and unit for each param.

### Q29 — Monorepo foundation overlap (K1) · P-S1

**What's there.** A minimal pnpm workspace: root `package.json`, `pnpm-workspace.yaml`, `apps/web` (Next.js 16.4,
React 19.3, TypeScript 5.9) and `packages/ui` (design primitives, Gargi's area). There's no Turborepo, CI,
`apps/api`, `apps/agent` or `packages/contracts` yet.

**Need back.**
- OK to keep this layout and add Turborepo, CI and your packages on top?
- Any version pins you need, such as the Node version?
- Who creates the GitHub repo and protects `main` (§12 step 1)? The folder isn't a git repo yet.

### Q30 — Mock ownership after your mock API lands · P-2

**Context.** Your handoff includes "a running mock endpoint". The frontend currently has its own mock under
`apps/web/src/app/api/mock` (rehearsal controls: Agent disconnect, coordinator down, incident, pace).

**Need back.** Once yours exists, should the frontend mock be deleted, or kept only as an offline demo
fallback? The demo-fallback rules in §11 suggest keeping one known-good local path.

---

## Reply format

Copy one block per question into `docs/handoff/answers-from-kavya.md`:

```yaml
- id: Q1
  decision: accept | accept_with_changes | reject | defer | need_info
  needs_both: true | false
  answer: >
    One or two sentences stating the decision.
  shape: |
    // exact TypeScript/JSON if anything changes; omit if accepting as written
  ui_impact: >
    What the frontend must change (or "none").
  adr: "ADR-00X: title"   # omit if none
  defer_until: "phase / date"   # only for defer
  interim_ui_behaviour: >
    What the UI should do until then (only for defer / need_info).
```

When all **P-S1** questions are answered, Gargi will update `apps/web/src/contracts-draft/` to match. Once
`packages/contracts` exists, those imports switch over, and we tag contracts v0 (S1).
