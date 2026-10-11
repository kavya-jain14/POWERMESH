# PowerMesh — Mentor demo runbook

About 8 minutes plus Q&A. Follows the master plan's seven-minute story (§11) and adds one honest
"this part is real" segment. **Rule from §11: never fake it.** The full consent, run and stop story runs on
the in-app simulator. The coordinator, risk policy and security tests are Kavya's real code. Say which is which.

---

## 1. Setup (30 minutes before)

Run three terminals from the repo root.

**Terminal 1: coordinator API** (in-memory store, port 4000)

```bash
pnpm dev:api
```

**Terminal 2: live web app** (talks to the real API, port 3100). Build once, then start.

```bash
pnpm build:web
```

```bash
pnpm --filter @powermesh/web start --port 3100
```

**Terminal 3: simulator web app** (full story, port 3000). In PowerShell:

```powershell
$env:NEXT_PUBLIC_POWERMESH_MODE="offline-demo"; pnpm dev:web
```

Then, in the browser:

- [ ] **Tab A** → `http://localhost:3000`. The grey strip should say *"Offline demo…"*.
- [ ] **Tab B** → `http://localhost:3100`. The strip should say *"Live coordinator for jobs…"*.
- [ ] Tab A → sidebar **Demo controls**: **Reset demo data**, then set **Simulation pace = Narrated (×2)**.
      At this pace an offer stays open for 2 minutes instead of 1, so you can talk through the approval sheet.
      Stops are never slowed down by the pace setting.
- [ ] Tab A → **Viewing as: Requester**.
- [ ] Browser zoom 110–125%. Close other tabs. Do Not Disturb on.
- [ ] Keep a 4th terminal open at the repo root for the test run in Act 8.
- [ ] Rehearse the whole thing once. Time it.

If anything gets stuck mid-demo, use **Demo controls → Reset demo data**. It takes 2 seconds.

---

## 2. The flow

| # | Time | Act | Where |
| --- | --- | --- | --- |
| 1 | 0:00 | Problem and promise | Tab A · Control Room |
| 2 | 0:45 | Provider joins | Tab A · Provider |
| 3 | 1:30 | Requester submits (and gets blocked) | Tab A · Requester |
| 4 | 2:30 | Provider consents | Tab A · Provider |
| 5 | 3:15 | Job runs, result is validated | Tab A · Requester |
| 6 | 4:30 | Provider stops a job | Tab A · Provider |
| 7 | 5:15 | Audit: why was it allowed / stopped? | Tab A · Admin |
| 8 | 5:45 | This part is real | Tab B + terminal |
| 9 | 7:00 | Honest status and what's next | (talk) |

### Act 1 — Problem and promise (0:00–0:45)

**Show:** Tab A, switch to **Admin** → **Control Room** (network health, providers, mesh view).

**Say:**
> "Lots of machines in a lab or campus sit idle. But sharing a computer today means giving someone remote
> access to it, which nobody should do. PowerMesh shares **one capability, not the device**. A requester asks
> for a bounded job. They never get a shell, a desktop, an IP address or a file on the provider's machine."

### Act 2 — Provider joins (0:45–1:30)

**Click:** Viewing as → **Provider** → **Provider Console**.

**Point at:**
- **Two separate statuses**: *Agent on this device* vs *Coordinator*. "This console is served by the PowerMesh
  Agent on the provider's own machine. If the coordinator goes down, the provider still sees their device and
  can still stop work."
- **This device → Isolation: "Verified"** badges. "We only show an isolation level the Agent actually
  probed. Declared but unverified isn't shown as active."
- **Accept new requests** toggle and **Sharing policy**: highest risk LOW, "Ask me every time".

**Say:** "The provider decides what kind of work their machine accepts, and every request still needs their yes."

### Act 3 — Requester submits, and gets blocked first (1:30–2:30)

**Click:** Viewing as → **Requester** → **New job**.

1. Workload **Image transform**: point at *"Signed by PowerMesh · sha256:…"*. "Only signed,
   digest-pinned workloads. No arbitrary code."
