"use client";

import { Badge, Banner, Button, Digest, Icon, KeyValue, Panel } from "@powermesh/ui";
import { useState } from "react";
import {
  contentTypeLabel,
  formatBytes,
  formatMaybeBytes,
  formatTime,
} from "@/contracts-draft/format";
import { type Artifact, isDownloadable, type Job } from "@/contracts-draft/types";
import { useNow } from "@/lib/hooks";
import styles from "./Recorder.module.css";

/**
 * G8 — only validated raster outputs preview inline, via <img> from a scoped URL.
 * SVG, HTML and anything else is download-only. Nothing is ever injected as markup.
 * Q14 — a rejected artifact has no URL: it's never previewed or downloaded, but its checks stay visible.
 */
const PREVIEWABLE = new Set(["image/png", "image/jpeg", "image/webp"]);

function canPreview(a: Artifact): boolean {
  return isDownloadable(a) && PREVIEWABLE.has(a.contentType);
}

export function ResultPanel({ job, onRefresh }: { job: Job; onRefresh: () => Promise<void> }) {
  const now = useNow(15_000);
  const artifacts = job.artifacts ?? [];
  const validated = artifacts.filter(isDownloadable);
  const rejected = artifacts.length - validated.length;
  const total = validated.reduce((n, a) => n + a.sizeBytes, 0);
  const expired = validated.some((a) => a.urlExpiresAt && Date.parse(a.urlExpiresAt) < now);
  const [refreshing, setRefreshing] = useState(false);

  if (job.resultSummary?.type === "gpu-benchmark") {
    const result = job.resultSummary;
    return (
      <Panel
        variant="strong"
        title="Verified NVIDIA GPU result"
        description="Reported by the provider workload and schema-validated by the PowerMesh Agent."
        actions={
          <Badge tone="success" icon="shield">
            CUDA verified
          </Badge>
        }
      >
        <KeyValue
          columns={3}
          items={[
            { label: "GPU", value: result.gpuName },
            { label: "CUDA runtime", value: result.cudaRuntime },
            { label: "Compute capability", value: result.computeCapability },
            { label: "GPU memory", value: formatBytes(result.memoryMb * 1024 * 1024) },
            { label: "Matrix", value: `${result.matrixSize} × ${result.matrixSize}` },
            { label: "Iterations", value: result.iterations },
            { label: "Kernel time", value: `${result.durationMs.toFixed(3)} ms` },
            {
              label: "Result checksum",
              value: <span className="pm-mono">{result.checksum}</span>,
            },
          ]}
        />
      </Panel>
    );
  }

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
      title={rejected ? "Output validation" : "Validated result"}
      description={
        rejected
          ? `${rejected} file${rejected === 1 ? "" : "s"} failed validation and ${rejected === 1 ? "was" : "were"} quarantined. Kept for audit — never previewed or downloadable.`
          : `${artifacts.length} file${artifacts.length === 1 ? "" : "s"} · ${formatMaybeBytes(job.inputs.totalBytes)} in → ${formatBytes(total)} out`
      }
      actions={
        rejected ? (
          <Badge tone="danger" icon="x">
            Rejected
          </Badge>
        ) : (
          <Badge tone="success" icon="shield">
            All checks passed
          </Badge>
        )
      }
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
                <img
                  src={a.url ?? undefined}
                  alt={`Output image ${a.name}`}
                  loading="lazy"
                  decoding="async"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className={styles.noPreview}>
                  <Icon name={isDownloadable(a) ? "file" : "x"} size={20} />
                  <span>
                    {!isDownloadable(a)
                      ? "Failed validation — not shown and not downloadable."
                      : `Preview not available for ${contentTypeLabel(a.contentType)} files — download only.`}
                  </span>
                </div>
              )}
            </div>
            <div className={styles.artifactMeta}>
              <p className={styles.artifactName}>{a.name}</p>
              <KeyValue
                columns={2}
                items={[
                  { label: "Type", value: contentTypeLabel(a.contentType) },
                  { label: "Size", value: formatBytes(a.sizeBytes) },
                  {
                    label: "Digest (SHA-256)",
                    value: <Digest value={a.digest} label={`digest of ${a.name}`} />,
                    key: "digest",
                  },
                  {
                    label: isDownloadable(a) ? "Link expires" : "Status",
                    value: !isDownloadable(a)
                      ? "Quarantined"
                      : a.urlExpiresAt
                        ? formatTime(a.urlExpiresAt)
                        : "—",
                  },
                ]}
              />
              <ul
                role="list"
                className={styles.checks}
                aria-label={`Validation checks for ${a.name}`}
              >
                {a.validation.map((c) => (
                  <li key={c.code} className={c.passed ? styles.checkOk : styles.checkBad}>
                    <Icon name={c.passed ? "check" : "x"} size={12} />
                    <span>
                      <span className="pm-visually-hidden">
                        {c.passed ? "Passed: " : "Failed: "}
                      </span>
                      {c.label}
                    </span>
                  </li>
                ))}
              </ul>
              {isDownloadable(a) ? (
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
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
