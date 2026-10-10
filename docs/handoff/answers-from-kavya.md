# Answers from Kavya — frontend/backend contract v0

Status: proposed backend decisions for Gargi review. Items marked `needs_both: true` become frozen only after Gargi confirms them. The current backend predates the frontend draft, so implementation must follow this document rather than treating current route shapes as final.

- id: Q1
  decision: accept
  needs_both: true
  answer: >
    Use option (a). A lease-expired idempotent job may return from CLAIMED, STAGING, or RUNNING to QUEUED once; the same job ID is retained and attempt increments from 1 to 2. The event order is LEASE_EXPIRED for attempt 1, JOB_STATE_CHANGED to QUEUED for attempt 2, then the normal offer sequence.
  shape: |
    interface JobAttemptView {
      attempt: 1 | 2;
      maxAttempts: 2;
      retryable: boolean;
    }

    interface LeaseExpiredPayload {
      reasonCode: "LEASE_EXPIRED";
      expiredAttempt: 1 | 2;
      retryScheduled: boolean;
    }
  ui_impact: >
    Keep the attempt-grouped timeline. Show “Retrying on another eligible provider” only when retryScheduled is true.

- id: Q2
  decision: accept
  needs_both: true
  answer: >
    DECLINED and offer EXPIRED remain terminal for the job in v0; there is no silent re-offer. QUEUED has its own five-minute timeout and ends as EXPIRED with reason QUEUE_TIMEOUT.
  ui_impact: >
    Keep the existing terminal copy and distinguish OFFER_EXPIRED from QUEUE_TIMEOUT by reasonCode.

- id: Q3
  decision: accept
  needs_both: true
  answer: >
    Add OFFERED to CANCELLED. The coordinator atomically withdraws the offer; any later provider decision or claim returns 409 CONFLICT.
  ui_impact: >
    Enable Cancel while OFFERED and replace the current disabled explanation.

- id: Q4
  decision: accept_with_changes
  needs_both: false
  answer: >
    Use one closed terminal-reason enum and validate allowed reasons against the terminal state. HEARTBEAT_MISSED is an event reason; LEASE_EXPIRED is the terminal or retry reason.
  shape: |
    type TerminalReasonCode =
      | "RISK_BLOCKED"
      | "ROUTE_DEDICATED_ONLY"
      | "POLICY_DENIED"
      | "INVALID_WORKLOAD"
      | "PROVIDER_DECLINED"
      | "OFFER_EXPIRED"
      | "QUEUE_TIMEOUT"
      | "REQUESTER_CANCEL"
      | "PROVIDER_STOP"
      | "ADMIN_STOP"
      | "SANDBOX_START_FAILED"
      | "EXECUTION_FAILED"
      | "EXECUTION_TIMEOUT"
      | "OUTPUT_VALIDATION_FAILED"
      | "PROVIDER_OFFLINE"
      | "LEASE_EXPIRED"
      | "CLEANUP_FAILED"
      | "INTERNAL_ERROR";

    type TerminalReasonByState = {
      REJECTED: "RISK_BLOCKED" | "ROUTE_DEDICATED_ONLY" | "POLICY_DENIED" | "INVALID_WORKLOAD";
      DECLINED: "PROVIDER_DECLINED";
      EXPIRED: "OFFER_EXPIRED" | "QUEUE_TIMEOUT";
      CANCELLED: "REQUESTER_CANCEL" | "PROVIDER_STOP" | "ADMIN_STOP";
      TIMED_OUT: "EXECUTION_TIMEOUT";
      FAILED:
        | "SANDBOX_START_FAILED"
        | "EXECUTION_FAILED"
        | "OUTPUT_VALIDATION_FAILED"
        | "PROVIDER_OFFLINE"
        | "LEASE_EXPIRED"
        | "CLEANUP_FAILED"
        | "INTERNAL_ERROR";
    };
  ui_impact: >
    Remove HEARTBEAT_MISSED from terminal failure copy; keep it as a timeline event.

- id: Q5
  decision: accept
  needs_both: false
  answer: >
    DRAFT is client-only in v0. POST /v1/jobs creates SUBMITTED and the server event history starts at JOB_SUBMITTED; the UI must not synthesize a server DRAFT event.
  ui_impact: >
    Keep local drafts, but omit DRAFT from the server timeline.

- id: Q6
  decision: accept_with_changes
  needs_both: false
  answer: >
    Return 422 RISK_BLOCKED and create no job. Write a standalone audit event and return its ID and the risk explanation in error.details.
  shape: |
    interface RiskBlockedError {
      error: {
        code: "RISK_BLOCKED";
        message: string;
        correlationId: string;
        details: {
          auditEventId: string;
          risk: RiskExplanation;
        };
      };
    }
  ui_impact: >
    Do not open a rejected-job page after 422; keep the Composer visible and render error.details.risk.

