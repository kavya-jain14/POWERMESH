import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon";
import { cx } from "../cx";
import styles from "./Badge.module.css";

export type Tone = "neutral" | "info" | "success" | "warning" | "danger" | "active";

export interface BadgeProps {
  tone?: Tone;
  icon?: IconName;
  children: ReactNode;
  className?: string;
  title?: string;
  size?: "md" | "lg";
}

/** Text-first status label. Colour reinforces the text; it never replaces it. */
export function Badge({ tone = "neutral", icon, children, className, title, size = "md" }: BadgeProps) {
  return (
    <span className={cx(styles.badge, styles[tone], size === "lg" && styles.lg, className)} title={title}>
      {icon ? <Icon name={icon} size={size === "lg" ? 14 : 12} /> : null}
      {children}
    </span>
  );
}

export type RiskTier = "LOW" | "MEDIUM" | "HIGH" | "BLOCKED";

const riskIcon: Record<RiskTier, IconName> = {
  LOW: "shield",
  MEDIUM: "alert",
  HIGH: "alert",
  BLOCKED: "x",
};

/** Risk tier badge. Always render the tier's reasons nearby (master plan §6). */
export function RiskBadge({ tier, size = "md" }: { tier: RiskTier; size?: "md" | "lg" }) {
  return (
    <span className={cx(styles.badge, styles.risk, styles[`risk${tier}`], size === "lg" && styles.lg)}>
      <Icon name={riskIcon[tier]} size={size === "lg" ? 14 : 12} />
      <span>
        {tier} <span className={styles.riskSuffix}>risk</span>
      </span>
    </span>
  );
}

/** Coloured dot + text. For connection / health states. */
export function StatusDot({ tone = "neutral", children, pulse = false }: { tone?: Tone; children: ReactNode; pulse?: boolean }) {
  return (
    <span className={cx(styles.statusDot, styles[`dot-${tone}`])}>
      <span className={cx(styles.dot, pulse && styles.pulse)} aria-hidden="true" />
      {children}
    </span>
  );
}
