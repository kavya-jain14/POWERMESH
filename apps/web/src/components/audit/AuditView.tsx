"use client";

import {
  Banner,
  Button,
  EmptyState,
  Field,
  Mono,
  Panel,
  Select,
  Skeleton,
  Table,
  TextInput,
  tableStyles,
} from "@powermesh/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { JobStateBadge, RiskExplanationView } from "@/components/common/JobBits";
import { formatDateTime, formatTime } from "@/contracts-draft/format";
import type { AuditEvent, AuditEventType, Role } from "@/contracts-draft/types";
import { ApiError, type AuditQuery, api } from "@/lib/api";
import { describeJob, ROLE_LABEL } from "@/lib/copy";
import { useResource } from "@/lib/hooks";
import styles from "./Audit.module.css";

/** Q17: event types from packages/contracts. */
const TYPE_LABEL: Record<AuditEventType, string> = {
  JOB_SUBMITTED: "Job submitted",
  JOB_REJECTED: "Blocked by policy",
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
  ARTIFACT_VALIDATED: "Output checked",
  NETWORK_REVOKED: "Network revoked",
  TERMINATION_REQUESTED: "Exit requested",
  PROCESS_KILLED: "Process stopped",
  WORKSPACE_CLEANED: "Workspace cleaned",
};

async function saveExport(filters: AuditQuery, format: "csv" | "json") {
  const { blob, filename } = await api.exportAudit(filters, format);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function actorText(a: AuditEvent["actor"]): string {
  const role =
    a.role === "system" ? "Coordinator" : a.role === "agent" ? "Agent" : ROLE_LABEL[a.role];
  return a.label === role ? role : `${a.label}`;
}

/** Waits for typing to pause before searching on the server (Q17: q is a server-side search). */
function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

export function AuditView({
  role,
  initial,
}: {
  role: Role;
  initial: { jobId?: string; nodeId?: string };
}) {
  const router = useRouter();
  const [type, setType] = useState("");
  const [query, setQuery] = useState("");
  const q = useDebounced(query.trim(), 300);
  const filters: AuditQuery = {
    jobId: initial.jobId,
    nodeId: initial.nodeId,
    type: type || undefined,
    q: q || undefined,
  };
  const filterKey = JSON.stringify(filters);
  const events = useResource(() => api.audit(filters), { intervalMs: 5000, key: filterKey });
  const job = useResource(
    () => (initial.jobId ? api.getJob(initial.jobId) : Promise.resolve(undefined)),
    { key: initial.jobId },
  );

  // Q15: the first page polls; older pages load on demand with the opaque cursor.
  const [older, setOlder] = useState<AuditEvent[]>([]);
  const [cursor, setCursor] = useState<string | null | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string>();
  // biome-ignore lint/correctness/useExhaustiveDependencies: filterKey is the trigger — older pages reset whenever the filters change.
  useEffect(() => {
    setOlder([]);
    setCursor(undefined);
    setMoreError(undefined);
  }, [filterKey]);
  const nextCursor = cursor === undefined ? events.data?.nextCursor : cursor;
  const firstPage = events.data?.items ?? [];
  const firstIds = new Set(firstPage.map((e) => e.id));
  const rows = [...firstPage, ...older.filter((e) => !firstIds.has(e.id))];

  const [exporting, setExporting] = useState<"csv" | "json" | null>(null);
  const [exportError, setExportError] = useState<string>();
  const doExport = async (format: "csv" | "json") => {
    setExporting(format);
    setExportError(undefined);
    try {
      await saveExport(filters, format);
    } catch (err) {
      setExportError(err instanceof ApiError ? err.message : "Couldn't export the audit log.");
    } finally {
      setExporting(null);
    }
  };

  const loadMore = async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    setMoreError(undefined);
    try {
      const page = await api.audit(filters, { cursor: nextCursor });
      setOlder((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor);
    } catch (err) {
      setMoreError(err instanceof ApiError ? err.message : "Couldn't load more events.");
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div className="pm-stack">
      {initial.jobId && job.data ? (
        <Panel
          variant="strong"
          eyebrow="Why this job was allowed or blocked"
          title={
            <>
              <Mono>{job.data.id}</Mono> · {job.data.workload.name}
            </>
          }
          actions={<JobStateBadge state={job.data.state} />}
        >
          <div className={styles.explain}>
            <div>
              <p className={styles.outcome}>
                {describeJob(job.data, role === "provider" ? "provider" : "requester")}
              </p>
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
            <TextInput
              type="search"
              placeholder="Summary, reason code, job, event or correlation id"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </Field>
          <Field label="Event type">
            <Select value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">All events</option>
              {(Object.keys(TYPE_LABEL) as AuditEventType[]).map((t) => (
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
            {/* Q17: exports are built on the server — complete, authorised and redacted, not just this page. */}
            <Button
              variant="secondary"
              icon="download"
              loading={exporting === "csv"}
              disabled={exporting !== null}
              onClick={() => void doExport("csv")}
            >
              Export CSV
            </Button>
            <Button
              variant="secondary"
              icon="download"
              loading={exporting === "json"}
              disabled={exporting !== null}
              onClick={() => void doExport("json")}
            >
              Export JSON
            </Button>
          </div>
        </div>
        {initial.jobId || initial.nodeId ? (
          <p className="pm-small pm-muted" style={{ marginTop: "var(--pm-space-3)" }}>
            Showing events for {initial.jobId ? `job ${initial.jobId}` : `node ${initial.nodeId}`}.
          </p>
        ) : null}
      </Panel>

      {exportError ? (
        <Banner tone="danger" title="Export failed" role="alert">
          {exportError}
        </Banner>
      ) : null}

      {events.error ? (
        <Banner
          tone={events.data ? "warning" : "danger"}
          title={
            events.data ? "Showing the last events we loaded" : "We couldn't load the audit log"
          }
        >
          {events.error.message}
        </Banner>
      ) : null}

      {events.loading ? (
        <Skeleton height={240} />
      ) : rows.length === 0 ? (
        <EmptyState icon="file" title="No events match these filters">
          {q || type
            ? "Try a broader search or a different event type."
            : "Events appear here as jobs are submitted, approved, run and stopped."}
        </EmptyState>
      ) : (
        <Table caption={`Audit events (${rows.length}${nextCursor ? "+" : ""})`}>
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
                    <Link
                      href={`/audit?jobId=${encodeURIComponent(e.jobId)}`}
                      className={tableStyles.rowLink}
                    >
                      <Mono>{e.jobId}</Mono>
                    </Link>
                  ) : e.type === "JOB_REJECTED" ? (
                    <span
                      className="pm-muted pm-small"
                      title="Blocked before it became a job, so there's no job id. Its reference is the event id."
                    >
                      No job · <Mono muted>{e.id}</Mono>
                    </span>
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

      {nextCursor ? (
        <div className="pm-stack-sm" style={{ justifyItems: "start" }}>
          <Button
            variant="secondary"
            icon="chevronDown"
            loading={loadingMore}
            onClick={() => void loadMore()}
          >
            Load older events
          </Button>
          {moreError ? (
            <p className="pm-small" role="alert">
              {moreError}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