- id: Q7
  decision: accept_with_changes
  needs_both: true
  answer: >
    Accept the object, but make fact code a closed enum. Policy emits codes and evidence only; packages/contracts owns the English copy table and the API hydrates label.
  shape: |
    type RiskFactCode =
      | "SIGNED_DIGEST_PINNED"
      | "UNSIGNED_OR_UNPINNED"
      | "NO_REQUESTER_CODE"
      | "RUNS_REQUESTER_CODE"
      | "CODE_WITH_OPEN_WEB"
      | "NETWORK_OFFLINE"
      | "NETWORK_RESTRICTED"
      | "NETWORK_OPEN_WEB"
      | "SECRETS_OR_DEVICES"
      | "BOUNDED_SCHEMAS"
      | "UNBOUNDED_SCHEMAS"
      | "ROUTE_DEDICATED_ONLY"
      | "PRIVILEGED_EXECUTION"
      | "HOST_FILESYSTEM_ACCESS"
      | "DOCKER_SOCKET_ACCESS"
      | "RAW_DEVICE_ACCESS"
      | "RESOURCE_ENVELOPE_ELEVATED";

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

    declare const RISK_FACT_LABELS: Readonly<Record<RiskFactCode, string>>;
  ui_impact: >
    Import the enum and labels from packages/contracts; never branch on label text.

- id: Q8
  decision: accept_with_changes
  needs_both: false
  answer: >
    Add UNAUTHENTICATED and PAYLOAD_TOO_LARGE. message is safe user copy and must never contain credentials, host paths, stack traces, SQL, upstream bodies, or raw exception text.
  shape: |
    type ApiErrorCode =
      | "VALIDATION_FAILED"
      | "RISK_BLOCKED"
      | "UNAUTHENTICATED"
      | "NOT_FOUND"
      | "FORBIDDEN"
      | "CONFLICT"
      | "OFFER_EXPIRED"
      | "RATE_LIMITED"
      | "PAYLOAD_TOO_LARGE"
      | "UNAVAILABLE"
      | "INTERNAL";

    interface ApiErrorBody {
      error: {
        code: ApiErrorCode;
        message: string;
        fields?: Record<string, string>;
        correlationId: string;
        details?: unknown;
      };
    }

    type JobValidationField =
      | "workloadId"
      | "inputs"
      | `inputs.${number}`
      | "networkMode"
      | "allowedHosts"
      | "limits.cpuCores"
      | "limits.memoryBytes"
      | "limits.diskBytes"
      | "limits.timeoutSeconds"
      | "limits.pidLimit"
      | `params.${string}`;
  ui_impact: >
    Handle 401 and 413 explicitly and use dotted field keys for nested controls.

- id: Q9
  decision: accept_with_changes
  needs_both: false
  answer: >
    Provide every requested field, with redaction applied server-side. Byte values are integer bytes, elapsed values are decimal seconds, and cpuCores may be fractional.
  shape: |
    interface JobView {
      id: string;
      state: JobState;
      requesterLabel: string;
      workload: { id: string; name: string; version: string; digest: `sha256:${string}` };
      inputs: { count: number; contentTypes: string[]; totalBytes: number };
      params: Record<string, string | number | boolean>;
      limits: {
        cpuCores: number;
        memoryBytes: number;
        diskBytes: number;
        timeoutSeconds: number;
        pidLimit: number;
        maxOutputBytes: number;
      };
      networkMode: "OFFLINE" | "RESTRICTED" | "OPEN_WEB";
      risk: RiskExplanation;
      attempt: 1 | 2;
      maxAttempts: 2;
      assignment: null | {
        nodeId: string;
        nodeLabel: string;
        os: string;
        architecture: string;
        isolation: IsolationLevel;
        leaseUntil: string;
      };
      progress: null | { done: number; total: number; unit?: string };
      usage: null | {
        cpuCores: number;
        memoryBytes: number;
        diskBytes: number;
        elapsedSeconds: number;
      };
      artifacts: Artifact[];
      failure: null | { code: TerminalReasonCode; reason: string };
      stoppedBy: null | {
        role: "requester" | "provider" | "admin";
        label: string;
        reasonCode: "REQUESTER_CANCEL" | "PROVIDER_STOP" | "ADMIN_STOP";
      };
      createdAt: string;
      updatedAt: string;
    }
  ui_impact: >
    Nest workload identity under workload and use the stated units.

