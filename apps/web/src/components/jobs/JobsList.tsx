"use client";

import Link from "next/link";
import { useState } from "react";
import { Banner, Button, EmptyState, Icon, Mono, RiskBadge, Skeleton, buttonClassName } from "@powermesh/ui";
import type { Job, Role } from "@/contracts-draft/types";
import { formatInputs, formatRelative } from "@/contracts-draft/format";
import { ApiError, api } from "@/lib/api";
import { useNow, useResource } from "@/lib/hooks";
import { JobStateBadge } from "@/components/common/JobBits";
import styles from "./Jobs.module.css";

/** Coordinator ids are UUIDs; the first block is enough to tell jobs apart on a card. */
function displayJobId(id: string): string {
  return /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id) ? `job ${id.slice(0, 8)}` : id;
}

export function JobsList({ role }: { role: Role }) {
  // The first page polls; older pages are fetched on demand with the opaque cursor (Q15).
  const jobs = useResource(() => api.listJobs(), { intervalMs: 4000 });
  const now = useNow(10_000);
  const [older, setOlder] = useState<Job[]>([]);
  const [cursor, setCursor] = useState<string | null | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string>();
  const nextCursor = cursor === undefined ? jobs.data?.nextCursor : cursor;

  const loadMore = async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    setMoreError(undefined);
    try {
      const page = await api.listJobs({ cursor: nextCursor });
      setOlder((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor);
    } catch (err) {
      setMoreError(err instanceof ApiError ? err.message : "Couldn't load more jobs.");
    } finally {
      setLoadingMore(false);
    }
  };

  if (jobs.loading) {
    return (
      <div className={styles.grid} aria-busy="true">
        <span className="pm-visually-hidden">Loading jobs…</span>
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} height={232} />
        ))}
      </div>
    );
  }

  const stale = jobs.error && jobs.data;
  const firstPage = jobs.data?.items ?? [];
  const firstIds = new Set(firstPage.map((j) => j.id));
  const list = jobs.data ? [...firstPage, ...older.filter((j) => !firstIds.has(j.id))] : undefined;

  return (
    <div className="pm-stack">
      {jobs.error ? (
        <Banner
          tone={stale ? "warning" : "danger"}
          title={stale ? "Showing the last list we loaded" : "We couldn't load jobs"}
          action={
            <Button size="sm" icon="refresh" onClick={() => void jobs.refresh()}>
              Try again
            </Button>
          }
        >
          {jobs.error.message}
          {stale && jobs.updatedAt ? ` Last updated ${formatRelative(new Date(jobs.updatedAt).toISOString(), now)}.` : null}
        </Banner>
      ) : null}

      {list && list.length === 0 ? (
        <EmptyState
          icon="image"
          title="No jobs yet"
          action={
            role === "requester" ? (
              <Link href="/jobs/new" className={buttonClassName("primary")}>
                Submit your first job
              </Link>
            ) : undefined
          }
        >
          {role === "requester" ? "Submit a bounded job — like resizing a batch of images — and a community provider runs it in a sandbox." : "Jobs submitted in this community will appear here."}
        </EmptyState>
      ) : null}

      {list && list.length > 0 ? (
        <ul role="list" className={styles.grid} aria-label={role === "admin" ? "All jobs" : "Your jobs"}>
          {list.map((job) => (
            <li key={job.id} className={styles.card}>
              <div className={styles.head}>
                <h2 className={styles.jobId}>
                  <Link href={`/jobs/${job.id}`} className={styles.cardLink} title={job.id}>
                    <Mono>{displayJobId(job.id)}</Mono>
                  </Link>
                </h2>
                <JobStateBadge state={job.state} size="lg" />
              </div>

              <div>
                <p className={styles.workload}>
                  {job.workload.name} <span className={styles.version}>v{job.workload.version}</span>
                </p>
                {job.attempt > 1 ? <p className={styles.attempt}>Attempt {job.attempt}</p> : null}
              </div>

              <dl className={styles.facts}>
                <div>
                  <dt className={styles.factLabel}>Inputs</dt>
                  <dd className={styles.factValue}>
                    {formatInputs(job.inputs)}
                  </dd>
                </div>
                <div>
                  <dt className={styles.factLabel}>Risk</dt>
                  <dd className={styles.factValue}>
                    <RiskBadge tier={job.risk.tier} size="lg" />
                  </dd>
                </div>
                {role === "admin" ? (
                  <div>
                    <dt className={styles.factLabel}>Requester</dt>
                    <dd className={styles.factValue}>{job.requesterLabel}</dd>
                  </div>
                ) : null}
              </dl>

              <div className={styles.foot}>
                <span>
                  Updated <time dateTime={job.updatedAt}>{formatRelative(job.updatedAt, now)}</time>
                </span>
                <span className={styles.open} aria-hidden="true">
                  Open <Icon name="chevronRight" size={16} />
                </span>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {nextCursor ? (
        <div className="pm-stack-sm" style={{ justifyItems: "start" }}>
          <Button variant="secondary" icon="chevronDown" loading={loadingMore} onClick={() => void loadMore()}>
            Load older jobs
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
