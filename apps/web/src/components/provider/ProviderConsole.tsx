"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  Badge,
  Banner,
  Button,
  Dialog,
  Icon,
  KeyValue,
  LimitMeter,
  Panel,
  ProgressBar,
  RiskBadge,
  Skeleton,
  StatusDot,
  Toggle,
  buttonClassName,
  cx,
  useAnnouncer,
} from "@powermesh/ui";
import type { AgentLocalState, AgentStopEvent, IsolationCapability, IsolationLevel, Offer } from "@/contracts-draft/types";
import { formatBytes, formatDuration, formatInputs, formatRelative, formatTime } from "@/contracts-draft/format";
import { ApiError, USES_SIMULATOR, agent, api } from "@/lib/api";
import { useNow, useResource } from "@/lib/hooks";
import { NETWORK_COPY, STATE_COPY, describeJob } from "@/lib/copy";
import { JobStateBadge } from "@/components/common/JobBits";
import { PageHeader } from "@/components/common/PageHeader";
import { ApprovalSheet } from "./ApprovalSheet";
import styles from "./Provider.module.css";

const ISOLATION_LABEL: Record<IsolationLevel, string> = {
  "docker-rootless": "Rootless container",
  gvisor: "gVisor sandbox",
  microvm: "MicroVM",
};

/** Q11: an empty verified list never means "verified with no isolation". */
const PROBE_COPY: Record<IsolationCapability["probeStatus"], string> = {
  verified: "Checked by the Agent",
  pending: "The Agent hasn't finished checking isolation yet",
  failed: "The Agent's isolation check failed",
  unsupported: "This device can't provide sandbox isolation",
};

const PROBE_FAILURE_COPY: Record<NonNullable<IsolationCapability["failureCode"]>, string> = {
  RUNTIME_MISSING: "No supported container runtime was found.",
  ROOTLESS_REQUIRED: "The container runtime isn't running rootless.",
  PROBE_FAILED: "The check didn't complete.",
};

const OS_LABEL = { linux: "Linux", windows: "Windows", macos: "macOS" } as const;

/** Q22: the Agent's stop events, in order. "Stopped" is anchored to PROCESS_KILLED; cleanup is separate. */
const STOP_STEPS: Array<{ step: AgentStopEvent; label: string }> = [
  { step: "NETWORK_REVOKED", label: "Network revoked" },
  { step: "TERMINATION_REQUESTED", label: "Sandbox asked to exit" },
  { step: "PROCESS_KILLED", label: "Process gone — stopped" },
  { step: "WORKSPACE_CLEANED", label: "Workspace cleanup verified" },
];

function StopSteps({ stop }: { stop: NonNullable<AgentLocalState["stop"]> }) {
  const done = new Map(stop.steps.map((s) => [s.step, s.at]));
  return (
    <ol className={styles.stopSteps} aria-label="Stop progress">
      <li className={cx(styles.stopStep, styles.stopStepDone)}>
        <Icon name="check" size={14} />
        <span>Stop recorded on this device</span>
        <time dateTime={stop.requestedAt}>{formatTime(stop.requestedAt)}</time>
      </li>
      {STOP_STEPS.map(({ step, label }) => {
        const at = done.get(step);
        return (
          <li key={step} className={cx(styles.stopStep, at && styles.stopStepDone)}>
            <Icon name={at ? "check" : "clock"} size={14} />
            <span>
              {label}
              <span className="pm-visually-hidden">{at ? ": done" : ": waiting"}</span>
            </span>
            {at ? <time dateTime={at}>{formatTime(at)}</time> : null}
          </li>
        );
      })}
    </ol>
  );
}