- id: Q10
  decision: accept_with_changes
  needs_both: false
  answer: >
    Accept the proposal with a 60-second TTL. requesterLabel is a pseudonymous community display label, never an email or legal name; policyRule is resolved from a versioned rule code, not accepted as arbitrary policy-engine prose.
  shape: |
    interface Offer {
      id: string;
      jobId: string;
      workload: {
        id: string;
        name: string;
        version: string;
        digest: `sha256:${string}`;
        signatureVerified: boolean;
        publisher: string;
        summary: string;
      };
      inputs: { count: number; contentTypes: string[]; totalBytes: number };
      params: Record<string, string | number | boolean>;
      limits: JobView["limits"];
      networkMode: "OFFLINE" | "RESTRICTED" | "OPEN_WEB";
      risk: RiskExplanation;
      requesterLabel: string;
      createdAt: string;
      expiresAt: string;
      status: "pending" | "approved" | "auto_approved" | "declined" | "expired";
      policyRule: null | { code: string; label: string; policyVersion: string };
    }
  ui_impact: >
    Store policyRule as an object and keep the existing 60-second countdown.

- id: Q11
  decision: accept_with_changes
  needs_both: false
  answer: >
    Accept declared versus verified, remove generic vm from v0, and add explicit probe status. Matching uses verified only; declared is informational.
  shape: |
    type IsolationLevel = "docker-rootless" | "gvisor" | "microvm";

    interface IsolationCapability {
      declared: IsolationLevel[];
      verified: IsolationLevel[];
      probeStatus: "pending" | "verified" | "failed" | "unsupported";
      probedAt: string | null;
      failureCode?: "RUNTIME_MISSING" | "ROOTLESS_REQUIRED" | "PROBE_FAILED";
    }
  ui_impact: >
    Show pending/failed/unsupported separately; an empty verified list never means “verified with no isolation.”

- id: Q12
  decision: accept
  needs_both: false
  answer: >
    Use offline, available, busy, and paused. A provider emergency stop automatically sets paused and the backend sends no new offers until an explicit resume.
  ui_impact: >
    none

- id: Q13
  decision: accept_with_changes
  needs_both: false
  answer: >
    Add an IANA timezone and output/resource limits. Windows may cross midnight; start and end must differ. riskMax is LOW or MEDIUM, and auto consent is forbidden above riskMax.
  shape: |
    interface ProviderPolicy {
      allowedWorkloads: string[];
      riskMax: "LOW" | "MEDIUM";
      consentMode: "ask" | "auto";
      schedule:
        | { mode: "always"; timezone: string }
        | { mode: "window"; start: `${number}:${number}`; end: `${number}:${number}`; timezone: string };
      networkModes: Array<"OFFLINE" | "RESTRICTED">;
      resourceCaps: {
        cpuCores: number;
        memoryBytes: number;
        diskBytes: number;
        timeoutSeconds: number;
        pidLimit: number;
        maxOutputBytes: number;
      };
    }
  ui_impact: >
    Add timezone and the four missing cap controls. Validation field keys mirror the shape, for example schedule.timezone and resourceCaps.memoryBytes.

- id: Q14
  decision: accept_with_changes
  needs_both: false
  answer: >
    Use 10-minute signed URLs. Validation is per artifact. Failed output remains as non-downloadable metadata with url null for audit, and the job becomes FAILED with OUTPUT_VALIDATION_FAILED.
  shape: |
    interface Artifact {
      id: string;
      jobId: string;
      direction: "input" | "output";
      name: string;
      contentType: string;
      sizeBytes: number;
      digest: `sha256:${string}`;
      url: string | null;
      urlExpiresAt: string | null;
      validation: Array<{
        code: string;
        label: string;
        passed: boolean;
      }>;
    }
  ui_impact: >
    Rename size to sizeBytes and never preview or download an artifact with url null or any failed check.

- id: Q15
  decision: accept_with_changes
  needs_both: false
  answer: >
    Add all five endpoints at the proposed paths with the stated role scoping. GET /v1/jobs and GET /v1/audit use cursor pagination; cursors are opaque base64url strings and clients must not decode them.
  shape: |
    interface Page<T> {
      items: T[];
      nextCursor: string | null;
    }

    // Query: ?limit=1..100&cursor=<opaque-base64url>
  ui_impact: >
    Read items/nextCursor and do not construct cursors client-side.

