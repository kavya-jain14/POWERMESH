# Follow-ups for Kavya, after `answers-from-kavya.md`

From Gargi, 2026-10-10. Thanks, the answers unblock most of the UI. Below are the points where an answer
conflicts with the code that's actually merged, or with how browsers behave. These need a decision before we
freeze contracts (S1). Same reply format as before is fine.

---

## F1 — PRs #2–#6 never reached `main` · **blocking** (re: Q29 "rebase onto current main")

Your PRs were stacked: #2 merged into `kavya/repo-foundation`, #3 into `kavya/backend-state-machine`, and so on
up to #6 into `kavya/sandbox-runtime`. `origin/main` is still at PR #1 (`b92157c`): no `apps/api`, no
`apps/agent` code, no contracts beyond the skeleton. So "rebase onto current main" would drop the whole backend.

**Ask:** open one PR `kavya/sandbox-runtime → main` (its tree contains every backend commit, and
`kavya/controlled-egress` is identical). Once that lands, Gargi's branch merges cleanly. A local merge of that
same tip already builds, typechecks and passes your tests (53 passed, 1 Postgres test skipped).

## F2 — One job state enum · **blocking S1** (re: Q1, Q2, Q4, Q5, Q6)

The answers and `packages/contracts` describe different state machines:

| Topic | Answers say | `packages/contracts` today |
| --- | --- | --- |
| Creation (Q5) | `POST /v1/jobs` creates the job in `SUBMITTED` | Store creates it directly in `POLICY_CHECKED` |
| Retry (Q1) | `CLAIMED`/`RUNNING → OFFERED` on lease expiry | Not allowed: `CLAIMED → RUNNING/EXPIRED/FAILED/CANCELLED`, `RUNNING → VALIDATING/FAILED/CANCELLED` |
| Rematch (Q2) | Declined/expired offer → back to `OFFERED` with a new offer | `OFFERED → APPROVED/EXPIRED/CANCELLED`; no `OFFERED → OFFERED` |
| Reason codes (Q4) | Mention `REJECTED` and `TIMED_OUT` | Neither state exists |
| Consent | Not mentioned | `APPROVED` is a job state (separate from `CLAIMED`) |

**Proposal (UI is fine with any of these, it just needs one list):**
`SUBMITTED → POLICY_CHECKED → OFFERED → APPROVED → CLAIMED → RUNNING → VALIDATING → SUCCEEDED`, terminal
`FAILED | CANCELLED | EXPIRED`. No `REJECTED` (Q6: blocked = 422, no row). `TIMED_OUT` becomes
`FAILED` + `WALL_CLOCK_TIMEOUT`. Add `CLAIMED|RUNNING → OFFERED` (retry, attempt + 1) and `OFFERED → OFFERED`
(re-offer, as an event rather than a transition). Please confirm or amend, and update `allowedJobTransitions`.
The UI will then delete its draft table and import yours.

## F3 — SSE heartbeats as comment lines can't be seen by the browser (re: Q18, Q19)

`EventSource` drops comment lines (`: heartbeat`) before any script sees them. There's no event, callback or
`readyState` change. The UI therefore can't tell "connected but quiet" from "silently dead", which is exactly the
stale state Q19 asks us to show after 25 s.

**Ask (pick one):**
1. Send heartbeats as a named event with no `id`: `event: heartbeat\ndata: {"at":"…"}\n\n`. It doesn't touch
   `Last-Event-ID`, and the UI already treats it as transport liveness, not a timeline event (this is today's
   mock).
2. Keep comment lines for proxies **and** add the named event every 10 s.

## F4 — Live API vs the answered shapes: what's implemented, and when?

The answers describe v0 contracts. The merged API implements a subset. To plan the UI swap, please mark which
of these you'll build and in what order:

| Answer | Needed by UI for | Merged today? |
| --- | --- | --- |
| Q8 error envelope `{error:{code,message,correlationId,…}}` | All error states | No (`{error:"CODE"}`) |
| Q9 `JobView` (nested `workload`, inputs with bytes, full limits, assignment) | Job page, list | No (raw `JobRecord`) |
| Q15 `GET /v1/jobs`, `/workloads`, `/nodes`, `/network`, `/offers/:id`, `/audit` (+ cursors) | List, catalogue, Control Room, Approval Sheet, Audit | No |
| Q18 `GET /v1/jobs/:id/events` (SSE) | Flight Recorder | No |
| Q3 cancel, Q21 `POST /v1/jobs/:id/stop`, `POST /v1/offers/:id/decision` | Cancel, stop, approve from the provider UI | No (only Agent-token approve/claim) |
| Q26 OAuth session + `GET /v1/me` | Real roles | No |
| Q27 `POST /v1/uploads` | Real inputs | No |
| Matcher (creates offers automatically) | Anything after `POLICY_CHECKED` | No (coordinator-key only) |

Also: `JobRecord` and the Q7 `RiskFactCode` copy table should be exported from `@powermesh/contracts`, so the
UI stops mirroring them.

## F5 — Small confirmations

- **Q28:** until `GET /v1/workloads` returns a real digest, the UI's live mode sends the catalogue placeholder
  digest. It only reaches `POLICY_CHECKED` today, so nothing executes. Agree the coordinator should reject
  unknown digests once the signed definition exists?
