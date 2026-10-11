"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  Banner,
  Button,
  Dialog,
  Digest,
  EmptyState,
  KeyValue,
  LimitMeter,
  Panel,
  ProgressBar,
  Skeleton,
  StatusDot,
  Toggle,
  buttonClassName,
  useAnnouncer,
  type Tone,
} from "@powermesh/ui";
import { SCHEDULING, TRANSITIONS, isTerminal, type Role } from "@/contracts-draft/types";
import { formatBytes, formatDateTime, formatDuration, formatInputs, formatMaybeBytes, formatRelative } from "@/contracts-draft/format";
import { ApiError, api } from "@/lib/api";
import { useJobStream, useNow, type StreamStatus } from "@/lib/hooks";
import { NETWORK_COPY, STATE_COPY, describeJob } from "@/lib/copy";
import { JobStateBadge, RiskExplanationView } from "@/components/common/JobBits";
import { PageHeader } from "@/components/common/PageHeader";
import { Milestones, Timeline } from "./Timeline";
import { ResultPanel } from "./ResultPanel";
import styles from "./Recorder.module.css";

const STREAM_COPY: Record<StreamStatus, { tone: Tone; label: string; pulse?: boolean }> = {
  connecting: { tone: "neutral", label: "Connecting…" },
  live: { tone: "success", label: "Live", pulse: true },
  reconnecting: { tone: "warning", label: "Reconnecting…" },
  stale: { tone: "warning", label: "No updates for 12s+ — may be stale" },
  ended: { tone: "neutral", label: "Final" },
};

