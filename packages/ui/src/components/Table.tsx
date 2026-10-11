import type { ReactNode, TableHTMLAttributes } from "react";
import { cx } from "../cx";
import styles from "./Table.module.css";

export interface TableProps extends TableHTMLAttributes<HTMLTableElement> {
  /** Visible or visually-hidden caption. Every data table needs one for screen readers. */
  caption: ReactNode;
  captionHidden?: boolean;
  density?: "compact" | "comfortable";
  children: ReactNode;
}

/**
 * Compact data table. Wraps in a horizontally scrollable, keyboard-focusable region so the
 * page itself never scrolls sideways on narrow screens.
 */
export function Table({ caption, captionHidden = true, density = "compact", className, children, ...rest }: TableProps) {
  return (
    <div className={styles.scroll} role="region" aria-label={typeof caption === "string" ? caption : undefined} tabIndex={0}>
      <table className={cx(styles.table, styles[density], className)} {...rest}>
        <caption className={captionHidden ? "pm-visually-hidden" : styles.caption}>{caption}</caption>
        {children}
      </table>
    </div>
  );
}

/** Monospace cell content (ids, digests, numbers). */
export function Mono({ children, muted = false }: { children: ReactNode; muted?: boolean }) {
  return <span className={cx(styles.mono, muted && styles.muted)}>{children}</span>;
}

export const tableStyles = styles;