2. Point at **Custom container image** being unavailable, with its reason.
3. Network → **Open internet**. The risk panel turns **BLOCKED** with the reason, and Submit is disabled.
   "Blocked before it's ever scheduled, and we tell you why in plain language. It's a deterministic rule,
   not an AI score. Even if someone bypassed this page, the coordinator answers 422 and never creates a
   job. Only an audit record exists."
4. Network back to **Offline** → **LOW risk** with its reasons. Inputs: **Demo sample set**.
5. **Submit job**. You land on the **Flight Recorder**: Checking → Queued → Offered.
   Point at **Cancel job**: it works even while the job is waiting for the provider. The offer is withdrawn.

### Act 4 — Provider consents (2:30–3:15)

**Click:** Viewing as → **Provider**. The "Needs your decision" panel appears → **Review request**.

**Walk the Approval Sheet top to bottom:**
- What will run: name, version, **verified signature**, image digest.
- Data it receives: **3 files, PNG, 7.3 MB, mounted read-only**. "The provider sees counts and sizes,
  never file names or contents up front."
- Limits on your device: CPU, memory, disk, time, processes. Network: **Offline — no network**.
- Risk: LOW, plus each reason.
- The **countdown**. "If nobody answers, the offer expires. Nothing runs by default."

**Click:** **Approve once**. (Keyboard alternative: Tab to it, Enter. Every flow works without a mouse.)

> If a mentor asks "what if the provider says no?": the job ends as **Declined** and nothing runs. No silent
> re-offer in v0. An unanswered offer expires after 60 s, and a job nobody can take leaves the queue after
> 5 minutes. Seeded job **job_1037** shows a declined job.

### Act 5 — Job runs, result is validated (3:15–4:30)

**Click:** Viewing as → **Requester** → **My jobs** → open the job.

**Point at:**
- Live **timeline**: every state with who changed it and why. Toggle **Show details** for Agent log lines
  ("Staged into /input (read-only)", "Sandbox removed. Workspace cleanup verified").
- **Limits** meters: "enforced by the sandbox, not just shown".
- **Job facts**: Runs on, isolation, Offline.
- When it finishes: the **Result** panel. Output digests, validation checks (type, size, digest), previews.
  "Only raster images get previewed. SVG or HTML would be download-only, so untrusted output never
  executes in the page."

### Act 6 — Provider stays in control (4:30–5:15)

**Click:** Requester → **New job** → Submit again → Provider → Review → **Approve once**.
As soon as it's **Running**:

- Point at the **pinned stop bar** at the top of the Provider Console.
- Press **Ctrl + .** (keyboard only), then **Enter** on "Stop now".
- Watch the stop steps tick off: stop recorded → network revoked → asked to exit → **process gone** →
  workspace cleaned. The job only says **Stopped** once the process is actually gone.
- The device is now **paused** until the provider presses **Resume sharing**.

**Say:** "The stop never leaves the provider's machine. The Agent on the device does it, so it works even
if the coordinator is down." (Optional: Demo controls → turn **Coordinator reachable** off. The console
shows a warning but keeps working, and **Stop job** still stops the job.)

> Short on time? Skip Act 6 and just point at the stop bar during Act 5.

### Act 7 — Audit trail (5:15–5:45)

**Click:** Viewing as → **Admin** → **Policy & Audit**. Filter by the stopped job. For the blocked request,
pick **Blocked by policy** under Event type: it has an event id but no job id, because a blocked request
never becomes a job.

**Say:** "Anyone can trace why a job was allowed, blocked, stopped or retried. The trail is append-only, and
the export is built on the server, so it's complete and redacted, not just what's on screen."

