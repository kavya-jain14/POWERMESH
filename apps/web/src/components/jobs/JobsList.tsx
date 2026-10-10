"use client";

import Link from "next/link";
import { Banner, Button, EmptyState, Icon, Mono, RiskBadge, Skeleton, buttonClassName } from "@powermesh/ui";
import type { Role } from "@/contracts-draft/types";
import { formatBytes, formatRelative } from "@/contracts-draft/format";
import { api } from "@/lib/api";
import { useNow, useResource } from "@/lib/hooks";
import { JobStateBadge } from "@/components/common/JobBits";
import styles from "./Jobs.module.css";

export function JobsList({ role }: { role: Role }) {
  const jobs = useResource(() => api.listJobs(), { intervalMs: 4000 });
  const now = useNow(10_000);

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

      {jobs.data && jobs.data.length === 0 ? (
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

      {jobs.data && jobs.data.length > 0 ? (
        <ul role="list" className={styles.grid} aria-label={role === "admin" ? "All jobs" : "Your jobs"}>
          {jobs.data.map((job) => (
            <li key={job.id} className={styles.card}>
              <div className={styles.head}>
                <h2 className={styles.jobId}>
                  <Link href={`/jobs/${job.id}`} className={styles.cardLink}>
                    <Mono>{job.id}</Mono>
                  </Link>
                </h2>
                <JobStateBadge state={job.state} size="lg" />
              </div>

              <div>
                <p className={styles.workload}>
                  {job.workloadName} <span className={styles.version}>v{job.workloadVersion}</span>
                </p>
                {job.attempt > 1 ? <p className={styles.attempt}>Attempt {job.attempt}</p> : null}
              </div>

              <dl className={styles.facts}>
                <div>
                  <dt className={styles.factLabel}>Inputs</dt>
                  <dd className={styles.factValue}>
                    {job.inputs.count} {job.inputs.count === 1 ? "file" : "files"} · {formatBytes(job.inputs.totalBytes)}
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
    </div>
  );
}
