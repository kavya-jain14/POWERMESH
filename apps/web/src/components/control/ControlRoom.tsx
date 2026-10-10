"use client";

import Link from "next/link";
import { Badge, Banner, Button, EmptyState, Mono, Panel, Skeleton, StatusDot, Table, tableStyles, type Tone } from "@powermesh/ui";
import { isTerminal, type NetworkHealth, type ProviderNode, type Role } from "@/contracts-draft/types";
import { formatRelative } from "@/contracts-draft/format";
import { api } from "@/lib/api";
import { useNow, useResource } from "@/lib/hooks";
import { describeJob } from "@/lib/copy";
import { JobStateBadge } from "@/components/common/JobBits";
import { MeshView } from "./MeshView";
import styles from "./Control.module.css";

const HEALTH: Record<NetworkHealth["status"], { tone: Tone; label: string }> = {
  healthy: { tone: "success", label: "Healthy" },
  degraded: { tone: "warning", label: "Degraded" },
  no_providers: { tone: "neutral", label: "No providers" },
  incident: { tone: "danger", label: "Incident" },
};

const NODE_TONE: Record<ProviderNode["status"], Tone> = { available: "success", busy: "active", paused: "neutral", offline: "danger" };
const NODE_LABEL: Record<ProviderNode["status"], string> = { available: "Available", busy: "Running a job", paused: "Paused", offline: "Offline" };

export function ControlRoom({ role }: { role: Role }) {
  const now = useNow(5000);
  const health = useResource(() => api.network(), { intervalMs: 3000 });
  const nodes = useResource(() => (role === "requester" ? Promise.resolve([] as ProviderNode[]) : api.listNodes()), { intervalMs: 5000 });
  const jobs = useResource(() => api.listJobs(), { intervalMs: 3000 });

  if (health.loading) {
    return (
      <div className="pm-stack" aria-busy="true">
        <span className="pm-visually-hidden">Loading network health…</span>
        <Skeleton height={96} />
        <Skeleton height={88} />
        <Skeleton height={220} />
      </div>
    );
  }

  const unreachable = health.error && (health.error.code === "UNAVAILABLE" || health.error.code === "NETWORK");
  const h = health.data;
  const active = (jobs.data ?? []).filter((j) => !isTerminal(j.state));

  return (
    <div className="pm-stack">
      {unreachable ? (
        <Banner
          tone="danger"
          title="Can't reach the coordinator"
          action={
            <Button size="sm" icon="refresh" onClick={() => void health.refresh()}>
              Retry
            </Button>
          }
        >
          This is a control-plane problem, not necessarily a provider problem: jobs already running on providers keep running, and providers can still stop them locally.
          {h ? ` Figures below are from ${formatRelative(h.checkedAt, now)}.` : null}
        </Banner>
      ) : health.error ? (
        <Banner tone="danger" title="Couldn't load network health">
          {health.error.message}
        </Banner>
      ) : null}

      {h ? (
        <section className={styles.health} data-status={h.status} aria-labelledby="health-title">
          <div className={styles.healthHead}>
            <h2 id="health-title" className={styles.healthTitle}>
              Network {HEALTH[h.status].label.toLowerCase()}
            </h2>
            <Badge tone={HEALTH[h.status].tone}>{HEALTH[h.status].label}</Badge>
          </div>
          <p className={styles.healthReason}>{h.reason}</p>
          {h.incident ? <p className="pm-small">Incident opened {formatRelative(h.incident.openedAt, now)}. Admins are reviewing audit events.</p> : null}
          <p className="pm-small pm-muted">Checked {formatRelative(h.checkedAt, now)}.</p>
        </section>
      ) : null}

      {h ? (
        <dl className={styles.stats}>
          {[
            { label: "Providers available", value: h.nodes.available },
            { label: "Running jobs", value: h.activeJobs },
            { label: "Waiting jobs", value: h.queuedJobs },
            { label: "Paused", value: h.nodes.paused },
            { label: "Offline", value: h.nodes.offline },
          ].map((s) => (
            <div key={s.label} className={styles.stat}>
              <dt>{s.label}</dt>
              <dd>{s.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      <div className="pm-grid-2">
        <Panel title={role === "requester" ? "Your active jobs" : role === "provider" ? "Jobs on your device" : "Active jobs"}>
          {jobs.loading ? (
            <Skeleton height={80} />
          ) : active.length === 0 ? (
            <EmptyState icon="activity" title="Nothing running right now">
              {role === "requester" ? "Submit a job and it shows up here while it runs." : "Active work appears here as soon as a provider claims it."}
            </EmptyState>
          ) : (
            <Table caption="Active jobs">
              <thead>
                <tr>
                  <th scope="col">Job</th>
                  <th scope="col">Status</th>
                  <th scope="col">What's happening</th>
                </tr>
              </thead>
              <tbody>
                {active.map((j) => (
                  <tr key={j.id}>
                    <td>
                      <Link href={`/jobs/${j.id}`} className={tableStyles.rowLink}>
                        <Mono>{j.id}</Mono>
                      </Link>
                    </td>
                    <td>
                      <JobStateBadge state={j.state} />
                    </td>
                    <td className={`pm-small ${tableStyles.wrap}`}>{describeJob(j, role === "provider" ? "provider" : "requester")}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Panel>

        {role === "requester" ? (
          <Panel title="Providers" description="Which device runs your job is never shown — only that it met the job's requirements.">
            {h ? (
              <p>
                {h.nodes.available} of {h.nodes.total} community providers are accepting work.
              </p>
            ) : null}
          </Panel>
        ) : (
          <Panel title={role === "admin" ? "Provider nodes" : "Your node"} description="Only isolation the Agent has verified counts.">
            {nodes.data ? (
              <div className="pm-stack-sm">
                <MeshView nodes={nodes.data} />
                <Table caption="Provider nodes">
                  <thead>
                    <tr>
                      <th scope="col">Node</th>
                      <th scope="col">Status</th>
                      <th scope="col">Verified isolation</th>
                      <th scope="col">Heartbeat</th>
                    </tr>
                  </thead>
                  <tbody>
                    {nodes.data.map((n) => (
                      <tr key={n.id}>
                        <td>
                          {role === "admin" ? (
                            <Link href={`/audit?nodeId=${encodeURIComponent(n.id)}`} className={tableStyles.rowLink}>
                              {n.label}
                            </Link>
                          ) : (
                            n.label
                          )}
                          <div className="pm-small pm-muted">
                            {n.os}/{n.arch}
                          </div>
                        </td>
                        <td>
                          <StatusDot tone={NODE_TONE[n.status]}>{NODE_LABEL[n.status]}</StatusDot>
                        </td>
                        <td>{n.capability.isolation.verified.length ? n.capability.isolation.verified.join(", ") : <span className="pm-muted">None verified yet</span>}</td>
                        <td className="pm-muted">{formatRelative(n.heartbeatAt, now)}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            ) : nodes.error ? (
              <p className="pm-muted">{nodes.error.message}</p>
            ) : (
              <Skeleton height={120} />
            )}
          </Panel>
        )}
      </div>
    </div>
  );
}