*(Optional extra if a mentor asks about failures: Demo controls → turn **Coordinator reachable** off. A job
page goes **stale/reconnecting**, then resumes with **no duplicate events** when it's switched back on.)*

### Act 8 — This part is real (5:45–7:00)

**Switch to Tab B** (live). Read the strip aloud: *"Live coordinator for jobs."*

1. **New job** → Demo sample set → **Submit**. The job gets a real UUID from Kavya's coordinator, and its
   state is **Policy checked**, which is the coordinator's own state. The risk reason shown came from its
   policy engine.
   "In live mode the browser never holds a credential. The web server enrolls you, keeps the token in an
   httpOnly cookie, and another requester can't read your job. We tested that."
2. **Terminal:** run the coordinator's tests with readable names.

```bash
pnpm --filter @powermesh/api exec vitest run --reporter=verbose
```

   Read three lines out loud:
   - *blocks a workload asking for the Docker socket*
   - *signs, approves, and claims an offer exactly once* (replay protection: signed offer, one-time nonce)
   - *prevents one requester from reading another requester's job*

   Optionally also run the Agent's tests (sandbox and egress policy):

```bash
pnpm --filter @powermesh/agent exec vitest run --reporter=verbose
```

   Good lines to read from the Agent run: *enforces gVisor, identity, offline networking, and hard limits*,
   *rejects traversal, active content, oversized files, and spoofed magic bytes*,
   *blocks an entire DNS answer set if any answer is private*, *cleans up even when execution fails*.

### Act 9 — Honest status and what's next (7:00–7:45)

**Say it straight:**

| Real today | Simulated in this demo | Next |
| --- | --- | --- |
| Full UI for all six surfaces, accessible (keyboard, contrast AA), built to the agreed v0 contract | Provider-side flow: offer → approve → run → stop → result | Matcher: create offers automatically |
| Coordinator API: submit, deterministic risk policy, signed one-time offers, requester isolation, rate limits | Node list, network health, audit data | The Agent's local console and API (ADR-002), so the Provider Console's stop and approve go live |
| Agent sandbox and egress-proxy code, with unit tests | Sandbox runs against real Docker (not shown today) | Job event stream, cancel/stop, list and audit endpoints |

> "The narrow promise, visibly enforced. Every safety claim on screen has to map to a test, and where it
> doesn't yet, we tell you."

---

## 3. Likely mentor questions

| Question | Answer |
| --- | --- |
| How is this different from Golem / Salad / Vast? | They rent devices or GPUs. We share one signed capability with **per-job consent**, explainable risk and a local stop switch, aimed at trusted campus and lab communities. |
| Isn't Docker escapable? | Yes, and we don't claim otherwise. It's layered: rootless, gVisor where supported, no host mounts or socket, offline by default, quotas. Higher-risk work only goes to a dedicated microVM pool. |
| Can the provider see my data? | They can in principle, on their own machine. That's a stated residual risk. So: trusted community nodes only, and no sensitive data to unknown providers. |
| What stops a provider faking results? | Output type, size and digest validation, plus a trust record. Redundancy and challenges are on the roadmap. |
| Why not let users run any container? | That's HIGH risk. It's blocked on personal devices by design, with a clear reason in the UI. |
| Is the risk score AI? | No. Deterministic rules with reasons, and unit-tested. |
| What happens if the coordinator goes down? | Running jobs continue. The Provider Console is served by the Agent on the device, so the provider can still see and stop work. The UI distinguishes "coordinator down" from "Agent down" and reconnects without duplicating events. |
| Cross-platform? | Linux reference node. Windows and macOS through a Linux VM boundary. Jobs target capabilities, not operating systems. |

---

## 4. If something breaks

| Problem | Fix |
| --- | --- |
| Mock state is weird or a job is stuck | Demo controls → **Reset demo data** |
| Offer expired before you clicked Approve | Submit again. Check that pace is **Narrated (×2)** |
| Tab B shows "Can't reach the coordinator" | Terminal 1: restart `pnpm dev:api`. Or skip to the test run in Act 8 |
| Tab B shows "can't enroll you" | Root `.env` is missing `POWERMESH_ENROLLMENT_KEY`. Copy `.env.example` → `.env` and restart Terminal 2 |
| A tab says Offline demo or Live when it shouldn't | Mode is set when a server starts. Restart that server (see Setup) |
| Live job never moves past "Policy checked" | Expected. There's no matcher yet. Say so (Act 9) |
| Tab B's Control Room or Audit says the offline demo is off | Expected: Tab B is a production build, and the offline demo is disabled there (Q30). Stay on My jobs / New job in Tab B |
| Someone clicks **Cancel job** in Tab B | It says cancelling isn't available yet. True: the coordinator API has no cancel endpoint. Say so and move on |
| Anything else | Say what failed, then switch to the test run. Don't fake it (§11) |
