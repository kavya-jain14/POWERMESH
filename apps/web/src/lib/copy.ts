/**
 * User-facing copy for job states — the single source for docs/design/G1 §5.
 * Decision right: Gargi (user-facing language). Change copy here, nowhere else.
 */
import type { IconName, Tone } from "@powermesh/ui";
import type { Job, JobState, NetworkMode, Role } from "@/contracts-draft/types";
import { formatDuration } from "@/contracts-draft/format";

interface StateCopy {
  badge: string;
  tone: Tone;
  icon: IconName;
  requester: string;
  provider: string;
}

export const STATE_COPY: Record<JobState, StateCopy> = {
  DRAFT: { badge: "Draft", tone: "neutral", icon: "file", requester: "Not submitted yet.", provider: "—" },
  SUBMITTED: { badge: "Checking", tone: "info", icon: "clock", requester: "Checking your job against policy…", provider: "—" },
  REJECTED: { badge: "Rejected", tone: "danger", icon: "x", requester: "Rejected before scheduling.", provider: "—" },
  QUEUED: { badge: "Queued", tone: "info", icon: "clock", requester: "Waiting for a compatible provider.", provider: "—" },
  POLICY_CHECKED: {
    badge: "Policy checked",
    tone: "info",
    icon: "shield",
    requester: "Passed the policy check. Waiting to be offered to a compatible provider.",
    provider: "—",
  },
  APPROVED: {
    badge: "Approved",
    tone: "info",
    icon: "check",
    requester: "A provider approved. Waiting for their Agent to claim it.",
    provider: "You approved. Your Agent claims it next.",
  },
  OFFERED: {
    badge: "Offered",
    tone: "info",
    icon: "user",
    requester: "Offered to a provider — waiting for their approval.",
    provider: "New request awaiting your approval.",
  },
  DECLINED: { badge: "Declined", tone: "neutral", icon: "x", requester: "The provider declined this request.", provider: "You declined this request." },
  EXPIRED: { badge: "Expired", tone: "neutral", icon: "clock", requester: "No provider accepted in time.", provider: "This request expired." },
  CLAIMED: { badge: "Claimed", tone: "info", icon: "check", requester: "A provider accepted. Preparing to run.", provider: "You accepted. Preparing the sandbox." },
  STAGING: { badge: "Staging", tone: "info", icon: "upload", requester: "Staging inputs read-only.", provider: "Staging inputs read-only." },
  RUNNING: { badge: "Running", tone: "active", icon: "play", requester: "Running in an isolated sandbox.", provider: "Running · you can stop it any time." },
  VALIDATING: { badge: "Validating", tone: "info", icon: "shield", requester: "Checking output type, size and digest.", provider: "Validating output." },
  SUCCEEDED: { badge: "Succeeded", tone: "success", icon: "check", requester: "Result validated and ready.", provider: "Completed. Workspace cleaned." },
  FAILED: { badge: "Failed", tone: "danger", icon: "alert", requester: "Failed.", provider: "Failed." },
  CANCELLED: { badge: "Stopped", tone: "warning", icon: "stop", requester: "Stopped.", provider: "Stopped." },
  TIMED_OUT: { badge: "Timed out", tone: "warning", icon: "clock", requester: "Stopped — exceeded the time limit.", provider: "Stopped — time limit reached." },
};

export const NETWORK_COPY: Record<NetworkMode, { label: string; short: string; description: string }> = {
  OFFLINE: { label: "Offline", short: "no network", description: "No network access while running. Everything it needs is inside the signed image." },
  RESTRICTED: {
    label: "Restricted",
    short: "approved HTTPS only",
    description: "Only approved HTTPS destinations, through the PowerMesh egress gateway, with limits and an audit log.",
  },
  OPEN_WEB: { label: "Open internet", short: "open internet", description: "General internet access. Not available on personal devices." },
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
  switch (job.state) {
    case "RUNNING":
      return viewer === "provider" ? base : `Running in an isolated sandbox · ${NETWORK_COPY[job.networkMode].short}.`;
    case "REJECTED": {
      const reasons = job.risk.facts.filter((f) => f.effect === "blocks").map((f) => f.label);
      return `Rejected before scheduling. ${reasons.join(" ")}`.trim();
    }
    case "FAILED":
      return `Failed: ${job.failure?.reason ?? "the provider reported an error."}`;
    case "CANCELLED":
      return `Stopped by ${actorLabel(job, viewer)}.`;
    case "TIMED_OUT":
      return viewer === "provider" ? base : `Stopped — exceeded the ${formatDuration(job.limits.wallClockSeconds)} time limit.`;
    default:
      return base;
  }
}

export const ROLE_LABEL: Record<Role, string> = {
  requester: "Requester",
  provider: "Provider",
  admin: "Admin",
};
