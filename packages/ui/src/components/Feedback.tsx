import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon";
import type { Tone } from "./Badge";
import { cx } from "../cx";
import styles from "./Feedback.module.css";

const toneIcon: Record<Tone, IconName> = {
  neutral: "info",
  info: "info",
  success: "check",
  warning: "alert",
  danger: "alert",
  active: "activity",
};

export interface BannerProps {
  tone?: Tone;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  /** Use "alert" only for urgent, interrupting messages. Defaults to a plain region. */
  role?: "status" | "alert";
  className?: string;
}

/** Inline message block: degraded state, blocked reason, mock-mode notice, etc. */
export function Banner({ tone = "info", title, children, action, role, className }: BannerProps) {
  return (
    <div className={cx(styles.banner, styles[tone], className)} role={role}>
      <Icon name={toneIcon[tone]} size={16} className={styles.bannerIcon} />
      <div className={styles.bannerBody}>
        <p className={styles.bannerTitle}>{title}</p>
        {children ? <div className={styles.bannerText}>{children}</div> : null}
      </div>
      {action ? <div className={styles.bannerAction}>{action}</div> : null}
    </div>
  );
}

export interface EmptyStateProps {
  icon?: IconName;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}

export function EmptyState({ icon = "list", title, children, action }: EmptyStateProps) {
  return (
    <div className={styles.empty}>
      <span className={styles.emptyIcon}>
        <Icon name={icon} size={20} />
      </span>
      <p className={styles.emptyTitle}>{title}</p>
      {children ? <div className={styles.emptyText}>{children}</div> : null}
      {action ? <div className={styles.emptyAction}>{action}</div> : null}
    </div>
  );
}

/** Loading placeholder block. Wrap groups in an element with aria-busy="true" and a visible/hidden label. */
export function Skeleton({ width = "100%", height = 14, className }: { width?: number | string; height?: number | string; className?: string }) {
  return <span className={cx(styles.skeleton, className)} style={{ width, height }} aria-hidden="true" />;
}