- id: Q16
  decision: accept_with_changes
  needs_both: false
  answer: >
    Accept the counts and statuses, but add reasonCode and resolve reason from shared copy. Coordinator health policy defines degraded; v0 uses a lease expiry in the previous five minutes.
  shape: |
    interface NetworkHealth {
      status: "healthy" | "degraded" | "no_providers" | "incident";
      reasonCode: "OK" | "RECENT_LEASE_EXPIRY" | "NO_PROVIDERS" | "OPEN_INCIDENT";
      reason: string;
      coordinator: "online" | "degraded";
      nodes: { total: number; available: number; busy: number; offline: number; paused: number };
      activeJobs: number;
      queuedJobs: number;
      incident?: { id: string; title: string; startedAt: string };
      checkedAt: string;
    }
  ui_impact: >
    Branch on reasonCode, not prose.

- id: Q17
  decision: accept_with_changes
  needs_both: false
  answer: >
    Keep the proposed query and add q for server-side search over safe summary, IDs, and reason codes. Export is server-side so authorization, redaction, pagination, and audit-of-export are enforced consistently.
  shape: |
    type AuditEventType =
      | "JOB_SUBMITTED"
      | "JOB_REJECTED"
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
      | "POLICY_UPDATED"
      | "ARTIFACT_VALIDATED"
      | "NETWORK_REVOKED"
      | "TERMINATION_REQUESTED"
      | "PROCESS_KILLED"
      | "WORKSPACE_CLEANED";

    // GET /v1/audit?jobId=&nodeId=&type=&q=&limit=&cursor=
    // POST /v1/audit/exports { format: "csv" | "json", filters: {...} }
  ui_impact: >
    Use q on the server and download exports from the export endpoint rather than exporting only the visible page.

- id: Q18
  decision: accept
  needs_both: true
  answer: >
    Accept the proposed SSE contract and the after fallback. A terminal stream replays the full retained per-job history in sequence, sends the terminal state event, and closes; the UI must not reconnect after observing a terminal state.
  ui_impact: >
    Stop reconnecting after a terminal state; otherwise keep native Last-Event-ID and duplicate suppression.

- id: Q19
  decision: accept_with_changes
  needs_both: false
  answer: >
    SSE heartbeat is 5 seconds and the UI stale threshold is 12 seconds. Agent heartbeat is 5 seconds, execution lease is 30 seconds, and expiry has a 10-second grace after leaseUntil before retry/failure processing.
  ui_impact: >
    Keep current SSE timing; replace demo-only 8-second lease expiry copy with 30-second lease plus 10-second grace.

- id: Q20
  decision: accept
  needs_both: false
  answer: >
    Confirmed: message, reason, summary, and safePayload never contain host paths, provider-visible filenames, IP addresses, tokens, secrets, raw parameters, raw exception text, or upstream response bodies. Server-side allowlisted serializers enforce this; HTML escaping remains normal UI defence, not the redaction boundary.
  ui_impact: >
    Continue rendering as plain text and never render these fields as HTML.

- id: Q21
  decision: accept_with_changes
  needs_both: false
  answer: >
    The Agent serves its own console at http://127.0.0.1:4765, and that same-origin page reads coordinator state through the Agent. Stop, availability, and offer decisions all go local; this avoids coordinator-page CORS and private-network-access dependence.
  shape: |
    // Local Agent API, loopback only
    GET  /v1/local/state
    POST /v1/local/stop
    POST /v1/local/availability
    POST /v1/local/offers/:id/decision

    // Pairing creates an HttpOnly, SameSite=Strict cookie scoped to 127.0.0.1.
    // The Agent rejects non-loopback binds and non-local Host/Origin values.
  ui_impact: >
    Provider Console is loaded from the local Agent origin, not from the coordinator-hosted web app; show Agent unreachable only when the local origin cannot load.
  adr: "ADR-002: Loopback Agent Console and Local Control Path"

- id: Q22
  decision: accept_with_changes
  needs_both: false
  answer: >
    Emit NETWORK_REVOKED, TERMINATION_REQUESTED, PROCESS_KILLED, and WORKSPACE_CLEANED as separate safe audit/timeline events. The five-second acceptance window starts when the Agent durably records the local stop request and ends at PROCESS_KILLED; cleanup is measured separately.
  ui_impact: >
    Show the detailed events when present, while “Stopped by you” is anchored to PROCESS_KILLED.

- id: Q23
  decision: accept_with_changes
  needs_both: false
  answer: >
    The Agent evaluates auto-approval against its locally stored provider policy; the coordinator verifies eligibility and mirrors the signed decision. policyRule comes from a versioned rule code resolved through packages/contracts copy, never from free text.
  ui_impact: >
    Render policyRule.label and retain code/version for audit details.

