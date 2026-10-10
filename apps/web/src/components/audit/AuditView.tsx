"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Banner, Button, EmptyState, Field, Mono, Panel, Select, Skeleton, Table, TextInput, tableStyles } from "@powermesh/ui";
import type { AuditEvent, AuditEventType, Role } from "@/contracts-draft/types";
import { formatDateTime, formatTime } from "@/contracts-draft/format";
import { api } from "@/lib/api";
import { useResource } from "@/lib/hooks";
import { ROLE_LABEL, describeJob } from "@/lib/copy";
import { JobStateBadge, RiskExplanationView } from "@/components/common/JobBits";
import styles from "./Audit.module.css";

const TYPE_LABEL: Record<AuditEventType, string> = {
  JOB_SUBMITTED: "Job submitted",
  JOB_REJECTED: "Rejected by policy",
  JOB_STATE_CHANGED: "State changed",
  OFFER_CREATED: "Offer sent",
  OFFER_APPROVED: "Approved by provider",
  OFFER_AUTO_APPROVED: "Auto-approved by policy",
  OFFER_DECLINED: "Declined by provider",
  OFFER_EXPIRED: "Offer expired",
  JOB_STOPPED: "Job stopped",
  LEASE_EXPIRED: "Lease expired",
  NODE_CONNECTED: "Agent connected",
  NODE_DISCONNECTED: "Agent disconnected",
  POLICY_UPDATED: "Policy updated",
  ARTIFACT_VALIDATED: "Output validated",
  WORKSPACE_CLEANED: "Workspace cleaned",
};

function actorText(a: AuditEvent["actor"]): string {
  const role = a.role === "coordinator" ? "Coordinator" : a.role === "agent" ? "Agent" : ROLE_LABEL[a.role];
  return a.label === role ? role : `${a.label}`;
}

function download(name: string, type: string, body: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function toCsv(rows: AuditEvent[]): string {
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const head = ["at", "actorRole", "actor", "type", "jobId", "nodeId", "summary", "reason", "correlationId"];
  return [head.join(","), ...rows.map((r) => [r.at, r.actor.role, r.actor.label, r.type, r.jobId, r.nodeId, r.summary, r.reason, r.correlationId].map(esc).join(","))].join("\n");
}

export function AuditView({ role, initial }: { role: Role; initial: { jobId?: string; nodeId?: string } }) {
  const router = useRouter();
  const [type, setType] = useState("");
  const [query, setQuery] = useState("");
  const filters = { jobId: initial.jobId, nodeId: initial.nodeId };
  const events = useResource(() => api.audit(filters), { intervalMs: 5000, key: `${initial.jobId}|${initial.nodeId}` });
  const job = useResource(() => (initial.jobId ? api.getJob(initial.jobId) : Promise.resolve(undefined)), { key: initial.jobId });

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (events.data ?? []).filter(
      (e) => (!type || e.type === type) && (!q || [e.summary, e.reason, e.jobId, e.actor.label, e.correlationId].some((v) => v?.toLowerCase().includes(q))),
    );
  }, [events.data, type, query]);

  const types = useMemo(() => [...new Set((events.data ?? []).map((e) => e.type))].sort(), [events.data]);

  return (
    <div className="pm-stack">
      {initial.jobId && job.data ? (
        <Panel
          variant="strong"
          eyebrow="Why this job was allowed or blocked"
          title={
            <>
              <Mono>{job.data.id}</Mono> · {job.data.workloadName}
            </>
          }
          actions={<JobStateBadge state={job.data.state} />}
        >
          <div className={styles.explain}>
            <div>
              <p className={styles.outcome}>{describeJob(job.data, role === "provider" ? "provider" : "requester")}</p>
              <p className="pm-small pm-muted">Submitted {formatDateTime(job.data.createdAt)}.</p>
              <p className="pm-small">
                <Link href={`/jobs/${job.data.id}`}>Open the live view</Link>
              </p>
            </div>
            <RiskExplanationView risk={job.data.risk} heading="Policy decision" />
          </div>
        </Panel>
      ) : null}

      <Panel padded>
        <div className={styles.filters}>
          <Field label="Search">
            <TextInput type="search" placeholder="Summary, reason, job, correlation id" value={query} onChange={(e) => setQuery(e.target.value)} />
          </Field>
          <Field label="Event type">
            <Select value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">All events</option>
              {types.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABEL[t]}
                </option>
              ))}
            </Select>
          </Field>
          <div className={styles.filterActions}>
            {initial.jobId || initial.nodeId ? (
              <Button variant="ghost" icon="x" onClick={() => router.push("/audit")}>
                Clear {initial.jobId ? "job" : "node"} filter
              </Button>
            ) : null}
            <Button
              variant="secondary"
              icon="download"
              disabled={rows.length === 0}
              onClick={() => download(`powermesh-audit-${new Date().toISOString().slice(0, 19)}.csv`, "text/csv", toCsv(rows))}
            >
              CSV
            </Button>
            <Button
              variant="secondary"
              icon="download"
              disabled={rows.length === 0}
              onClick={() => download(`powermesh-audit-${new Date().toISOString().slice(0, 19)}.json`, "application/json", JSON.stringify(rows, null, 2))}
            >
              JSON
            </Button>
          </div>
        </div>
        {initial.jobId || initial.nodeId ? (
          <p className="pm-small pm-muted" style={{ marginTop: "var(--pm-space-3)" }}>
            Showing events for {initial.jobId ? `job ${initial.jobId}` : `node ${initial.nodeId}`}.
          </p>
        ) : null}
      </Panel>

      {events.error ? (
        <Banner tone={events.data ? "warning" : "danger"} title={events.data ? "Showing the last events we loaded" : "We couldn't load the audit log"}>
          {events.error.message}
        </Banner>
      ) : null}

      {events.loading ? (
        <Skeleton height={240} />
      ) : rows.length === 0 ? (
        <EmptyState icon="file" title="No events match these filters">
          {query || type ? "Try a broader search or a different event type." : "Events appear here as jobs are submitted, approved, run and stopped."}
        </EmptyState>
      ) : (
        <Table caption={`Audit events (${rows.length})`}>
          <thead>
            <tr>
              <th scope="col">Time</th>
              <th scope="col">Event</th>
              <th scope="col">Actor</th>
              <th scope="col">Job</th>
              <th scope="col">Details</th>
              <th scope="col">Correlation</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id}>
                <td className="pm-mono pm-small" title={e.at}>
                  {formatTime(e.at)}
                </td>
                <td>{TYPE_LABEL[e.type]}</td>
                <td>{actorText(e.actor)}</td>
                <td>
                  {e.jobId ? (
                    <Link href={`/audit?jobId=${encodeURIComponent(e.jobId)}`} className={tableStyles.rowLink}>
                      <Mono>{e.jobId}</Mono>
                    </Link>
                  ) : (
                    <span className="pm-muted">—</span>
                  )}
                </td>
                <td className={`${styles.details} ${tableStyles.wrap}`}>
                  {e.summary}
                  {e.reason ? <span className="pm-muted"> · {e.reason}</span> : null}
                </td>
                <td>
                  <Mono muted>{e.correlationId}</Mono>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
