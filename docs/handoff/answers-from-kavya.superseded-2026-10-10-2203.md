# Answers from Kavya — frontend ↔ backend contract v0

Source basis: current `main` architecture/security docs plus Gargi's 2026-10-10 handoff. Where the handoff conflicts with current `main`, current backend/security boundaries win and the answer calls out the required UI/contract amendment.

- id: Q1
  decision: accept_with_changes
  needs_both: true
  answer: >
    Retry is represented as a new assignment attempt for the same job, not as a second job. A lease expiry during CLAIMED/RUNNING may create one new attempt only when the workload is idempotent and attempt < 2; the job returns to OFFERED for rematching rather than inventing a hidden retry state.
  shape: |
    interface JobAttempt {
      attempt: number;
      assignmentId: string;
      nodeId?: string;
      startedAt?: string;
      endedAt?: string;
      endReason?: "LEASE_EXPIRED" | "PROVIDER_OFFLINE" | "HEARTBEAT_MISSED" | "STOPPED";
    }

    interface Job {
      attempt: number;
      attempts: JobAttempt[];
    }

    // event sequence on retry:
    // LEASE_EXPIRED -> JOB_STATE_CHANGED(RUNNING|CLAIMED -> OFFERED) -> OFFER_CREATED
  ui_impact: >
    Group the timeline by job.attempt/attempts. Remove the direct retry-to-QUEUED assumption and treat OFFERED as the rematch point.
  adr: "ADR-002: Job retries use assignment attempts"

- id: Q2
  decision: accept_with_changes
  needs_both: true
  answer: >
    Provider decline or offer expiry is terminal for that offer, not for the job. The job may be re-offered to another eligible node up to 3 total offers; if no offer is accepted within the 2-minute scheduling window, the job becomes EXPIRED.
  shape: |
    interface SchedulingPolicy {
      maxOffers: 3;
      schedulingTtlSeconds: 120;
    }

    type OfferStatus = "pending" | "approved" | "auto_approved" | "declined" | "expired";
    // declined/expired offer -> job returns to OFFERED only if another concrete offer is created;
    // scheduling TTL exhausted -> job EXPIRED with reason NO_PROVIDER_ACCEPTED
  ui_impact: >
    Do not render DECLINED/offer EXPIRED as job-terminal. Show the declined/expired offer in history and continue with "Finding another provider…" until the job itself expires.

- id: Q3
  decision: accept
  needs_both: true
  answer: >
    Add OFFERED -> CANCELLED. The coordinator withdraws the active offer, and any later approval/decline for that withdrawn offer returns 409 CONFLICT.
  ui_impact: >
    Enable Cancel while OFFERED and remove the current "wait for provider response" restriction.

- id: Q4
  decision: accept_with_changes
  needs_both: false
  answer: >
    Use a closed reason-code enum. Terminal job state and reason are separate; the same reason may only be used where listed below.
  shape: |
    type JobTerminalReasonCode =
      | "RISK_BLOCKED"                // REJECTED if retained by UI compatibility; otherwise 422 pre-job
      | "POLICY_DENIED"               // REJECTED
      | "ROUTE_DEDICATED_ONLY"        // REJECTED
      | "NO_PROVIDER_ACCEPTED"        // EXPIRED
      | "SCHEDULING_TIMEOUT"          // EXPIRED
      | "OFFER_EXPIRED"               // offer-level; may contribute to EXPIRED
      | "PROVIDER_DECLINED"            // offer-level; may contribute to EXPIRED
      | "REQUESTER_CANCEL"             // CANCELLED
      | "PROVIDER_STOP"                // CANCELLED
      | "ADMIN_STOP"                   // CANCELLED
      | "LEASE_EXPIRED"                // FAILED only after retry budget exhausted
      | "HEARTBEAT_MISSED"             // FAILED only after retry budget exhausted
      | "PROVIDER_OFFLINE"             // FAILED only after retry budget exhausted
      | "SANDBOX_START_FAILED"         // FAILED
      | "SANDBOX_RUNTIME_FAILED"       // FAILED
      | "RESOURCE_LIMIT_EXCEEDED"      // FAILED
      | "WALL_CLOCK_TIMEOUT"           // TIMED_OUT/FAILED depending shared state enum
      | "OUTPUT_VALIDATION_FAILED"     // FAILED
      | "WORKSPACE_CLEANUP_FAILED"     // FAILED
      | "INTERNAL_ERROR";              // FAILED

    interface StoppedBy {
      role: "requester" | "provider" | "admin" | "agent";
      label: string;
      reasonCode: "REQUESTER_CANCEL" | "PROVIDER_STOP" | "ADMIN_STOP";
    }
  ui_impact: >
    Drive failure/terminal copy from reasonCode; keep user-facing wording outside policy logic.

