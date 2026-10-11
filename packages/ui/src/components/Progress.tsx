import type { ReactNode } from "react";
import { cx } from "../cx";
import styles from "./Progress.module.css";

export interface ProgressBarProps {
  label: ReactNode;
  /** Omit value for an indeterminate bar. */
  value?: number;
  max?: number;
  /** Text equivalent, e.g. "2 of 3 images". */
  valueText?: string;
  tone?: "default" | "success" | "danger" | "muted";
}

export function ProgressBar({
  label,
  value,
  max = 100,
  valueText,
  tone = "default",
}: ProgressBarProps) {
  const pct = value === undefined ? undefined : Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className={styles.wrap}>
      <div className={styles.labelRow}>
        <span className={styles.label}>{label}</span>
        {valueText ? <span className={styles.valueText}>{valueText}</span> : null}
      </div>
      <div
        className={cx(styles.track, styles[tone])}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={valueText}
        aria-label={typeof label === "string" ? label : undefined}
      >
        <div
          className={cx(styles.fill, pct === undefined && styles.indeterminate)}
          style={pct === undefined ? undefined : { width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export interface LimitMeterProps {
  label: ReactNode;
  used: number;
  limit: number;
  /** Formats a number for display, e.g. bytes → "512 MB". */
  format?: (n: number) => string;
}

/** Resource usage against an enforced limit (CPU, RAM, disk, time). */
export function LimitMeter({ label, used, limit, format = String }: LimitMeterProps) {
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  const near = pct >= 85;
  return (
    <div className={styles.wrap}>
      <div className={styles.labelRow}>
        <span className={styles.label}>{label}</span>
        <span className={styles.valueText}>
          {format(used)} <span className={styles.of}>of {format(limit)} limit</span>
        </span>
      </div>
      {/* biome-ignore lint/a11y/useSemanticElements: native <meter> can't be styled consistently across browsers; this div carries the full meter ARIA contract. */}
      <div
        className={cx(styles.track, styles.meter, near && styles.near)}
        role="meter"
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={used}
        aria-valuetext={`${format(used)} of ${format(limit)} limit`}
        aria-label={typeof label === "string" ? label : undefined}
      >
        <div className={styles.fill} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
