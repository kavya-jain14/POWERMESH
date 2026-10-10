import { Icon, cx } from "@powermesh/ui";
import type { JobEvent, JobState } from "@/contracts-draft/types";
import { formatTime } from "@/contracts-draft/format";
import { JobStateBadge } from "@/components/common/JobBits";
import styles from "./Recorder.module.css";

const MILESTONES: Array<{ label: string; states: JobState[] }> = [
  { label: "Submitted", states: ["SUBMITTED"] },
  { label: "Queued", states: ["QUEUED", "POLICY_CHECKED"] },
  { label: "Offered", states: ["OFFERED", "APPROVED"] },
  { label: "Claimed", states: ["CLAIMED", "STAGING"] },
  { label: "Running", states: ["RUNNING"] },
  { label: "Validating", states: ["VALIDATING"] },
  { label: "Result", states: ["SUCCEEDED"] },
];

const FAILURE_STATES: JobState[] = ["REJECTED", "DECLINED", "EXPIRED", "FAILED", "CANCELLED", "TIMED_OUT"];

/** Compact milestone strip. Derived only from received state events — never guessed. */
export function Milestones({ events, current }: { events: JobEvent[]; current: JobState | undefined }) {
  const attempt = Math.max(1, ...events.map((e) => e.attempt));
  const reached = new Set(events.filter((e) => e.type === "state" && e.attempt === attempt && e.state).map((e) => e.state!));
  // Pre-requeue milestones stay reached for the current attempt.
  if (attempt > 1) reached.add("SUBMITTED");
  const failedAt = current && FAILURE_STATES.includes(current) ? current : undefined;
  const lastReachedIdx = MILESTONES.reduce((idx, m, i) => (m.states.some((s) => reached.has(s)) ? i : idx), -1);

  return (
    <ol className={styles.milestones} aria-label="Progress through job stages">
      {MILESTONES.map((m, i) => {
        const done = m.states.some((s) => reached.has(s));
        const isCurrent = i === lastReachedIdx && !failedAt && current !== "SUCCEEDED";
        const stoppedHere = failedAt && i === lastReachedIdx;
        const status = stoppedHere ? "stopped here" : isCurrent ? "in progress" : done ? "done" : "not reached";
        return (
          <li
            key={m.label}
            className={cx(styles.milestone, done && styles.milestoneDone, isCurrent && styles.milestoneCurrent, stoppedHere && styles.milestoneStopped)}
            aria-current={isCurrent ? "step" : undefined}
          >
            <span className={styles.milestoneDot} aria-hidden="true">
              {stoppedHere ? <Icon name="x" size={10} /> : done && !isCurrent ? <Icon name="check" size={10} /> : null}
            </span>
            <span className={styles.milestoneLabel}>{m.label}</span>
            <span className="pm-visually-hidden">: {status}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** Append-only event list. Grouped by attempt so a requeue is visible, not hidden. */
export function Timeline({ events, showLogs }: { events: JobEvent[]; showLogs: boolean }) {
  const visible = events.filter((e) => e.type === "state" || showLogs || e.type === "progress");
  const attempts = [...new Set(visible.map((e) => e.attempt))];

  return (
    <div className={styles.timelineWrap}>
      {attempts.map((attempt) => (
        <section key={attempt} aria-label={attempts.length > 1 ? `Attempt ${attempt}` : undefined}>
          {attempts.length > 1 ? <h3 className={styles.attemptHeading}>Attempt {attempt}</h3> : null}
          <ol className={styles.timeline}>
            {visible
              .filter((e) => e.attempt === attempt)
              .map((e) => (
                <li key={e.seq} className={cx(styles.event, styles[`event-${e.type}`])}>
                  <time className={styles.eventTime} dateTime={e.at}>
                    {formatTime(e.at)}
                  </time>
                  <span className={styles.eventMarker} aria-hidden="true" />
                  <div className={styles.eventBody}>
                    {e.type === "state" && e.state ? (
                      <div className={styles.eventHead}>
                        <JobStateBadge state={e.state} />
                        <span className={styles.eventActor}>{e.actor.label}</span>
                      </div>
                    ) : null}
                    {e.message ? <p className={styles.eventMessage}>{e.message}</p> : null}
                    {e.reason && e.type === "state" ? <p className={styles.eventReason}>Reason code: <code>{e.reason}</code></p> : null}
                  </div>
                </li>
              ))}
          </ol>
        </section>
      ))}
    </div>
  );
}