export function FlightRecorder({ jobId, role }: { jobId: string; role: Role }) {
  const { job, jobError, events, status, lastMessageAt, reconnectAttempts, refreshJob } = useJobStream(jobId);
  const { announce } = useAnnouncer();
  const now = useNow(1000);
  const [showLogs, setShowLogs] = useState(true);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string>();
  const lastAnnounced = useRef<string>(undefined);

  // Announce state transitions only (not progress ticks or logs).
  useEffect(() => {
    if (!job) return;
    const key = `${job.state}:${job.attempt}`;
    if (lastAnnounced.current && lastAnnounced.current !== key) {
      const terminalBad = ["FAILED", "REJECTED", "TIMED_OUT", "DECLINED", "EXPIRED"].includes(job.state);
      announce(`Job ${job.id}: ${STATE_COPY[job.state].badge}. ${describeJob(job, role)}`, terminalBad ? "assertive" : "polite");
    }
    lastAnnounced.current = key;
  }, [job, role, announce]);

  if (jobError && !job) {
    return jobError.status === 404 ? (
      <EmptyState
        icon="alert"
        title="We couldn't find that job"
        action={
          <Link href="/jobs" className={buttonClassName("secondary")}>
            Back to jobs
          </Link>
        }
      >
        It may not exist, or it may belong to someone else.
      </EmptyState>
    ) : (
      <Banner tone="danger" title="We couldn't load this job" action={<Button size="sm" icon="refresh" onClick={() => void refreshJob()}>Try again</Button>}>
        {jobError.message}
      </Banner>
    );
  }

  if (!job) {
    return (
      <div className="pm-stack" aria-busy="true">
        <span className="pm-visually-hidden">Loading job…</span>
        <Skeleton height={32} width="40%" />
        <Skeleton height={64} />
        <Skeleton height={260} />
      </div>
    );
  }

  const terminal = isTerminal(job.state);
  // Q3: cancel is allowed in every state the contract permits, including while OFFERED.
  const cancellable = (role === "requester" || role === "admin") && TRANSITIONS[job.state].includes("CANCELLED");
  const stream = STREAM_COPY[status];
  const silentFor = lastMessageAt ? Math.round((now - lastMessageAt) / 1000) : 0;
  const tone = STATE_COPY[job.state].tone;

  const doCancel = async () => {
    setCancelling(true);
    setCancelError(undefined);
    try {
      await api.cancelJob(job.id);
      setConfirmCancel(false);
      await refreshJob();
    } catch (err) {
      setCancelError(err instanceof ApiError ? err.message : "Couldn't cancel the job.");
    } finally {
      setCancelling(false);
    }
  };

  return (
    <>
      <PageHeader
        back={{ href: role === "provider" ? "/provider" : "/jobs", label: role === "provider" ? "Provider Console" : role === "admin" ? "All jobs" : "My jobs" }}
        title={
          <>
            {job.workload.name} <span className="pm-muted pm-mono" style={{ fontSize: "0.7em", fontWeight: 500 }}>{job.id}</span>
          </>
        }
        meta={
          <>
            <JobStateBadge state={job.state} />
            <StatusDot tone={stream.tone} pulse={stream.pulse}>
              {stream.label}
            </StatusDot>
            <span className="pm-small pm-muted">Submitted {formatDateTime(job.createdAt)}</span>
          </>
        }
        actions={
          <>
            <Link href={`/audit?jobId=${encodeURIComponent(job.id)}`} className={buttonClassName("secondary")}>
              Audit trail
            </Link>
            {cancellable ? (
              <Button variant="secondary" icon="stop" onClick={() => setConfirmCancel(true)}>
                Cancel job
              </Button>
            ) : null}
          </>
        }
      />

      <div className="pm-stack">
        {status === "stale" || status === "reconnecting" ? (
          <Banner
            tone="warning"
            title={status === "stale" ? `No updates for ${silentFor}s` : "Live updates interrupted"}
            action={
              <Button size="sm" icon="refresh" onClick={() => void refreshJob()}>
                Refresh now
              </Button>
            }
          >
            {status === "reconnecting"
              ? `Reconnecting to the coordinator${reconnectAttempts ? ` (attempt ${reconnectAttempts})` : ""}. The job keeps running on the provider; missed events will replay without duplicates.`
              : "The information below may be out of date. We'll keep trying in the background."}
          </Banner>
        ) : null}

        {job.attempt > 1 && !terminal ? (
          <Banner tone="info" title={`Retrying on another eligible provider — attempt ${job.attempt} of ${job.maxAttempts}`}>
            The previous provider stopped responding for {SCHEDULING.leaseSeconds + SCHEDULING.leaseGraceSeconds} seconds, so its lease expired. This workload
            is safe to repeat, so it went back to the queue once.
          </Banner>
        ) : null}

        {job.state === "QUEUED" ? (
          <p className="pm-small pm-muted">
            Queued jobs wait up to {SCHEDULING.queueTimeoutSeconds / 60} minutes for a compatible provider, then expire. Nothing runs until a provider approves.
          </p>
        ) : null}

        <div className={styles.statusCard} data-tone={tone}>
          <p className={styles.statusSentence}>{describeJob(job, role)}</p>
          {job.state === "RUNNING" && job.progress ? (
            <ProgressBar
              label="Images processed"
              value={job.progress.done}
              max={job.progress.total}
              valueText={`${job.progress.done} of ${job.progress.total}`}
            />
          ) : null}
          {["SUBMITTED", "POLICY_CHECKED", "QUEUED", "OFFERED", "APPROVED", "CLAIMED", "STAGING", "VALIDATING"].includes(job.state) ? <ProgressBar label="Working" valueText={STATE_COPY[job.state].badge} /> : null}
          <Milestones events={events} current={job.state} />
        </div>

        {job.state === "SUCCEEDED" || job.artifacts.length > 0 ? <ResultPanel job={job} onRefresh={refreshJob} /> : null}

        <div className="pm-grid-2">
          <Panel
            title="Timeline"
            description="Every transition is recorded with who made it and why."
            actions={<Toggle checked={showLogs} onChange={setShowLogs} label="Show details" />}
          >
            {events.length === 0 ? (
              <p className="pm-muted" aria-busy="true">
                Waiting for the first event…
              </p>
            ) : (
              <Timeline events={events} showLogs={showLogs} />
            )}
          </Panel>

          <div className="pm-stack">
            <Panel title="Limits" description="Enforced by the sandbox, not just shown here.">
              <div className="pm-stack-sm">
                {job.usage && !terminal ? (
                  <>
                    <LimitMeter label="CPU" used={job.usage.cpuCores} limit={job.limits.cpuCores} format={(n) => `${n.toFixed(2)} core`} />
                    <LimitMeter label="Memory" used={job.usage.memoryBytes} limit={job.limits.memoryBytes} format={formatBytes} />
                    {job.limits.diskBytes != null ? <LimitMeter label="Disk" used={job.usage.diskBytes} limit={job.limits.diskBytes} format={formatBytes} /> : null}
                    <LimitMeter label="Time" used={job.usage.elapsedSeconds} limit={job.limits.timeoutSeconds} format={formatDuration} />
                  </>
                ) : (
                  <KeyValue
                    columns={2}
                    items={[
                      { label: "CPU", value: `${job.limits.cpuCores} core` },
                      { label: "Memory", value: formatBytes(job.limits.memoryBytes) },
                      { label: "Disk", value: formatMaybeBytes(job.limits.diskBytes) },
                      { label: "Time", value: formatDuration(job.limits.timeoutSeconds) },
                    ]}
                  />
                )}
              </div>
            </Panel>

            <Panel title="Job facts">
              <KeyValue
                items={[
                  { label: "Workload", value: `${job.workload.name} v${job.workload.version}` },
                  { label: "Workload digest", value: <Digest value={job.workload.digest} label="workload digest" /> },
                  {
                    label: "Inputs",
                    value: formatInputs(job.inputs),
                  },
                  { label: "Input digest", value: job.inputDigest ? <Digest value={job.inputDigest} label="input digest" /> : "None sent" },
                  { label: "Network", value: `${NETWORK_COPY[job.networkMode].label} — ${NETWORK_COPY[job.networkMode].short}` },
                  {
                    label: "Runs on",
                    value: job.assignment ? `${job.assignment.nodeLabel} · ${job.assignment.isolation}` : "Not assigned yet",
                  },
                  ...(role !== "requester" ? [{ label: "Requested by", value: job.requesterLabel }] : []),
                  { label: "Last update", value: formatRelative(job.updatedAt, now) },
                ]}
              />
            </Panel>

            <Panel title="Why this risk level">
              <RiskExplanationView risk={job.risk} heading="Risk" />
            </Panel>
          </div>
        </div>
      </div>

      <Dialog
        open={confirmCancel}
        onClose={() => !cancelling && setConfirmCancel(false)}
        dismissible={!cancelling}
        title="Cancel this job?"
        description={
          job.state === "OFFERED"
            ? "The open offer is withdrawn, so the provider can't approve it any more. This can't be undone."
            : "If it's running, the sandbox is stopped and its workspace is cleaned up. This can't be undone."
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmCancel(false)} disabled={cancelling}>
              Keep running
            </Button>
            <Button variant="danger" icon="stop" loading={cancelling} onClick={() => void doCancel()}>
              Cancel job
            </Button>
          </>
        }
      >
        {cancelError ? (
          <Banner tone="danger" title="Not cancelled" role="alert">
            {cancelError}
          </Banner>
        ) : (
          <p className="pm-muted">Current state: {STATE_COPY[job.state].badge}.</p>
        )}
      </Dialog>
    </>
  );
}
