import { Icon } from "@powermesh/ui";
import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./common.module.css";

export function PageHeader({
  title,
  description,
  actions,
  back,
  meta,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
  meta?: ReactNode;
}) {
  return (
    <header className={styles.pageHeader}>
      {back ? (
        <Link href={back.href} className={styles.back}>
          <Icon name="arrowLeft" size={14} />
          {back.label}
        </Link>
      ) : null}
      <div className={styles.pageHeaderRow}>
        <div className={styles.pageHeaderText}>
          <h1 className={styles.pageTitle}>{title}</h1>
          {description ? <p className={styles.pageDescription}>{description}</p> : null}
          {meta ? <div className={styles.pageMeta}>{meta}</div> : null}
        </div>
        {actions ? <div className={styles.pageActions}>{actions}</div> : null}
      </div>
    </header>
  );
}