- **Q21:** the Provider Console stays functional only via the coordinator, as you decided. While the
  coordinator is unreachable the console shows "use the local emergency stop" (CLI/socket). Please share the
  exact CLI command so the UI can print it.
- **Q30:** agreed. The frontend mock becomes an explicit `offline-demo` mode. When will the shared mock/API
  endpoint land, so `live` can become the default?

## F6 — Shapes the UI now assumes (please confirm or amend)

The offline demo now follows your answers end to end. Where the answers left a gap, it uses the shapes below.
Each one is marked "proposal" in `apps/web/src/contracts-draft/types.ts`.

1. **Scheduling window start (Q2).** The 120 s window starts when the job first reaches `OFFERED` in an attempt.
   While no provider matches at all, the job waits in `POLICY_CHECKED` with no deadline, because
   `allowedJobTransitions` has no `POLICY_CHECKED → EXPIRED`. Should it get one (`SCHEDULING_TIMEOUT`)?
2. **Retry before a concrete offer (Q1).** On lease expiry the demo moves `CLAIMED|RUNNING → OFFERED`
   (attempt + 1) right away, then looks for a node. The answers say "returns to OFFERED only if another concrete
   offer is created". If no node is free, where does the job wait? We'd suggest `OFFERED` with the scheduling window
   running.
3. **Re-offer and decline as events.** A decline, an offer expiry or a re-offer doesn't change state. The demo
   records each one as a `log` event with a `code`: `OFFER_DECLINED`, `OFFER_EXPIRED` or `OFFER_CREATED`.
4. **Stop steps (Q22).** Each Agent stop step is also a `log` event with `code` set to the `AgentStopEvent`
   value. The UI shows "Stopped" only after `PROCESS_EXITED`. `JobEvent` in Q18 has no `code` field, so please
   add one, or tell us how these events are carried instead.
5. **Withdrawn offer (Q3).** After a cancel while `OFFERED`, the offer's status becomes `"withdrawn"`, so the
   Approval Sheet can say "the requester cancelled". It isn't in the Q10 `OfferStatus`.
6. **Provider Console reads (Q21).** The console needs its node, the Agent's link to the coordinator, the pending
   offer, the active and last job, and an in-progress stop. The demo serves all of it from one
   `GET /v1/provider/console` call. The alternative is composing `GET /v1/nodes`, `GET /v1/offers?status=pending`
   (not in Q15) and `GET /v1/jobs`. Which one do you prefer?
7. **Pause/resume (Q12).** `POST /v1/nodes/:id/availability {available}` pauses or resumes new offers without
   stopping the current job. It isn't in the answers yet.
8. **JobView extras (Q9).** The job page also shows `risk` (`RiskExplanation`) and `inputDigest`, which the Q9
   shape leaves out. Can they be added for requester and admin views?
9. **Blocked request reference (Q6).** API v0's 422 returns `{error, risk}` with no `submissionAttemptId` or
   `correlationId`. The composer shows the reference only when one is present.
10. **Heartbeats (F3).** The demo already sends the named `heartbeat` event every 10 s, so it's ready for
    option 1.

## F7 — After the 2026-10-11 merge (supersedes parts of F2, F3 and F6)

F1 is resolved, thanks: everything is on `main`, and Gargi's branch merges cleanly (22 + 29 + 10 tests pass).

1. **Two answer files.** The one Gargi received (saved 22:03) and the one on `main` (committed 22:24) disagree on
   Q1, Q2, Q19, Q21 and Q22. We'll treat `main` as authoritative. Gargi confirms the `needs_both` items (Q1, Q2, Q3,
   Q7, Q18, Q28) in a separate reply.
2. **Contracts contradict themselves.** `jobStates` and `allowedJobTransitions` still have 11 states (no QUEUED,
   STAGING, REJECTED, DECLINED or TIMED_OUT). But `terminalReasonsByState` / `terminalStateSchema` use
   REJECTED, DECLINED and TIMED_OUT, and the answers use QUEUED (Q1, Q2) and STAGING (Q1). Please update
   `schemas.ts` and `state-machine.ts` to the master-plan table plus `QUEUED_TIMEOUT` and the retry transition, so
   the UI can import one list.
3. **Q22 naming.** `auditEventTypes` has NETWORK_REVOKED, TERMINATION_REQUESTED and PROCESS_KILLED. Is there a
   PROCESS_EXITED for a graceful exit (no kill needed)? "Stopped" should mean the process is gone either way.
4. **Q21 / ADR-002 (proposed).** Done on the UI side (2026-10-11): the Provider Console and offer decisions use
   `/v1/local/{state,stop,availability,offers/:id/decision}`. The offline demo simulates them. Point
   `NEXT_PUBLIC_POWERMESH_AGENT` at `http://127.0.0.1:4765/v1/local` once the Agent serves them. The UI expects
   `AgentLocalState` (see `apps/web/src/contracts-draft/types.ts`). Please confirm the shape or send yours.
5. **Flaky test.** `apps/api` "reports health" hit vitest's 5 s timeout once during a parallel `turbo test`, then
   passed twice on its own. A longer timeout or a warm-up would fix it.
6. **UI now follows the 22:24 answers** (Gargi confirmed the `needs_both` items Q1, Q2, Q3, Q7, Q18 and Q28).
   The UI-side state table is the master-plan one plus POLICY_CHECKED/APPROVED for coordinator v0. Once
   `jobStates` matches, the UI deletes its copy and imports yours.
