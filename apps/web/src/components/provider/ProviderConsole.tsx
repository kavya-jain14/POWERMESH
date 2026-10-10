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
  useAnnouncer,
} from "@powermesh/ui";
import type { AgentLocalState, IsolationLevel, Offer } from "@/contracts-draft/types";
import { formatBytes, formatDuration, formatInputs, formatRelative, formatTime } from "@/contracts-draft/format";
import { ApiError, agent, api } from "@/lib/api";
import { useNow, useResource } from "@/lib/hooks";
import { NETWORK_COPY, STATE_COPY, describeJob } from "@/lib/copy";
import { JobStateBadge } from "@/components/common/JobBits";
import { PageHeader } from "@/components/common/PageHeader";
import { ApprovalSheet } from "./ApprovalSheet";
import styles from "./Provider.module.css";

const ISOLATION_LABEL: Record<IsolationLevel, string> = {
  "docker-rootless": "Rootless container",
  gvisor: "gVisor sandbox",
  vm: "Linux VM boundary",
  microvm: "MicroVM",
};

const OS_LABEL = { linux: "Linux", windows: "Windows", macos: "macOS" } as const;

export function ProviderConsole({ offerId }: { offerId?: string }) {
  const router = useRouter();
  const { announce } = useAnnouncer();
  const now = useNow(1000);
  const local = useResource(() => agent.state(), { intervalMs: 1000 });
  const [sheetOffer, setSheetOffer] = useState<Offer>();
  const [confirmStop, setConfirmStop] = useState(false);
  const [stopError, setStopError] = useState<string>();
  const [toggling, setToggling] = useState(false);
  const stopButton = useRef<HTMLButtonElement>(null);
  const stopNowButton = useRef<HTMLButtonElement>(null);
  const seenOffer = useRef<string>(undefined);
  const lastJobKey = useRef<string>(undefined);

  const s: AgentLocalState | undefined = local.data;
  const agentReachable = !local.error || local.error.code !== "NETWORK";
  const active = s?.activeJob ?? null;
  const stoppable = active && ["CLAIMED", "STAGING", "RUNNING"].includes(active.state);

  // Deep link /provider/offers/:id opens the sheet for that offer (pending or historical).
  useEffect(() => {
    if (!offerId) {
      setSheetOffer(undefined);
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
    if (key && lastJobKey.current && key !== lastJobKey.current && last) announce(`Job ${last.id}: ${STATE_COPY[last.state].badge}.`);
    if (key) lastJobKey.current = key;
  }, [s?.pendingOffer, s?.lastJob, announce]);

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
    try {
      local.setData(await agent.stop());
      setConfirmStop(false);
      announce("Stopping job. Network revoked, sandbox terminating.", "assertive");
    } catch (err) {
      setStopError(err instanceof ApiError ? err.message : "The Agent didn't respond.");
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
  const agentConnected = s.agent.connected && agentReachable;
  const statusLabel = !agentConnected ? "Offline" : s.stopping ? "Stopping" : stoppable || active ? "Running" : s.pendingOffer ? "Request pending" : node.status === "paused" ? "Paused" : "Available";

  return (
    <>
      <PageHeader
        title="Provider Console"
        description="You share one capability from this device. Every request needs your approval, and you can stop anything instantly."
        meta={
          <>
            <Badge tone={statusLabel === "Available" ? "success" : statusLabel === "Running" ? "active" : statusLabel === "Offline" ? "danger" : "neutral"}>{statusLabel}</Badge>
            <StatusDot tone={agentConnected ? "success" : "danger"}>Agent on this device: {agentConnected ? "connected" : "not connected"}</StatusDot>
            <StatusDot tone={s.coordinator.reachable ? "success" : "warning"}>
              Coordinator: {s.coordinator.reachable ? "reachable" : `unreachable · last contact ${formatRelative(s.coordinator.lastContactAt, now)}`}
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
        {stoppable || s.stopping ? (
          <div className={styles.killBar} role="region" aria-label="Running job controls">
            <div className={styles.killInfo}>
              <p className={styles.killTitle}>
                {s.stopping ? "Stopping…" : `Running ${active?.workloadName}`}
                {active?.progress && !s.stopping ? <span className={styles.killMeta}> · {active.progress.done} of {active.progress.total} images</span> : null}
              </p>
              <p className="pm-small">
                {s.stopping
                  ? "Network revoked. Terminating the sandbox and cleaning up."
                  : `Offline · ${active?.assignment ? ISOLATION_LABEL[active.assignment.isolation] : "sandbox"} · ${active?.usage ? formatDuration(active.usage.elapsedSeconds) : "starting"} elapsed`}
              </p>
            </div>
            <Button ref={stopButton} variant="danger" size="lg" icon="stop" loading={s.stopping} onClick={() => setConfirmStop(true)} aria-keyshortcuts="Control+.">
              {s.stopping ? "Stopping" : "Stop job"}
            </Button>
          </div>
        ) : null}

        {!agentConnected ? (
          <Banner tone="danger" title="The Agent on this device isn't connected">
            New requests can't reach you. If a job was running, its lease expires and it's requeued elsewhere once — nothing keeps running unattended.
          </Banner>
        ) : !s.coordinator.reachable ? (
          <Banner tone="warning" title="Coordinator unreachable">
            Your device is fine. Jobs already running continue, and <strong>Stop job still works</strong> — it's handled by the Agent on this device. New requests will arrive once the coordinator is back.
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

        {!stoppable && !s.stopping && s.lastJob?.state === "CANCELLED" && s.lastJob.stoppedBy?.reasonCode === "PROVIDER_STOP" && node.status === "paused" ? (
          <Banner
            tone="warning"
            title={`You stopped ${s.lastJob.workloadName} at ${formatTime(s.lastJob.updatedAt)}`}
            action={
              <Button size="sm" variant="primary" loading={toggling} onClick={() => void setAvailable(true)}>
                Resume sharing
              </Button>
            }
          >
            The sandbox was terminated and its workspace cleaned up. New requests are paused until you resume.
          </Banner>
        ) : null}

        <div className="pm-grid-2">
          <div className="pm-stack">
            <Panel title="Availability">
              <Toggle
                checked={node.status === "available" || node.status === "busy"}
                disabled={!agentConnected || toggling}
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
                      <LimitMeter label="Time" used={active.usage.elapsedSeconds} limit={active.limits.wallClockSeconds} format={formatDuration} />
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
                    { label: "Last heartbeat", value: agentConnected ? formatRelative(node.heartbeatAt, now) : "—" },
                  ]}
                />
                <div>
                  <p className={styles.isoHeading}>Isolation</p>
                  <ul role="list" className={styles.isoList}>
                    {node.capability.isolation.declared.map((level) => {
                      const verified = node.capability.isolation.verified.includes(level);
                      return (
                        <li key={level}>
                          {verified ? <Badge tone="success" icon="check">Verified</Badge> : <Badge tone="warning" icon="alert">Not verified</Badge>}
                          <span>{ISOLATION_LABEL[level]}</span>
                        </li>
                      );
                    })}
                  </ul>
                  <p className="pm-small pm-muted">Checked by the Agent {formatRelative(node.capability.isolation.probedAt, now)}. Only verified levels are used for matching.</p>
                </div>
              </div>
            </Panel>

            <Panel title="Sharing policy" actions={<Link href="/provider/policy">Edit</Link>}>
              <KeyValue
                items={[
                  { label: "Workloads", value: s.policy.allowedWorkloads.join(", ") || "None" },
                  { label: "Highest risk accepted", value: <RiskBadge tier={s.policy.riskMax} /> },
                  { label: "Approval", value: s.policy.consentMode === "ask" ? "Ask me every time" : "Approve automatically when policy matches" },
                  { label: "When", value: s.policy.schedule.mode === "always" ? "Any time" : `${s.policy.schedule.start}–${s.policy.schedule.end}` },
                ]}
              />
            </Panel>
          </div>
        </div>
      </div>

      <Dialog
        open={confirmStop}
        onClose={() => setConfirmStop(false)}
        initialFocusRef={stopNowButton}
        title="Stop this job now?"
        description="The sandbox is terminated and its network revoked immediately. The requester is told you stopped it. This can't be undone."
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmStop(false)}>
              Keep running
            </Button>
            <Button ref={stopNowButton} variant="danger" icon="stop" loading={s.stopping} onClick={() => void doStop()}>
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