- id: Q5
  decision: accept
  needs_both: false
  answer: >
    DRAFT is client-only in v0. POST /v1/jobs creates a server job in SUBMITTED; the backend does not persist drafts.
  ui_impact: >
    Keep local draft persistence if desired, but do not emit a fake server audit event for DRAFT -> SUBMITTED.

- id: Q6
  decision: accept_with_changes
  needs_both: false
  answer: >
    Return 422 RISK_BLOCKED and do not create a Job row. The attempt is still recorded as a safe audit event with a correlationId and a generated submissionAttemptId, never a jobId.
  shape: |
    {
      "error": {
        "code": "RISK_BLOCKED",
        "message": "This request is blocked by the current safety policy.",
        "correlationId": "...",
        "details": {
          "submissionAttemptId": "sat_...",
          "risk": { "tier": "BLOCKED", "facts": [], "policyVersion": "...", "decidedAt": "..." }
        }
      }
    }
  ui_impact: >
    Remove the temporary REJECTED job from the UI. Render the returned risk object in the composer and allow support/debug lookup by correlationId.

- id: Q7
  decision: accept_with_changes
  needs_both: true
  answer: >
    Keep the proposed object. Policy emits stable fact codes and machine details only; user-facing labels come from a contracts-owned copy table so wording can change without modifying policy evaluation.
  shape: |
    interface RiskExplanation {
      tier: "LOW" | "MEDIUM" | "HIGH" | "BLOCKED";
      facts: Array<{
        code: RiskFactCode;
        label: string;
        effect: "lowers" | "raises" | "blocks";
        detail?: string;
      }>;
      policyVersion: string;
      decidedAt: string;
    }

    type RiskFactCode =
      | "SIGNED_DIGEST_PINNED"
      | "UNSIGNED_OR_UNPINNED"
      | "NO_REQUESTER_CODE"
      | "RUNS_REQUESTER_CODE"
      | "NETWORK_OFFLINE"
      | "NETWORK_RESTRICTED"
      | "NETWORK_OPEN_WEB"
      | "CODE_WITH_OPEN_WEB"
      | "SECRETS_OR_DEVICES"
      | "BOUNDED_SCHEMAS"
      | "UNBOUNDED_SCHEMAS"
      | "PRIVILEGED_REQUEST"
      | "HOST_MOUNT_REQUEST"
      | "DOCKER_SOCKET_REQUEST"
      | "RAW_DEVICE_REQUEST"
      | "RESOURCE_ENVELOPE_INCREASED"
      | "ROUTE_DEDICATED_ONLY";
  ui_impact: >
    Keep labels in a copy table keyed by code in packages/contracts; never branch frontend logic on label text.

- id: Q8
  decision: accept_with_changes
  needs_both: false
  answer: >
    Keep the envelope, add UNAUTHORIZED and PAYLOAD_TOO_LARGE, and allow a structured details object. message is always sanitized user-safe text and must never contain secrets, filesystem paths, stack traces, raw upstream errors or tokens.
  shape: |
    interface ApiErrorBody {
      error: {
        code:
          | "VALIDATION_FAILED"
          | "RISK_BLOCKED"
          | "UNAUTHORIZED"
          | "FORBIDDEN"
          | "NOT_FOUND"
          | "CONFLICT"
          | "OFFER_EXPIRED"
          | "RATE_LIMITED"
          | "PAYLOAD_TOO_LARGE"
          | "UNAVAILABLE"
          | "INTERNAL";
        message: string;
        fields?: Record<string, string>;
        details?: Record<string, unknown>;
        correlationId: string;
      };
    }

    // POST /v1/jobs validation field keys:
    // workloadId, inputs, networkMode, limits.cpuCores, limits.memoryBytes,
    // limits.diskBytes, limits.wallClockSeconds, params.<paramName>
  ui_impact: >
    Add handling for UNAUTHORIZED/PAYLOAD_TOO_LARGE and continue mapping validation fields by exact keys.

