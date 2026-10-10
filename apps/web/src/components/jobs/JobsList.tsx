"use client";

import Link from "next/link";
import { Banner, Button, EmptyState, Mono, RiskBadge, Skeleton, Table, buttonClassName, tableStyles } from "@powermesh/ui";
import type { Role } from "@/contracts-draft/types";
import { formatBytes, formatRelative } from "@/contracts-draft/format";
import { api } from "@/lib/api";
import { useNow, useResource } from "@/lib/hooks";
import { JobStateBadge } from "@/components/common/JobBits";

export function JobsList({ role }: { role: Role }) {
  const jobs = useResource(() => api.listJobs(), { intervalMs: 4000 });
  const now = useNow(10_000);

  if (jobs.loading) {
    return (
      <div className="pm-stack-sm" aria-busy="true">
        <span className="pm-visually-hidden">Loading jobs…</span>
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} height={36} />
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
        <Table caption={role === "admin" ? "All jobs" : "Your jobs"}>
          <thead>
            <tr>
              <th scope="col">Job</th>
              <th scope="col">Status</th>
              <th scope="col">Workload</th>
              <th scope="col">Inputs</th>
              <th scope="col">Risk</th>
              {role === "admin" ? <th scope="col">Requester</th> : null}
              <th scope="col">Updated</th>
            </tr>
          </thead>
          <tbody>
            {jobs.data.map((job) => (
              <tr key={job.id}>
                <td>
                  <Link href={`/jobs/${job.id}`} className={tableStyles.rowLink}>
                    <Mono>{job.id}</Mono>
                  </Link>
                </td>
                <td>
                  <JobStateBadge state={job.state} />
                  {job.attempt > 1 ? <span className="pm-small pm-muted"> · attempt {job.attempt}</span> : null}
                </td>
                <td>
                  {job.workloadName} <span className="pm-muted">v{job.workloadVersion}</span>
                </td>
                <td>
                  {job.inputs.count} · {formatBytes(job.inputs.totalBytes)}
                </td>
                <td>
                  <RiskBadge tier={job.risk.tier} />
                </td>
                {role === "admin" ? <td>{job.requesterLabel}</td> : null}
                <td>
                  <time dateTime={job.updatedAt} className="pm-muted">
                    {formatRelative(job.updatedAt, now)}
                  </time>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : null}
    </div>
  );
}
