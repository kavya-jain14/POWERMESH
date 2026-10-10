"use client";

import { useState } from "react";
import { Badge, Banner, Button, Digest, Icon, KeyValue, Panel } from "@powermesh/ui";
import type { Artifact, Job } from "@/contracts-draft/types";
import { contentTypeLabel, formatBytes, formatTime } from "@/contracts-draft/format";
import { useNow } from "@/lib/hooks";
import styles from "./Recorder.module.css";

/**
 * G8 — only validated raster outputs preview inline, via <img> from a scoped URL.
 * SVG, HTML and anything else is download-only. Nothing is ever injected as markup.
 */
const PREVIEWABLE = new Set(["image/png", "image/jpeg", "image/webp"]);

function canPreview(a: Artifact): boolean {
  return PREVIEWABLE.has(a.contentType) && a.validation.length > 0 && a.validation.every((c) => c.passed);
}

export function ResultPanel({ job, onRefresh }: { job: Job; onRefresh: () => Promise<void> }) {
  const now = useNow(15_000);
  const artifacts = job.artifacts ?? [];
  const total = artifacts.reduce((n, a) => n + a.size, 0);
  const expired = artifacts.some((a) => Date.parse(a.urlExpiresAt) < now);
  const [refreshing, setRefreshing] = useState(false);

  if (artifacts.length === 0) {
    return (
      <Panel title="Result">
        <p className="pm-muted">The job succeeded but returned no files.</p>
      </Panel>
    );
  }

  return (
    <Panel
      variant="strong"
      title="Validated result"
      description={`${artifacts.length} file${artifacts.length === 1 ? "" : "s"} · ${formatBytes(job.inputs.totalBytes)} in → ${formatBytes(total)} out`}
      actions={<Badge tone="success" icon="shield">All checks passed</Badge>}
    >
      {expired ? (
        <Banner
          tone="warning"
          title="Download links expired"
          className={styles.resultBanner}
          action={
            <Button
              size="sm"
              icon="refresh"
              loading={refreshing}
              onClick={async () => {
                setRefreshing(true);
                await onRefresh();
                setRefreshing(false);
              }}
            >
              Get fresh links
            </Button>
          }
        >
          Links are short-lived on purpose. Fresh ones are issued when you ask.
        </Banner>
      ) : null}
      <ul role="list" className={styles.artifacts}>
        {artifacts.map((a) => (
          <li key={a.id} className={styles.artifact}>
            <div className={styles.artifactPreview}>
              {canPreview(a) && !expired ? (
                <img src={a.url} alt={`Output image ${a.name}`} loading="lazy" decoding="async" referrerPolicy="no-referrer" />
              ) : (
                <div className={styles.noPreview}>
                  <Icon name="file" size={20} />
                  <span>Preview not available for {contentTypeLabel(a.contentType)} files — download only.</span>
                </div>
              )}
            </div>
            <div className={styles.artifactMeta}>
              <p className={styles.artifactName}>{a.name}</p>
              <KeyValue
                columns={2}
                items={[
                  { label: "Type", value: contentTypeLabel(a.contentType) },
                  { label: "Size", value: formatBytes(a.size) },
                  { label: "Digest (SHA-256)", value: <Digest value={a.digest} label={`digest of ${a.name}`} />, key: "digest" },
                  { label: "Link expires", value: formatTime(a.urlExpiresAt) },
                ]}
              />
              <ul role="list" className={styles.checks} aria-label={`Validation checks for ${a.name}`}>
                {a.validation.map((c) => (
                  <li key={c.code} className={c.passed ? styles.checkOk : styles.checkBad}>
                    <Icon name={c.passed ? "check" : "x"} size={12} />
                    <span>
                      <span className="pm-visually-hidden">{c.passed ? "Passed: " : "Failed: "}</span>
                      {c.label}
                    </span>
                  </li>
                ))}
              </ul>
              <a
                className={styles.download}
                href={`${a.url}&download=1`}
                download={a.name}
                aria-disabled={expired || undefined}
                onClick={(e) => expired && e.preventDefault()}
              >
                <Icon name="download" />
                Download {a.name}
              </a>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