- id: Q9
  decision: accept_with_changes
  needs_both: false
  answer: >
    Provide the listed fields except raw provider-identifying assignment fields to requesters. All resource units are explicit and stable: bytes, seconds, and decimal CPU cores.
  shape: |
    interface JobView {
      id: string;
      state: JobState;
      requesterLabel: string;
      workload: { id: string; name: string; version: string; digest: string };
      inputs: { count: number; contentTypes: string[]; totalBytes: number };
      params: Record<string, unknown>;
      networkMode: "OFFLINE" | "RESTRICTED";
      limits: {
        cpuCores: number;
        memoryBytes: number;
        diskBytes: number;
        wallClockSeconds: number;
        pids: number;
      };
      attempt: number;
      assignment?: {
        nodeId?: string;
        nodeLabel: string;
        isolation: IsolationLevel;
        leaseUntil: string;
      };
      progress?: { done: number; total: number; unit?: string };
      usage?: { cpuCores: number; memoryBytes: number; diskBytes: number; elapsedSeconds: number };
      artifacts: Artifact[];
      failure?: { code: JobTerminalReasonCode; reason: string };
      stoppedBy?: StoppedBy;
      createdAt: string;
      updatedAt: string;
    }
  ui_impact: >
    Rename workloadName/workloadVersion/workloadDigest into workload.* and keep assignment redaction role-aware server-side.

- id: Q10
  decision: accept_with_changes
  needs_both: false
  answer: >
    Accept the proposed offer shape. The provider may see a requester display alias, never email, IP, account ID or other direct identifier. Offer TTL is 60 seconds.
  shape: |
    interface Offer {
      id: string;
      jobId: string;
      workload: {
        id: string;
        name: string;
        version: string;
        digest: string;
        signatureVerified: boolean;
        publisher: string;
        summary: string;
      };
      inputs: { count: number; contentTypes: string[]; totalBytes: number };
      params: Record<string, unknown>;
      limits: JobView["limits"];
      networkMode: "OFFLINE" | "RESTRICTED";
      risk: RiskExplanation;
      requesterLabel: string;
      policyRule?: string;
      createdAt: string;
      expiresAt: string;
      status: "pending" | "approved" | "auto_approved" | "declined" | "expired";
    }
  ui_impact: >
    Keep the 60-second countdown. Treat requesterLabel as a pseudonymous display value.

- id: Q11
  decision: accept_with_changes
  needs_both: false
  answer: >
    Keep declared vs verified, but add probe status and failure metadata so an empty verified array is not ambiguous. Matching uses verified only.
  shape: |
    type IsolationLevel = "docker-rootless" | "gvisor" | "vm" | "microvm";
    type ProbeStatus = "pending" | "passed" | "failed" | "stale";

    interface IsolationCapability {
      declared: IsolationLevel[];
      verified: IsolationLevel[];
      probeStatus: ProbeStatus;
      probedAt?: string;
      failureCode?: "RUNTIME_UNAVAILABLE" | "PROBE_FAILED" | "PERMISSION_DENIED" | "STALE_RESULT";
    }
  ui_impact: >
    Show verified isolation as active; render pending/failed/stale separately and never promote declared capability visually.

- id: Q12
  decision: accept
  needs_both: false
  answer: >
    NodeStatus is offline | available | busy | paused. After a provider emergency stop, auto-pause the node until the provider explicitly resumes sharing.
  ui_impact: >
    none.

- id: Q13
  decision: accept_with_changes
  needs_both: false
  answer: >
    Accept the policy model with IANA timezone added. Schedule evaluation uses the configured provider timezone, not inferred browser/node local time.
  shape: |
    interface ProviderPolicy {
      allowedWorkloads: string[];
      riskMax: "LOW" | "MEDIUM";
      consentMode: "ask" | "auto";
      schedule:
        | { mode: "always"; timezone: string }
        | { mode: "window"; start: string; end: string; timezone: string };
      networkModes: Array<"OFFLINE" | "RESTRICTED">;
      resourceCaps: { cpuCores: number; memoryBytes: number; diskBytes: number };
    }

    // validation keys:
    // allowedWorkloads, riskMax, consentMode, schedule.mode, schedule.start,
    // schedule.end, schedule.timezone, networkModes,
    // resourceCaps.cpuCores, resourceCaps.memoryBytes, resourceCaps.diskBytes
    // HH:MM must be 24h; start != end; timezone must be valid IANA;
    // caps must be > 0 and <= verified node capability.
  ui_impact: >
    Add timezone selection/display and keep cross-midnight windows valid.

