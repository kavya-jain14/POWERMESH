"use client";

import { useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  Banner,
  Button,
  ChoiceGroup,
  Digest,
  Field,
  Icon,
  KeyValue,
  Panel,
  Select,
  Skeleton,
  TextInput,
  useAnnouncer,
} from "@powermesh/ui";
import type { InputFileMeta, NetworkMode, WorkloadDefinition } from "@/contracts-draft/types";
import { classifyRisk } from "@/contracts-draft/risk";
import { contentTypeLabel, formatBytes, formatDuration } from "@/contracts-draft/format";
import { ApiError, IS_MOCK, api } from "@/lib/api";
import { useResource } from "@/lib/hooks";
import { NETWORK_COPY } from "@/lib/copy";
import { RiskExplanationView } from "@/components/common/JobBits";
import styles from "./Composer.module.css";

const SAMPLE_SET = {
  id: "demo-abstract-v1",
  files: [
    { name: "contour-field.png", src: "/samples/contour-field.png" },
    { name: "node-grid.png", src: "/samples/node-grid.png" },
    { name: "orbit-rings.png", src: "/samples/orbit-rings.png" },
  ],
};

type InputSource = "sample" | "upload";
type Errors = Partial<Record<string, string>>;

export function Composer() {
  const router = useRouter();
  const { announce } = useAnnouncer();
  const workloads = useResource(() => api.listWorkloads());

  const [workloadId, setWorkloadId] = useState<string | null>("image-transform");
  const [source, setSource] = useState<InputSource>("sample");
  const [uploads, setUploads] = useState<InputFileMeta[]>([]);
  const [params, setParams] = useState<Record<string, string>>({});
  const [network, setNetwork] = useState<NetworkMode>("OFFLINE");
  const [serverErrors, setServerErrors] = useState<Errors>({});
  const [submitError, setSubmitError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const summaryRef = useRef<HTMLDivElement>(null);

  const workload: WorkloadDefinition | undefined = workloads.data?.find((w) => w.id === workloadId);

  const paramValue = (key: string): string => {
    const spec = workload?.params.find((p) => p.key === key);
    return params[key] ?? (spec ? String(spec.default) : "");
  };

  const files: InputFileMeta[] = useMemo(
    () => (source === "sample" ? SAMPLE_SET.files.map((f) => ({ name: f.name, contentType: "image/png", bytes: 0 })) : uploads),
    [source, uploads],
  );

  // Client-side checks are a convenience only; the coordinator and Agent re-validate everything.
  const errors: Errors = useMemo(() => {
    const e: Errors = {};
    if (!workload) {
      e.workload = "Choose a workload.";
      return e;
    }
    const schema = workload.inputSchema;
    if (source === "upload") {
      if (uploads.length === 0) e.inputs = "Add at least one image.";
      else if (uploads.length > schema.maxFiles) e.inputs = `Up to ${schema.maxFiles} images per job — remove ${uploads.length - schema.maxFiles}.`;
      else {
        const badType = uploads.find((f) => !schema.accept.includes(f.contentType));
        const tooBig = uploads.find((f) => f.bytes > schema.maxFileBytes);
        const total = uploads.reduce((n, f) => n + f.bytes, 0);
        if (badType) e.inputs = `${badType.name} isn't a PNG, JPEG or WebP image.`;
        else if (tooBig) e.inputs = `${tooBig.name} is ${formatBytes(tooBig.bytes)} — the limit is ${formatBytes(schema.maxFileBytes)} per image.`;
        else if (total > schema.maxTotalBytes) e.inputs = `These images add up to ${formatBytes(total)} — the limit is ${formatBytes(schema.maxTotalBytes)}.`;
      }
    }
    for (const spec of workload.params) {
      if (spec.type !== "int") continue;
      const raw = paramValue(spec.key);
      const n = Number(raw);
      if (raw.trim() === "" || !Number.isInteger(n) || n < spec.min || n > spec.max) {
        e[spec.key] = `Enter a whole number from ${spec.min} to ${spec.max}${spec.unit ? ` ${spec.unit}` : ""}.`;
      }
    }
    if (network === "RESTRICTED" && !workload.allowedNetworkModes.includes("RESTRICTED")) e.network = "This workload only runs offline.";
    return e;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workload, source, uploads, params, network]);

  const risk = useMemo(() => (workload ? classifyRisk(workload, network) : null), [workload, network]);
  const blocked = risk?.tier === "BLOCKED" || risk?.tier === "HIGH";
  const allErrors: Errors = { ...errors, ...serverErrors };
  const errorList = Object.entries(allErrors).filter(([, v]) => v) as Array<[string, string]>;
  const showErrors = attempted || Object.keys(serverErrors).length > 0;

  const onUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const list = Array.from(e.target.files ?? []).map((f) => ({ name: f.name, contentType: f.type || "application/octet-stream", bytes: f.size }));
    setUploads(list);
    setServerErrors({});
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setAttempted(true);
    setSubmitError(undefined);
    if (!workload || Object.keys(errors).length || blocked) {
      summaryRef.current?.focus();
      return;
    }
    setSubmitting(true);
    try {
      const typed: Record<string, string | number> = {};
      for (const spec of workload.params) typed[spec.key] = spec.type === "int" ? Number(paramValue(spec.key)) : paramValue(spec.key);
      const job = await api.submitJob({
        workloadId: workload.id,
        params: typed,
        networkMode: network,
        inputs: source === "upload" ? uploads : [],
        sampleSet: source === "sample" ? SAMPLE_SET.id : undefined,
      });
      announce(`Job ${job.id} submitted. Checking policy.`);
      router.push(`/jobs/${job.id}`);
    } catch (err) {
      setSubmitting(false);
      if (err instanceof ApiError && err.fields) {
        const mapped: Errors = {};
        for (const [k, v] of Object.entries(err.fields)) mapped[k === "networkMode" ? "network" : k === "workloadId" ? "workload" : k] = v;
        setServerErrors(mapped);
        window.setTimeout(() => summaryRef.current?.focus(), 0);
      } else {
        setSubmitError(err instanceof ApiError ? err.message : "Couldn't submit the job.");
      }
    }
  };

  if (workloads.loading) {
    return (
      <div className="pm-stack" aria-busy="true">
        <span className="pm-visually-hidden">Loading workloads…</span>
        <Skeleton height={120} />
        <Skeleton height={200} />
      </div>
    );
  }

  if (workloads.error && !workloads.data) {
    return (
      <Banner
        tone="danger"
        title="We couldn't load the workload catalogue"
        action={
          <Button size="sm" icon="refresh" onClick={() => void workloads.refresh()}>
            Try again
          </Button>
        }
      >
        {workloads.error.message}
      </Banner>
    );
  }

  const catalogue = workloads.data ?? [];
  const totalUpload = uploads.reduce((n, f) => n + f.bytes, 0);

  return (
    <form className={styles.layout} onSubmit={onSubmit} noValidate>
      <div className="pm-stack">
        {showErrors && errorList.length > 0 ? (
          <div ref={summaryRef} tabIndex={-1} className={styles.errorSummary} role="alert">
            <p className={styles.errorSummaryTitle}>
              <Icon name="alert" /> Fix {errorList.length === 1 ? "this" : `these ${errorList.length} things`} before submitting
            </p>
            <ul>
              {errorList.map(([key, msg]) => (
                <li key={key}>
                  <a href={`#section-${sectionFor(key)}`}>{msg}</a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <Panel id="section-workload" eyebrow="Step 1" title="Workload" description="Only signed, digest-pinned workloads from the PowerMesh catalogue can run.">
          <ChoiceGroup
            legend={<span className="pm-visually-hidden">Workload</span>}
            name="workload"
            value={workloadId}
            onChange={(v) => {
              setWorkloadId(v);
              setParams({});
              setNetwork("OFFLINE");
              setServerErrors({});
            }}
            error={showErrors ? allErrors.workload : undefined}
            options={catalogue.map((w) => ({
              value: w.id,
              label: (
                <>
                  {w.name} {w.version !== "—" ? <span className="pm-muted pm-small">v{w.version}</span> : null}
                </>
              ),
              description: w.summary,
              disabled: w.availability.status !== "available",
              disabledReason: w.availability.status === "unavailable" ? w.availability.reason : undefined,
            }))}
          />
          {workload ? (
            <div className={styles.signed}>
              <Icon name="shield" />
              <span>
                Signed by {workload.publisher} · <Digest value={workload.imageDigest} label="workload digest" />
              </span>
            </div>
          ) : null}
        </Panel>

        {workload ? (
          <>
            <Panel
              id="section-inputs"
              eyebrow="Step 2"
              title="Inputs"
              description={`${workload.inputSchema.accept.map(contentTypeLabel).join(", ")} · up to ${workload.inputSchema.maxFiles} images, ${formatBytes(workload.inputSchema.maxFileBytes)} each.`}
            >
              <div className="pm-stack-sm">
                <ChoiceGroup<InputSource>
                  legend="Images to transform"
                  name="source"
                  value={source}
                  onChange={(v) => {
                    setSource(v);
                    setServerErrors({});
                  }}
                  options={[
                    { value: "sample", label: "Demo sample set", description: "3 abstract images, safe to share. Works without internet." },
                    { value: "upload", label: "Upload images", description: "Your own PNG, JPEG or WebP files." },
                  ]}
                />
                {source === "sample" ? (
                  <ul role="list" className={styles.thumbs}>
                    {SAMPLE_SET.files.map((f) => (
                      <li key={f.name}>
                        {/* Static, bundled raster samples only — never untrusted content. */}
                        <img src={f.src} alt="" width={160} height={107} loading="lazy" />
                        <span className="pm-small pm-mono">{f.name}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="pm-stack-sm">
                    <Field
                      label="Choose images"
                      hint={IS_MOCK ? "Mock mode: only file names, types and sizes are sent — outputs use the demo images." : "Files are uploaded to scoped, short-lived storage and staged read-only for the job."}
                      error={showErrors ? allErrors.inputs : undefined}
                    >
                      <input type="file" multiple accept={workload.inputSchema.accept.join(",")} onChange={onUpload} className={styles.file} />
                    </Field>
                    {uploads.length > 0 ? (
                      <ul role="list" className={styles.fileList}>
                        {uploads.map((f) => {
                          const ok = workload.inputSchema.accept.includes(f.contentType) && f.bytes <= workload.inputSchema.maxFileBytes;
                          return (
                            <li key={f.name} className={ok ? undefined : styles.fileBad}>
                              <Icon name={ok ? "image" : "alert"} />
                              <span className="pm-mono">{f.name}</span>
                              <span className="pm-muted">
                                {contentTypeLabel(f.contentType)} · {formatBytes(f.bytes)}
                              </span>
                            </li>
                          );
                        })}
                        <li className="pm-muted pm-small">
                          {uploads.length} file{uploads.length === 1 ? "" : "s"} · {formatBytes(totalUpload)} total
                        </li>
                      </ul>
                    ) : null}
                  </div>
                )}
              </div>
            </Panel>

            {workload.params.length > 0 ? (
              <Panel id="section-params" eyebrow="Step 3" title="Parameters" description="Fixed by the workload's schema — nothing else can be passed to it.">
                <div className={styles.params}>
                  {workload.params.map((spec) =>
                    spec.type === "enum" ? (
                      <Field key={spec.key} label={spec.label} hint={spec.hint}>
                        <Select value={paramValue(spec.key)} onChange={(e) => setParams((p) => ({ ...p, [spec.key]: e.target.value }))}>
                          {spec.options.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </Select>
                      </Field>
                    ) : (
                      <Field
                        key={spec.key}
                        label={`${spec.label}${spec.unit ? ` (${spec.unit})` : ""}`}
                        hint={`${spec.min}–${spec.max}${spec.unit ? ` ${spec.unit}` : ""}. ${spec.hint ?? ""}`}
                        error={showErrors || paramValue(spec.key) !== String(spec.default) ? allErrors[spec.key] : undefined}
                      >
                        <TextInput
                          type="number"
                          inputMode="numeric"
                          min={spec.min}
                          max={spec.max}
                          step={spec.step ?? 1}
                          value={paramValue(spec.key)}
                          onChange={(e) => setParams((p) => ({ ...p, [spec.key]: e.target.value }))}
                        />
                      </Field>
                    ),
                  )}
                </div>
                <div className={styles.limits}>
                  <p className={styles.limitsTitle}>Enforced limits for every run</p>
                  <KeyValue
                    columns={3}
                    items={[
                      { label: "CPU", value: `${workload.limits.cpuCores} core` },
                      { label: "Memory", value: formatBytes(workload.limits.memoryBytes) },
                      { label: "Disk", value: formatBytes(workload.limits.diskBytes) },
                      { label: "Time", value: formatDuration(workload.limits.wallClockSeconds) },
                      { label: "Processes", value: workload.limits.pids },
                      { label: "Isolation", value: workload.minIsolation === "docker-rootless" ? "Rootless container or stronger" : workload.minIsolation },
                    ]}
                  />
                </div>
              </Panel>
            ) : null}

            <Panel id="section-network" eyebrow={`Step ${workload.params.length ? 4 : 3}`} title="Network" description="Offline is the default. The sandbox never needs internet to report progress.">
              <ChoiceGroup<NetworkMode>
                legend={<span className="pm-visually-hidden">Network mode</span>}
                name="network"
                value={network}
                onChange={(v) => {
                  setNetwork(v);
                  setServerErrors({});
                }}
                error={showErrors ? allErrors.network : undefined}
                options={(["OFFLINE", "RESTRICTED", "OPEN_WEB"] as NetworkMode[]).map((mode) => ({
                  value: mode,
                  label: NETWORK_COPY[mode].label,
                  description: NETWORK_COPY[mode].description,
                  disabled: mode === "RESTRICTED" && !workload.allowedNetworkModes.includes("RESTRICTED"),
                  disabledReason: "This workload doesn't use the network.",
                }))}
              />
            </Panel>
          </>
        ) : null}
      </div>

      <aside className={styles.side} aria-label="Job summary">
        <Panel variant="strong" title="Review and submit">
          <div className="pm-stack-sm">
            {workload && risk ? (
              <>
                <KeyValue
                  items={[
                    { label: "Workload", value: `${workload.name} v${workload.version}` },
                    {
                      label: "Inputs",
                      value: source === "sample" ? "Demo sample set · 3 PNG images" : `${uploads.length} image${uploads.length === 1 ? "" : "s"} · ${formatBytes(totalUpload)}`,
                    },
                    { label: "Network", value: NETWORK_COPY[network].label },
                  ]}
                />
                <hr className={styles.rule} />
                <div aria-live="polite">
                  <RiskExplanationView risk={risk} heading="Risk preview" compact />
                </div>
                {blocked ? (
                  <Banner tone="danger" title="This job can't be submitted">
                    {risk.tier === "HIGH"
                      ? "HIGH risk work never runs on personal devices."
                      : network === "OPEN_WEB"
                        ? "Choose Offline under Network to continue."
                        : "Change the choice marked “Blocks” to continue."}
                  </Banner>
                ) : (
                  <p className="pm-small pm-muted">The coordinator re-checks policy on submit. A provider must approve before anything runs.</p>
                )}
              </>
            ) : (
              <p className="pm-muted">Choose a workload to see its limits and risk.</p>
            )}
            {submitError ? (
              <Banner tone="danger" title="Not submitted" role="alert">
                {submitError}
              </Banner>
            ) : null}
            <Button type="submit" variant="primary" size="lg" icon="play" loading={submitting} disabled={!workload || blocked}>
              {submitting ? "Submitting…" : "Submit job"}
            </Button>
          </div>
        </Panel>
      </aside>
    </form>
  );
}

function sectionFor(key: string): string {
  if (key === "workload") return "workload";
  if (key === "inputs") return "inputs";
  if (key === "network") return "network";
  return "params";
}