- id: Q24
  decision: accept
  needs_both: false
  answer: >
    Confirmed: requester redaction is server-side for job, event, audit, and SSE responses. Showing coarse os/architecture and the verified isolation level is acceptable; stable node IDs, addresses, node names, and owner identities are not.
  ui_impact: >
    Treat requester nodeId as absent rather than the literal string “redacted.”

- id: Q25
  decision: accept_with_changes
  needs_both: false
  answer: >
    Providers receive only count, content types, and total size. Before staging, the Agent assigns deterministic neutral names such as input-001.png; original filenames never enter the offer, provider logs, sandbox manifest, or provider-visible audit data.
  ui_impact: >
    none

- id: Q26
  decision: accept_with_changes
  needs_both: false
  answer: >
    Use hackathon OAuth with GitHub as the initial identity provider. A user may hold multiple roles, but every request has one active role selected server-side and authorization is checked independently of UI state.
  shape: |
    interface MeView {
      id: string;
      displayName: string;
      roles: Array<"requester" | "provider" | "admin">;
      activeRole: "requester" | "provider" | "admin";
    }

    // GET /v1/me
    // POST /v1/me/active-role { role }
    // Cookie: pm_session; HttpOnly; Secure; SameSite=Lax; Path=/
  ui_impact: >
    Replace pm_role with GET /v1/me plus the active-role endpoint; the browser never writes authority-bearing role cookies directly.

- id: Q27
  decision: accept_with_changes
  needs_both: false
  answer: >
    Use presigned PUT per file, then submit artifact IDs. Client checks are advisory for fast feedback; the server rechecks declared size/type, sniffs MIME, enforces per-file/total/archive limits, hashes content, and quarantines failures before a job can be scheduled.
  shape: |
    POST /v1/uploads
    { "name": "local-only-name.png", "contentType": "image/png", "sizeBytes": 1234 }

    201
    { "artifactId": "uuid", "putUrl": "signed-url", "expiresAt": "ISO-8601", "requiredHeaders": {} }

    POST /v1/uploads/:artifactId/complete
    POST /v1/jobs
    { "workloadId": "uuid", "inputArtifactIds": ["uuid"], "params": {}, "networkMode": "OFFLINE" }
  ui_impact: >
    Upload, complete, then submit artifact IDs; phrase browser checks as early feedback, not a security guarantee.

- id: Q28
  decision: accept_with_changes
  needs_both: true
  answer: >
    Accept the proposed limits and parameters. The API serves the workload definition and its release-time digest; placeholder digests are invalid. The UI renders controls from JSON Schema annotations but keeps a tested fallback for the demo workload.
  shape: |
    interface WorkloadDefinition {
      id: string;
      name: "image-transform";
      version: "1.0.0";
      imageDigest: `sha256:${string}`;
      input: {
        contentTypes: ["image/png", "image/jpeg", "image/webp"];
        maxFiles: 12;
        maxBytesPerFile: 10485760;
        maxTotalBytes: 52428800;
      };
      paramsSchema: {
        type: "object";
        additionalProperties: false;
        required: ["format", "maxWidth", "quality"];
        properties: {
          format: { type: "string"; enum: ["webp", "jpeg", "png"]; title: "Format"; description: string };
          maxWidth: { type: "integer"; minimum: 256; maximum: 4096; multipleOf: 64; default: 1600; title: "Maximum width"; "x-unit": "px"; description: string };
          quality: { type: "integer"; minimum: 40; maximum: 95; default: 82; title: "Quality"; description: string };
        };
      };
      limits: { cpuCores: 1; memoryBytes: 536870912; diskBytes: 1073741824; timeoutSeconds: 300; pidLimit: 64 };
      minimumIsolation: "docker-rootless";
      idempotent: true;
    }
  ui_impact: >
    Render schema title, description, and x-unit; reject any definition without a valid sha256 digest.

- id: Q29
  decision: accept_with_changes
  needs_both: false
  answer: >
    The question describes an older tree. The GitHub repo, pnpm workspace, Turborepo, CI, apps/api, apps/agent, and packages/contracts already exist. Keep the layout; Node.js 22 or newer and the pinned package-manager version in package.json are authoritative. Kavya created the repo; main protection remains a repository-settings task.
  ui_impact: >
    Rebase frontend work onto the repository foundation and do not recreate the workspace or backend packages.

- id: Q30
  decision: accept_with_changes
  needs_both: false
  answer: >
    Keep the frontend mock only as an explicit offline demo fallback. It must share packages/contracts fixtures, be disabled in production builds, and display a visible “Offline demo data” banner so it cannot be mistaken for real execution.
  ui_impact: >
    Retain rehearsal controls behind an offline-demo flag; default development integration uses the backend mock/real API.