- id: Q14
  decision: accept_with_changes
  needs_both: false
  answer: >
    Keep per-artifact validation metadata and 10-minute signed URLs. A failed validation does not expose a downloadable URL; metadata remains for auditability and the job fails with OUTPUT_VALIDATION_FAILED.
  shape: |
    interface Artifact {
      id: string;
      jobId: string;
      direction: "input" | "output";
      name: string;
      contentType: string;
      sizeBytes: number;
      digest: string;
      url?: string;
      urlExpiresAt?: string;
      validation: Array<{ code: string; label: string; passed: boolean }>;
      status: "validated" | "rejected";
    }
  ui_impact: >
    Rename size to sizeBytes. Never preview or download rejected artifacts; keep the validation result visible.

- id: Q15
  decision: accept_with_changes
  needs_both: false
  answer: >
    Add all five read endpoints with the proposed role scoping. Pagination is required from v0 for jobs and audit using opaque cursors; clients must not parse cursor contents.
  shape: |
    GET /v1/jobs?cursor=&limit=
    GET /v1/workloads
    GET /v1/nodes
    GET /v1/network
    GET /v1/offers/:id
    GET /v1/audit?cursor=&limit=&jobId=&nodeId=&type=&q=

    interface Page<T> {
      items: T[];
      nextCursor: string | null;
    }

    // default limit 50, max 100; cursor is opaque base64url server token.
  ui_impact: >
    Add cursor pagination for jobs/audit; do not infer offset from the cursor.

- id: Q16
  decision: accept_with_changes
  needs_both: false
  answer: >
    Keep the shape. Network status rules are backend-owned operational policy; the UI only renders the returned status/reason.
  shape: |
    interface NetworkHealth {
      status: "healthy" | "degraded" | "no_providers" | "incident";
      reason: string;
      coordinator: "healthy" | "degraded" | "unavailable";
      nodes: { total: number; available: number; busy: number; offline: number; paused: number };
      activeJobs: number;
      queuedJobs: number;
      incident?: { id: string; summary: string; startedAt: string };
      checkedAt: string;
    }
  ui_impact: >
    Remove frontend-derived health rules; treat reason as safe user-facing server copy.

- id: Q17
  decision: accept_with_changes
  needs_both: false
  answer: >
    Keep the query shape, add security/control-plane events, and make export server-side so K13 can enforce authorization, redaction and complete pagination. Keep q as an optional server-side search over safe indexed fields.
  shape: |
    type AuditEventType =
      | "JOB_SUBMITTED"
      | "JOB_STATE_CHANGED"
      | "OFFER_CREATED"
      | "OFFER_APPROVED"
      | "OFFER_AUTO_APPROVED"
      | "OFFER_DECLINED"
      | "OFFER_EXPIRED"
      | "JOB_STOPPED"
      | "LEASE_EXPIRED"
      | "NODE_CONNECTED"
      | "NODE_DISCONNECTED"
      | "NODE_PAUSED"
      | "NODE_RESUMED"
      | "POLICY_UPDATED"
      | "ARTIFACT_VALIDATED"
      | "ARTIFACT_REJECTED"
      | "WORKSPACE_CLEANED"
      | "AUTH_DENIED"
      | "RATE_LIMITED";

    GET /v1/audit?jobId=&nodeId=&type=&q=&cursor=&limit=
    GET /v1/audit/export?jobId=&nodeId=&type=&q=&format=csv|json
  ui_impact: >
    Use server export for authoritative audit downloads; client-side filtering may remain for the currently loaded page only.

