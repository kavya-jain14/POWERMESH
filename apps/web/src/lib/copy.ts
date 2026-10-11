/**
 * User-facing copy for job states — the single source for docs/design/G1 §5.
 * Decision right: Gargi (user-facing language). Change copy here, nowhere else.
 */
import type { IconName, Tone } from "@powermesh/ui";
import { formatDuration } from "@/contracts-draft/format";
import type { Job, JobState, NetworkMode, Role, TerminalReasonCode } from "@/contracts-draft/types";

interface StateCopy {
  badge: string;
  tone: Tone;
  icon: IconName;
  requester: string;
  provider: string;
}

export const STATE_COPY: Record<JobState, StateCopy> = {
  DRAFT: {
    badge: "Draft",
    tone: "neutral",
    icon: "file",
    requester: "Not submitted yet.",
    provider: "—",
  },
  SUBMITTED: {
    badge: "Checking",
    tone: "info",
    icon: "clock",
    requester: "Checking your job against policy…",
    provider: "—",
  },
  REJECTED: {
    badge: "Rejected",
    tone: "danger",
    icon: "x",
    requester: "Rejected before scheduling.",
    provider: "—",
  },
  POLICY_CHECKED: {
    badge: "Policy checked",
    tone: "info",
    icon: "shield",
    requester: "Passed the policy check. Waiting to be offered to a compatible provider.",
    provider: "—",
  },
  QUEUED: {
    badge: "Queued",
    tone: "info",
    icon: "clock",
    requester: "Waiting for a compatible provider.",
    provider: "—",
  },
  OFFERED: {
    badge: "Offered",
    tone: "info",
    icon: "user",
    requester: "Offered to a provider — waiting for their approval.",
    provider: "New request awaiting your approval.",
  },
  DECLINED: {
    badge: "Declined",
    tone: "neutral",
    icon: "x",
    requester: "The provider declined this request.",
    provider: "You declined this request.",
  },
  APPROVED: {
    badge: "Approved",
    tone: "info",
    icon: "check",
    requester: "A provider approved. Waiting for their Agent to claim it.",
    provider: "You approved. Your Agent claims it next.",
  },
  EXPIRED: {
    badge: "Expired",
    tone: "neutral",
    icon: "clock",
    requester: "It expired before it could run.",
    provider: "This request expired.",
  },
  CLAIMED: {
    badge: "Claimed",
    tone: "info",
    icon: "check",
    requester: "A provider accepted. Preparing to run.",
    provider: "You accepted. Preparing the sandbox.",
  },
  STAGING: {
    badge: "Staging",
    tone: "info",
    icon: "upload",
    requester: "Staging inputs read-only.",
    provider: "Staging inputs read-only.",
  },
  RUNNING: {
    badge: "Running",
    tone: "active",
    icon: "play",
    requester: "Running in an isolated sandbox.",
    provider: "Running · you can stop it any time.",
  },
  VALIDATING: {
    badge: "Validating",
    tone: "info",
    icon: "shield",
    requester: "Checking output type, size and digest.",
    provider: "Validating output.",
  },
  SUCCEEDED: {
    badge: "Succeeded",
    tone: "success",
    icon: "check",
    requester: "Result validated and ready.",
    provider: "Completed. Workspace cleaned.",
  },
  FAILED: {
    badge: "Failed",
    tone: "danger",
    icon: "alert",
    requester: "Failed.",
    provider: "Failed.",
  },
  CANCELLED: {
    badge: "Stopped",
    tone: "warning",
    icon: "stop",
    requester: "Stopped.",
    provider: "Stopped.",
  },
  TIMED_OUT: {
    badge: "Timed out",
    tone: "warning",
    icon: "clock",
    requester: "Stopped — went over its time limit.",
    provider: "Stopped — time limit reached.",
  },
};

/** Q4: terminal and failure copy is driven by reason code (packages/contracts terminal.ts), never by server text. */
export const REASON_COPY: Record<TerminalReasonCode, string> = {
  RISK_BLOCKED: "Blocked by the safety policy before scheduling.",
  ROUTE_DEDICATED_ONLY:
    "HIGH risk work only runs on dedicated verified nodes, never personal devices.",
  POLICY_DENIED: "Not allowed by this community's policy.",
  INVALID_WORKLOAD: "The workload definition isn't valid, so it can't run.",
  PROVIDER_DECLINED: "The provider declined this request.",
  OFFER_EXPIRED: "The provider didn't answer in time.",
  QUEUE_TIMEOUT: "No compatible provider was free within 5 minutes.",
  REQUESTER_CANCEL: "Cancelled by the requester.",
  PROVIDER_STOP: "Stopped by the provider on their device.",
  ADMIN_STOP: "Stopped by a community admin.",
  SANDBOX_START_FAILED: "The sandbox couldn't start on the provider's device.",
  EXECUTION_FAILED: "The workload failed while running.",
  EXECUTION_TIMEOUT: "It went over its time limit and was stopped.",
  OUTPUT_VALIDATION_FAILED:
    "An output file failed validation. It's kept for audit but can't be previewed or downloaded.",
  PROVIDER_OFFLINE: "The provider went offline.",
  LEASE_EXPIRED: "The provider stopped responding, and the one retry was already used.",
  CLEANUP_FAILED: "The provider's Agent couldn't confirm the workspace was cleaned up.",
  INTERNAL_ERROR: "Something went wrong on our side.",
};

export const NETWORK_COPY: Record<
  NetworkMode,
  { label: string; short: string; description: string }
> = {
  OFFLINE: {
    label: "Offline",
    short: "no network",
    description: "No network access while running. Everything it needs is inside the signed image.",
  },
  RESTRICTED: {
    label: "Restricted",
    short: "approved HTTPS only",
    description:
      "Only approved HTTPS destinations, through the PowerMesh egress gateway, with limits and an audit log.",
  },
  OPEN_WEB: {
    label: "Open internet",
    short: "open internet",
    description: "General internet access. Not available on personal devices.",
  },
};

function actorLabel(job: Job, viewer: Role): string {
  const by = job.stoppedBy;
  if (!by) return "someone";
  if (by.role === "provider") return viewer === "provider" ? "you" : "the provider";
  if (by.role === "requester") return viewer === "requester" ? "you" : "the requester";
  if (by.role === "admin") return "a community admin";
  return by.label;
}

/** One sentence describing where the job is, for the given viewer. */
export function describeJob(job: Job, viewer: Role): string {
  const c = STATE_COPY[job.state];
  const base = viewer === "provider" ? c.provider : c.requester;
  const reason = job.failure ? REASON_COPY[job.failure.code] : undefined;
  switch (job.state) {
    case "RUNNING":
      return viewer === "provider"
        ? base
        : `Running in an isolated sandbox · ${NETWORK_COPY[job.networkMode].short}.`;
    case "REJECTED":
      return reason ? `Rejected before scheduling. ${reason}` : base;
    case "DECLINED":
    case "EXPIRED":
      return reason ?? base;
    case "TIMED_OUT":
      return viewer === "provider"
        ? base
        : `Stopped — went over the ${formatDuration(job.limits.timeoutSeconds)} time limit.`;
    case "FAILED":
      return `Failed: ${reason ?? "the provider reported an error."}`;
    case "CANCELLED":
      return `Stopped by ${actorLabel(job, viewer)}.`;
    default:
      return base;
  }
}

export const ROLE_LABEL: Record<Role, string> = {
  requester: "Requester",
  provider: "Provider",
  admin: "Admin",
};
