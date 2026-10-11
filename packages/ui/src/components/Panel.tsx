import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "../cx";
import styles from "./Panel.module.css";

export interface PanelProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  title?: ReactNode;
  /** Small caps label above the title, e.g. "Step 1". */
  eyebrow?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** "strong" = 2px ink border for the one panel that matters most on a screen. */
  variant?: "default" | "strong" | "accent" | "sunken";
  /** Heading level for the title. Defaults to h2. */
  as?: "h2" | "h3";
  padded?: boolean;
  children?: ReactNode;
}

export function Panel({
  title,
  eyebrow,
  description,
  actions,
  variant = "default",
  as: Heading = "h2",
  padded = true,
  className,
  children,
  ...rest
}: PanelProps) {
  const hasHeader = title || actions || eyebrow;
  return (
    <section className={cx(styles.panel, styles[variant], className)} {...rest}>
      {hasHeader ? (
        <header className={styles.header}>
          <div className={styles.headings}>
            {eyebrow ? <p className={styles.eyebrow}>{eyebrow}</p> : null}
            {title ? <Heading className={styles.title}>{title}</Heading> : null}
            {description ? <p className={styles.description}>{description}</p> : null}
          </div>
          {actions ? <div className={styles.actions}>{actions}</div> : null}
        </header>
      ) : null}
      <div className={cx(padded && styles.body)}>{children}</div>
    </section>
  );
}

/** Label/value pairs. Use for job facts, node capability, approval details. */
export function KeyValue({
  items,
  columns = 1,
}: {
  items: Array<{ label: ReactNode; value: ReactNode; key?: string }>;
  columns?: 1 | 2 | 3;
}) {
  return (
    <dl className={cx(styles.kv, styles[`kvCols${columns}`])}>
      {items.map((item, i) => (
        <div className={styles.kvRow} key={item.key ?? i}>
          <dt className={styles.kvLabel}>{item.label}</dt>
          <dd className={styles.kvValue}>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