- id: Q18
  decision: accept_with_changes
  needs_both: true
  answer: >
    Accept the replayable SSE model and ?after fallback. Finished jobs replay retained history from the requested sequence and then close after a final heartbeat-free end-of-stream.
  shape: |
    type JobEventType = "state" | "progress" | "log";

    interface JobEvent {
      seq: number;
      id: string;
      jobId: string;
      type: JobEventType;
      state?: JobState;
      prevState?: JobState;
      progress?: { done: number; total: number; unit?: string };
      usage?: { cpuCores: number; memoryBytes: number; diskBytes: number; elapsedSeconds: number };
      message?: string;
      reason?: string;
      actor: { role: "requester" | "provider" | "agent" | "admin" | "system"; label: string };
      at: string;
      correlationId: string;
      attempt: number;
    }

    // SSE heartbeat is a comment line (`: heartbeat`) rather than a JobEvent and has no id.
    // Last-Event-ID and ?after=<seq> are both supported; Last-Event-ID wins if both are sent.
  ui_impact: >
    Treat heartbeats as transport liveness, not timeline events.

- id: Q19
  decision: accept_with_changes
  needs_both: false
  answer: >
    Use 10-second SSE heartbeats, 5-second Agent heartbeats, a 30-second lease, and a 10-second expiry grace after lease end. UI stream staleness may be shown after 25 seconds without any SSE bytes; Agent lease timing must not be inferred from the browser stream.
  ui_impact: >
    Update stale threshold/copy; keep reconnect backoff capped at 15 seconds.

- id: Q20
  decision: accept
  needs_both: false
  answer: >
    No event/audit user-visible text may contain secrets, tokens, raw IP addresses, host filesystem paths, provider-visible requester filenames or stack traces. Redaction happens before persistence; the frontend still escapes/render-as-text as defense in depth.
  ui_impact: >
    none beyond continuing plain-text rendering.

- id: Q21
  decision: reject
  needs_both: false
  answer: >
    Do not have the coordinator-hosted browser call a loopback Agent API directly in v0. The Agent owns the kill path locally, while the provider web UI sends authenticated stop/decision intents to the coordinator over HTTPS; the Agent receives them over its existing outbound authenticated channel. Independently, the Agent exposes a localhost-only emergency CLI/local control socket so kill still works when the coordinator is unreachable.
  shape: |
    // web -> coordinator
    POST /v1/jobs/:id/stop
    POST /v1/offers/:id/decision

    // coordinator -> agent: signed command over established outbound Agent channel
    // local emergency path: Agent-owned localhost control socket/CLI, not browser CORS.
  ui_impact: >
    Remove direct browser-to-127.0.0.1 dependency and "Agent unreachable" based on PNA/CORS. Show coordinator/agent connectivity separately from coordinator state.
  adr: "ADR-003: Provider control plane and coordinator-independent local kill path"

- id: Q22
  decision: accept_with_changes
  needs_both: false
  answer: >
    Yes. Emit safe lifecycle events for NETWORK_REVOKED, TERM_SENT, KILL_SENT when escalation is required, PROCESS_EXITED and CLEANUP_VERIFIED. The 5-second acceptance clock starts when the Agent accepts the local/provider stop command and ends at PROCESS_EXITED; cleanup is measured separately.
  shape: |
    type AgentStopEvent =
      | "STOP_ACCEPTED"
      | "NETWORK_REVOKED"
      | "TERM_SENT"
      | "KILL_SENT"
      | "PROCESS_EXITED"
      | "CLEANUP_VERIFIED";
  ui_impact: >
    The timeline may show these steps; "Stopped" should correspond to PROCESS_EXITED, not only coordinator state change.

- id: Q23
  decision: accept_with_changes
  needs_both: false
  answer: >
    The Agent makes the final auto-approval decision because provider policy and verified local capability are local authority. The coordinator may pre-classify eligibility, but the Agent signs the decision. policyRule is generated from a stable policy rule code plus contracts-owned copy.
  shape: |
    interface AutoApprovalDecision {
      ruleCode: string;
      policyRule: string;
      policyVersion: string;
      agentDecisionId: string;
    }
  ui_impact: >
    Keep auto_approved and OFFER_AUTO_APPROVED, but treat the Agent-signed decision as authoritative.

- id: Q24
  decision: accept_with_changes
  needs_both: false
  answer: >
    Confirm server-side redaction for requester views. Requesters may see generic OS family/architecture and verified isolation level because these explain compatibility/security without exposing provider identity; they never receive node ID, hostname, IP, owner identity or precise device metadata.
  shape: |
    assignment: {
      nodeId: undefined,
      nodeLabel: "Community provider · linux/x64",
      isolation: "docker-rootless"
    }
  ui_impact: >
    Remove any requester-side dependency on nodeId and keep the generic provider label.

