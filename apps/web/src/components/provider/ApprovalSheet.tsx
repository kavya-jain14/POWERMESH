"use client";

import { useRef, useState } from "react";
import { Banner, Button, Dialog, Digest, Icon, KeyValue, cx, useAnnouncer } from "@powermesh/ui";
import { paramSpecs, type Offer } from "@/contracts-draft/types";
import { contentTypeLabel, formatBytes, formatDuration, formatMaybeBytes } from "@/contracts-draft/format";
import { getWorkload } from "@/contracts-draft/workloads";
import { ApiError, agent } from "@/lib/api";
import { useNow } from "@/lib/hooks";
import { NETWORK_COPY } from "@/lib/copy";
import { RiskExplanationView } from "@/components/common/JobBits";
import styles from "./Provider.module.css";

function countdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * G6 — explains exactly what can happen before consent: workload + digest, data, limits,
 * network and risk facts. Approve is "once": it never creates a standing permission.
 */
export function ApprovalSheet({ offer, open, onClose, onDecided }: { offer: Offer | undefined; open: boolean; onClose: () => void; onDecided: (o: Offer) => void }) {
  const now = useNow(500);
  const { announce } = useAnnouncer();
  const [busy, setBusy] = useState<"approve" | "decline" | null>(null);
  const [error, setError] = useState<string>();
  const declineRef = useRef<HTMLButtonElement>(null);

  if (!offer) return <Dialog open={open} onClose={onClose} variant="sheet" title="Loading request…" />;

  const remaining = Date.parse(offer.expiresAt) - now;
  const expired = offer.status === "expired" || (offer.status === "pending" && remaining <= 0);
  const pending = offer.status === "pending" && !expired;
  const workload = getWorkload(offer.workload.id);
  const specs = workload ? paramSpecs(workload.paramsSchema) : [];

  const decide = async (decision: "approve" | "decline") => {
    setBusy(decision);
    setError(undefined);
    try {
      // Q21: decisions go to the Agent on this device, which signs them and tells the coordinator.
      const next = await agent.decideOffer(offer.id, decision);
      announce(decision === "approve" ? "Approved once. Preparing the sandbox." : "Request declined.");
      onDecided(next);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't send your decision.");
    } finally {
      setBusy(null);
    }
  };

  const paramLabel = (key: string, value: string | number | boolean) => {
    const spec = specs.find((p) => p.key === key);
    if (!spec) return `${value}`;
    if (spec.type === "enum") return spec.options.find((o) => o.value === value)?.label ?? String(value);
    return `${value}${spec.unit ? ` ${spec.unit}` : ""}`;
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      variant="sheet"
      initialFocusRef={declineRef}
      dismissible={busy === null}
      title={pending ? "Review this request" : expired ? "This request expired" : "Request details"}
      description={
        pending ? (
          <>
            From {offer.requesterLabel}. Decide within <strong className={cx(styles.countdown, remaining < 15_000 && styles.countdownLow)}>{countdown(remaining)}</strong>.
          </>
        ) : undefined
      }
      footer={
        pending ? (
          <>
            <Button ref={declineRef} variant="secondary" icon="x" loading={busy === "decline"} disabled={busy !== null} onClick={() => void decide("decline")}>
              Decline
            </Button>
            <Button variant="primary" icon="check" loading={busy === "approve"} disabled={busy !== null} onClick={() => void decide("approve")}>
              Approve once
            </Button>
          </>
        ) : (
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        )
      }
    >
      <div className={styles.sheet}>
        {error ? (
          <Banner tone="danger" title="Decision not sent" role="alert">
            {error}
          </Banner>
        ) : null}
        {expired ? (
          <Banner tone="neutral" title="Nothing will run">
            The request expired or was withdrawn before a decision, so nothing runs on this device.
          </Banner>
        ) : null}
        {offer.status === "auto_approved" ? (
          <Banner tone="info" title="Approved automatically by your policy">
            {offer.policyRule?.label}
            {offer.policyRule ? <span className="pm-small pm-mono"> ({offer.policyRule.code} · {offer.policyRule.policyVersion})</span> : null}
          </Banner>
        ) : null}
        {offer.status === "approved" ? <Banner tone="success" title="You approved this request once" /> : null}
        {offer.status === "declined" ? (
          <Banner tone="neutral" title="You declined this request">
            Nothing runs on this device, and the requester is told the job was declined.
          </Banner>
        ) : null}

        <section className={styles.sheetSection} aria-labelledby="sheet-what">
          <h3 id="sheet-what" className={styles.sheetHeading}>
            What will run
          </h3>
          <p className={styles.sheetLead}>
            {offer.workload.name} <span className="pm-muted">v{offer.workload.version}</span>
          </p>
          <p className="pm-small pm-muted">{offer.workload.summary}</p>
          <KeyValue
            items={[
              {
                label: "Signature",
                value: offer.workload.signatureVerified ? (
                  <span className={styles.ok}>
                    <Icon name="shield" size={14} /> Verified · published by {offer.workload.publisher}
                  </span>
                ) : (
                  <span className={styles.bad}>
                    <Icon name="alert" size={14} /> Not verified
                  </span>
                ),
              },
              { label: "Image digest", value: <Digest value={offer.workload.digest} label="workload image digest" /> },
            ]}
          />
        </section>

        <section className={styles.sheetSection} aria-labelledby="sheet-data">
          <h3 id="sheet-data" className={styles.sheetHeading}>
            Data it receives
          </h3>
          <KeyValue
            columns={2}
            items={[
              { label: "Inputs", value: `${offer.inputs.count} file${offer.inputs.count === 1 ? "" : "s"}` },
              { label: "Types", value: offer.inputs.contentTypes.map(contentTypeLabel).join(", ") },
              { label: "Total size", value: formatMaybeBytes(offer.inputs.totalBytes) },
              { label: "Mounted as", value: "Read-only /input" },
              ...Object.entries(offer.params).map(([k, v]) => ({
                key: k,
                label: specs.find((p) => p.key === k)?.label ?? k,
                value: paramLabel(k, v),
              })),
            ]}
          />
        </section>

        <section className={styles.sheetSection} aria-labelledby="sheet-limits">
          <h3 id="sheet-limits" className={styles.sheetHeading}>
            Limits on your device
          </h3>
          <KeyValue
            columns={2}
            items={[
              { label: "CPU", value: `${offer.limits.cpuCores} core` },
              { label: "Memory", value: formatBytes(offer.limits.memoryBytes) },
              { label: "Disk", value: formatMaybeBytes(offer.limits.diskBytes) },
              { label: "Time", value: formatDuration(offer.limits.timeoutSeconds) },
              { label: "Processes", value: offer.limits.pidLimit ?? "Not reported" },
              { label: "Network", value: `${NETWORK_COPY[offer.networkMode].label} — ${NETWORK_COPY[offer.networkMode].short}` },
            ]}
          />
        </section>

        <section className={styles.sheetSection} aria-labelledby="sheet-risk">
          <h3 id="sheet-risk" className="pm-visually-hidden">
            Risk
          </h3>
          <RiskExplanationView risk={offer.risk} heading="Risk" />
        </section>

        <section className={cx(styles.sheetSection, styles.never)} aria-labelledby="sheet-never">
          <h3 id="sheet-never" className={styles.sheetHeading}>
            What the requester can never do
          </h3>
          <ul role="list">
            <li>
              <Icon name="x" size={14} /> Open a shell, remote desktop or any inbound connection to this device
            </li>
            <li>
              <Icon name="x" size={14} /> See your files, folders, network address or credentials
            </li>
            <li>
              <Icon name="x" size={14} /> Run anything other than this signed workload
            </li>
          </ul>
          <p className="pm-small">
            <Icon name="stop" size={12} /> You can stop the job at any time from this console. The stop is handled by the Agent on this device, so it works even if the coordinator is unreachable.
          </p>
        </section>
      </div>
    </Dialog>
  );
}