export function ProviderConsole({ offerId }: { offerId?: string }) {
  const router = useRouter();
  const { announce } = useAnnouncer();
  const now = useNow(1000);
  // Q21 / ADR-002: everything on this page comes from the Agent on this device, not the coordinator.
  const local = useResource(() => agent.state(), { intervalMs: 1000 });
  const [sheetOffer, setSheetOffer] = useState<Offer>();
  const [confirmStop, setConfirmStop] = useState(false);
  const [stopError, setStopError] = useState<string>();
  const [sending, setSending] = useState(false);
  const [toggling, setToggling] = useState(false);
  const stopButton = useRef<HTMLButtonElement>(null);
  const stopNowButton = useRef<HTMLButtonElement>(null);
  const seenOffer = useRef<string>(undefined);
  const lastJobKey = useRef<string>(undefined);

  const s: AgentLocalState | undefined = local.data;
  // "Agent unreachable" only when the local origin itself can't answer (Q21 ui_impact).
  const agentDown = Boolean(local.error && (local.error.code === "NETWORK" || local.error.code === "UNAVAILABLE"));
  const active = s?.activeJob ?? null;
  const stopRun = s?.stop && active && s.stop.jobId === active.id ? s.stop : null;
  const stopping = Boolean(stopRun && !stopRun.steps.some((x) => x.step === "PROCESS_KILLED"));
  const stoppable = Boolean(active && ["CLAIMED", "STAGING", "RUNNING"].includes(active.state));
  const coordinatorReachable = s?.coordinator.reachable ?? false;

  // Deep link /provider/offers/:id opens the sheet: the live pending offer from the Agent, or history from the coordinator.
  useEffect(() => {
    if (!offerId) {
      setSheetOffer(undefined);
      return;
    }
    if (s?.pendingOffer?.id === offerId) {
      setSheetOffer(s.pendingOffer);
      return;
    }
    let cancelled = false;
    api
      .getOffer(offerId)
      .then((o) => !cancelled && setSheetOffer(o))
      .catch(() => !cancelled && router.replace("/provider"));
    return () => {
      cancelled = true;
    };
    // Re-run only when the deep link changes; the next effect keeps a pending offer in sync.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offerId, router]);

  // Keep the open sheet in sync with the live pending offer (expiry, auto-approval).
  useEffect(() => {
    if (offerId && s?.pendingOffer?.id === offerId) setSheetOffer(s.pendingOffer);
  }, [offerId, s?.pendingOffer]);

  // Announce new offers and end-of-job outcomes — not every poll.
  useEffect(() => {
    const offer = s?.pendingOffer;
    if (offer && seenOffer.current !== offer.id) {
      seenOffer.current = offer.id;
      announce(`New request: ${offer.workload.name}, ${offer.risk.tier} risk. Review it before it expires.`);
    }
    const last = s?.lastJob;
    const key = last ? `${last.id}:${last.state}` : undefined;
    if (key && lastJobKey.current && key !== lastJobKey.current && last) announce(`Job ${last.id}: ${STATE_COPY[last.state].badge}.`, "assertive");
    if (key) lastJobKey.current = key;
  }, [s?.pendingOffer, s?.lastJob, announce]);

  // The job may finish while the confirmation is open: close it rather than leave a dead "Stop now".
  useEffect(() => {
    if (confirmStop && !stoppable && !sending) {
      setConfirmStop(false);
      setStopError(undefined);
    }
  }, [confirmStop, stoppable, sending]);

  // Ctrl/⌘ + . opens the stop confirmation while a job is stoppable.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "." && stoppable) {
        e.preventDefault();
        setConfirmStop(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stoppable]);

  const doStop = async () => {
    setStopError(undefined);
    setSending(true);
    try {
      local.setData(await agent.stop());
      setConfirmStop(false);
      announce("Stopping. The Agent is revoking network and stopping the sandbox.", "assertive");
    } catch (err) {
      setStopError(err instanceof ApiError ? err.message : "The Agent didn't respond.");
    } finally {
      setSending(false);
    }
  };

  const setAvailable = async (on: boolean) => {
    setToggling(true);
    try {
      local.setData(await agent.setAvailability(on));
      announce(on ? "Accepting new requests." : "New requests paused.");
    } catch (err) {
      announce(err instanceof ApiError ? err.message : "Couldn't change availability.", "assertive");
    } finally {
      setToggling(false);
    }
  };

  if (local.loading) {
    return (
      <div className="pm-stack" aria-busy="true">
        <span className="pm-visually-hidden">Contacting the Agent on this device…</span>
        <Skeleton height={32} width="35%" />
        <Skeleton height={120} />
        <Skeleton height={220} />
      </div>
    );
  }

  if (!s) {
    return (
      <>
        <PageHeader title="Provider Console" />
        <Banner
          tone="danger"
          title={local.error?.code === "FORBIDDEN" ? "This console is for the device's provider" : "Can't reach the PowerMesh Agent on this device"}
          action={
            <Button size="sm" icon="refresh" onClick={() => void local.refresh()}>
              Try again
            </Button>
          }
        >
          {local.error?.code === "FORBIDDEN"
            ? local.error.message
            : "Nothing can run here while the Agent is stopped. Start the PowerMesh Agent, then try again."}
        </Banner>
      </>
    );
  }

  const node = s.node;
  const statusLabel = agentDown ? "Offline" : stopping ? "Stopping" : active ? "Running" : s.pendingOffer ? "Request pending" : node.status === "paused" ? "Paused" : "Available";
  const lastStop = s.stop && s.lastJob && s.stop.jobId === s.lastJob.id ? s.stop : null;
  const iso = node.capability.isolation;

  return (
    <>
      <PageHeader
        title="Provider Console"
        description={`Served by the PowerMesh Agent on this device${USES_SIMULATOR ? " (simulated in the offline demo)" : ""}. Every request needs your approval, and you can stop anything instantly.`}
        meta={
          <>
            <Badge tone={statusLabel === "Available" ? "success" : statusLabel === "Running" ? "active" : statusLabel === "Offline" ? "danger" : "neutral"}>{statusLabel}</Badge>
            <StatusDot tone={agentDown ? "danger" : "success"}>Agent on this device: {agentDown ? "not responding" : "running"}</StatusDot>
            <StatusDot tone={coordinatorReachable ? "success" : "warning"}>
              Coordinator: {coordinatorReachable ? "reachable" : `unreachable · last contact ${formatRelative(s.coordinator.lastContactAt, now)}`}
            </StatusDot>
          </>
        }
        actions={
          <Link href="/provider/policy" className={buttonClassName("secondary")}>
            <Icon name="shield" />
            Sharing policy
          </Link>
        }
      />

      <div className="pm-stack">
        {/* Kill switch — persistently visible while anything can still run. */}
        {stoppable || stopping ? (
          <div className={styles.killBar} role="region" aria-label="Running job controls">
            <div className={styles.killInfo}>
              <p className={styles.killTitle}>
                {stopping ? "Stopping…" : `Running ${active?.workload.name}`}
                {active?.progress && !stopping ? <span className={styles.killMeta}> · {active.progress.done} of {active.progress.total} images</span> : null}
              </p>
              {stopRun ? (
                <StopSteps stop={stopRun} />
              ) : (
                <p className="pm-small">
                  {`Offline · ${active?.assignment ? ISOLATION_LABEL[active.assignment.isolation] : "sandbox"} · ${active?.usage ? formatDuration(active.usage.elapsedSeconds) : "starting"} elapsed`}
                </p>
              )}
            </div>
            <Button
              ref={stopButton}
              variant="danger"
              size="lg"
              icon="stop"
              loading={stopping}
              disabled={agentDown}
              onClick={() => setConfirmStop(true)}
              aria-keyshortcuts="Control+."
            >
              {stopping ? "Stopping" : "Stop job"}
            </Button>
          </div>
        ) : null}

        {agentDown ? (
          <Banner tone="danger" title="The Agent on this device isn't responding">
            Showing what it last reported. If a job was running, its lease expires and it&apos;s retried elsewhere once — nothing keeps running unattended.
          </Banner>
        ) : !coordinatorReachable ? (
          <Banner tone="warning" title="Coordinator unreachable">
            Your device is fine. Jobs already running continue, and <strong>Stop job still works</strong> — the Agent on this device handles it. New
            requests and your decisions wait until the coordinator is back.
          </Banner>
        ) : null}

        {s.pendingOffer ? (
          <Panel variant="accent" eyebrow="Needs your decision" title={`New request: ${s.pendingOffer.workload.name}`}>
            <div className={styles.offerRow}>
              <div className="pm-row">
                <RiskBadge tier={s.pendingOffer.risk.tier} />
                <span>
                  {formatInputs(s.pendingOffer.inputs, "image")} · {NETWORK_COPY[s.pendingOffer.networkMode].label}
                </span>
                <span className="pm-small">Expires in {Math.max(0, Math.ceil((Date.parse(s.pendingOffer.expiresAt) - now) / 1000))}s</span>
              </div>
              <Link href={`/provider/offers/${s.pendingOffer.id}`} className={buttonClassName("secondary", "lg")}>
                Review request
                <Icon name="chevronRight" />
              </Link>
            </div>
          </Panel>
        ) : null}

        {!stoppable && !stopping && s.lastJob?.state === "CANCELLED" && s.lastJob.stoppedBy?.reasonCode === "PROVIDER_STOP" && node.status === "paused" ? (
          <Banner
            tone="warning"
            title={`Stopped by you at ${formatTime(s.lastJob.updatedAt)}: ${s.lastJob.workload.name}`}
            action={
              <Button size="sm" variant="primary" loading={toggling} disabled={agentDown} onClick={() => void setAvailable(true)}>
                Resume sharing
              </Button>
            }
          >
            <div className="pm-stack-sm">
              <p>The sandbox process is gone and its workspace was cleaned up. New requests are paused until you resume.</p>
              {lastStop ? <StopSteps stop={lastStop} /> : null}
            </div>
          </Banner>
        ) : null}

        <div className="pm-grid-2">
          <div className="pm-stack">
            <Panel title="Availability">
              <Toggle
                checked={node.status === "available" || node.status === "busy"}
                disabled={agentDown || toggling}
                onChange={(on) => void setAvailable(on)}
                label="Accept new requests"
                description={
                  node.status === "busy"
                    ? "Pausing won't stop the current job — it only stops new requests."
                    : node.status === "paused"
                      ? "Paused. No new requests will be offered to this device."
                      : `On. Matching requests are offered to you; ${s.policy.consentMode === "auto" ? "your policy approves them automatically" : "each one waits for your approval"}.`
                }
              />
            </Panel>

            <Panel title="Current job" actions={active ? <Link href={`/jobs/${active.id}`}>Open live view</Link> : undefined}>
              {active ? (
                <div className="pm-stack-sm">
                  <div className="pm-row">
                    <JobStateBadge state={active.state} />
                    <span>{describeJob(active, "provider")}</span>
                  </div>
                  {active.progress ? (
                    <ProgressBar label="Images processed" value={active.progress.done} max={active.progress.total} valueText={`${active.progress.done} of ${active.progress.total}`} />
                  ) : null}
                  {active.usage ? (
                    <>
                      <LimitMeter label="CPU" used={active.usage.cpuCores} limit={active.limits.cpuCores} format={(n) => `${n.toFixed(2)} core`} />
                      <LimitMeter label="Memory" used={active.usage.memoryBytes} limit={active.limits.memoryBytes} format={formatBytes} />
                      <LimitMeter label="Time" used={active.usage.elapsedSeconds} limit={active.limits.timeoutSeconds} format={formatDuration} />
                    </>
                  ) : null}
                </div>
              ) : s.lastJob ? (
                <p className="pm-muted">
                  Nothing running. Last job <Link href={`/jobs/${s.lastJob.id}`}>{s.lastJob.id}</Link>: {STATE_COPY[s.lastJob.state].badge.toLowerCase()} {formatRelative(s.lastJob.updatedAt, now)}.
                </p>
              ) : (
                <p className="pm-muted">Nothing running. Approved requests appear here.</p>
              )}
            </Panel>
          </div>

          <div className="pm-stack">
            <Panel title="This device" description={`${node.label} · Agent v${s.agent.version}`}>
              <div className="pm-stack-sm">
                <KeyValue
                  columns={2}
                  items={[
                    { label: "System", value: `${OS_LABEL[node.os]} · ${node.arch}` },
                    { label: "Trust tier", value: node.trustTier },
                    { label: "Shared CPU", value: `up to ${s.policy.resourceCaps.cpuCores} of ${node.capability.cpuCores} cores` },
                    { label: "Shared memory", value: `up to ${formatBytes(s.policy.resourceCaps.memoryBytes)}` },
                    { label: "Accelerator", value: node.capability.accelerator === "none" ? "None" : node.capability.accelerator },
                    { label: "Last heartbeat", value: formatRelative(node.heartbeatAt, now) },
                  ]}
                />
                <div>
                  <p className={styles.isoHeading}>Isolation</p>
                  <ul role="list" className={styles.isoList}>
                    {iso.declared.map((level) => {
                      // Q11: only a verified probe counts. Declared levels are never shown as active.
                      const verified = iso.probeStatus === "verified" && iso.verified.includes(level);
                      return (
                        <li key={level}>
                          {verified ? <Badge tone="success" icon="check">Verified</Badge> : <Badge tone="warning" icon="alert">Not verified</Badge>}
                          <span>{ISOLATION_LABEL[level]}</span>
                        </li>
                      );
                    })}
                  </ul>
                  <p className="pm-small pm-muted">
                    {PROBE_COPY[iso.probeStatus]}
                    {iso.probedAt ? ` ${formatRelative(iso.probedAt, now)}` : ""}.{iso.failureCode ? ` ${PROBE_FAILURE_COPY[iso.failureCode]}` : ""} Only verified
                    levels are used for matching.
                  </p>
                </div>
              </div>
            </Panel>

            <Panel title="Sharing policy" actions={<Link href="/provider/policy">Edit</Link>}>
              <KeyValue
                items={[
                  { label: "Workloads", value: s.policy.allowedWorkloads.join(", ") || "None" },
                  { label: "Highest risk accepted", value: <RiskBadge tier={s.policy.riskMax} /> },
                  { label: "Approval", value: s.policy.consentMode === "ask" ? "Ask me every time" : "Approve automatically when policy matches" },
                  {
                    label: "When",
                    value: s.policy.schedule.mode === "always" ? `Any time (${s.policy.schedule.timezone})` : `${s.policy.schedule.start}–${s.policy.schedule.end} ${s.policy.schedule.timezone}`,
                  },
                  { label: "Longest run", value: formatDuration(s.policy.resourceCaps.timeoutSeconds) },
                ]}
              />
            </Panel>
          </div>
        </div>
      </div>

      <Dialog
        open={confirmStop}
        onClose={() => !sending && setConfirmStop(false)}
        dismissible={!sending}
        initialFocusRef={stopNowButton}
        title="Stop this job now?"
        description="The Agent on this device revokes the sandbox's network, stops it and cleans up its workspace. The requester is told you stopped it. This can't be undone."
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmStop(false)} disabled={sending}>
              Keep running
            </Button>
            <Button ref={stopNowButton} variant="danger" icon="stop" loading={sending} onClick={() => void doStop()}>
              Stop now
            </Button>
          </>
        }
      >
        {stopError ? (
          <Banner tone="danger" title="Not stopped" role="alert">
            {stopError}
          </Banner>
        ) : (
          <p className="pm-small pm-muted">Handled by the Agent on this device — works even if the coordinator is unreachable. Shortcut: Ctrl + .</p>
        )}
      </Dialog>

      <ApprovalSheet
        open={Boolean(offerId)}
        offer={sheetOffer}
        onClose={() => router.push("/provider")}
        onDecided={(o) => {
          setSheetOffer(o);
          void local.refresh();
          router.push("/provider");
        }}
      />
    </>
  );
}