- id: Q25
  decision: accept_with_changes
  needs_both: false
  answer: >
    Providers never receive requester filenames. The coordinator/Agent stages inputs under generated names such as input-001.png; original filenames remain requester-only metadata and are not sent to the provider execution path.
  ui_impact: >
    Provider Approval Sheet continues to show count, content types and total bytes only.

- id: Q26
  decision: accept_with_changes
  needs_both: false
  answer: >
    Use OAuth for v0 with a server-side session cookie. A user may hold multiple roles, but every request is authorized against account membership and resource ownership; the UI role switch only changes view context, never privileges.
  shape: |
    // cookie
    __Host-pm_session; HttpOnly; Secure; SameSite=Lax; Path=/

    interface Me {
      id: string;
      displayName: string;
      roles: Array<"requester" | "provider" | "admin">;
      activeRole: "requester" | "provider" | "admin";
    }

    GET /v1/me
    PUT /v1/me/active-role { role }
  ui_impact: >
    Replace pm_role with /v1/me-backed role context; never trust a client-set role cookie for authorization.

- id: Q27
  decision: accept_with_changes
  needs_both: false
  answer: >
    Use scoped pre-signed PUT uploads, then submit jobs with opaque input artifact IDs. Client checks are convenience only; server validates declared size/type before issuing upload URLs and performs post-upload size, MIME sniffing, digest, archive-depth/entry limits and active-content checks before scheduling.
  shape: |
    POST /v1/uploads
    { "name": "photo.png", "contentType": "image/png", "sizeBytes": 12345 }

    -> { "artifactId": "art_...", "putUrl": "...", "expiresAt": "..." }

    POST /v1/jobs
    { "workloadId": "...", "inputArtifactIds": ["art_..."] }
  ui_impact: >
    Show client checks as preflight only; final validation status comes from server.

- id: Q28
  decision: accept_with_changes
  needs_both: false
  answer: >
    Keep the proposed image-transform MVP limits and render parameters from the workload JSON Schema. The schema may include presentation metadata under x-ui; validation semantics remain standard JSON Schema and backend-owned.
  shape: |
    {
      "id": "image-transform",
      "version": "1.0.0",
      "inputs": {
        "contentTypes": ["image/png", "image/jpeg", "image/webp"],
        "maxFiles": 12,
        "maxFileBytes": 10485760,
        "maxTotalBytes": 52428800
      },
      "paramsSchema": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "format": { "type": "string", "enum": ["webp", "jpeg", "png"], "default": "webp", "x-ui": { "label": "Format" } },
          "maxWidth": { "type": "integer", "minimum": 256, "maximum": 4096, "multipleOf": 64, "default": 1600, "x-ui": { "label": "Max width", "unit": "px" } },
          "quality": { "type": "integer", "minimum": 40, "maximum": 95, "default": 82, "x-ui": { "label": "Quality" } }
        },
        "required": ["format", "maxWidth", "quality"]
      },
      "limits": { "cpuCores": 1, "memoryBytes": 536870912, "diskBytes": 1073741824, "wallClockSeconds": 300, "pids": 64 },
      "minimumIsolation": "docker-rootless",
      "networkMode": "OFFLINE",
      "idempotent": true,
      "digest": "REQUIRED_REAL_SHA256_BEFORE_REAL_EXECUTION"
    }
  ui_impact: >
    Render form controls from paramsSchema + x-ui metadata; never ship a placeholder digest in real execution mode.

- id: Q29
  decision: accept_with_changes
  needs_both: false
  answer: >
    The overlap is already resolved on current main: keep the pnpm monorepo, Turborepo, CI foundation and add/extend apps/api, apps/agent and packages/contracts there. Node.js 22+ is the repo baseline. The GitHub repo already exists; main protection still needs to be enabled.
  shape: |
    packageManager: pnpm@12.10.1
    node: ">=22"
  ui_impact: >
    Gargi should rebase her frontend branch onto current main before contract imports are switched.

- id: Q30
  decision: accept_with_changes
  needs_both: false
  answer: >
    Keep the frontend mock only as a clearly separated offline demo fallback. Contract tests must run against packages/contracts fixtures, and normal development/integration should target the shared mock/API so the two mocks cannot silently drift.
  ui_impact: >
    Keep rehearsal controls behind an explicit offline-demo mode; do not use the frontend-local mock by default after the shared mock endpoint lands.
