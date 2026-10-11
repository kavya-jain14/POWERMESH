"use client";

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
import { useRouter } from "next/navigation";
import { type ChangeEvent, type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { RiskExplanationView } from "@/components/common/JobBits";
import {
  contentTypeLabel,
  formatBytes,
  formatDuration,
  formatMaybeBytes,
} from "@/contracts-draft/format";
import { classifyRisk } from "@/contracts-draft/risk";
import {
  type InputFileMeta,
  type NetworkMode,
  paramSpecs,
  type RiskBlockedDetails,
  type RiskExplanation,
  type WorkloadDefinition,
} from "@/contracts-draft/types";
import { ApiError, api, IS_LIVE, USES_SIMULATOR } from "@/lib/api";
import { NETWORK_COPY } from "@/lib/copy";
import { useResource } from "@/lib/hooks";
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
  const [submitError, setSubmitError] = useState<{
    title: string;
    message: string;
    correlationId?: string;
  }>();
  /** Q6: the coordinator's own decision when it blocks a submission (no job is created). */
  const [serverBlock, setServerBlock] = useState<{
    risk?: RiskExplanation;
    correlationId?: string;
    auditEventId?: string;
  }>();
  const [submitting, setSubmitting] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const summaryRef = useRef<HTMLDivElement>(null);

  const workload: WorkloadDefinition | undefined = workloads.data?.find((w) => w.id === workloadId);
  const hasInputs = Boolean(workload && workload.input.maxFiles > 0);

  useEffect(() => {
    if (workloads.data?.length && !workloads.data.some((entry) => entry.id === workloadId)) {
      setWorkloadId(workloads.data[0].id);
    }
  }, [workloads.data, workloadId]);
  // Q28: form controls are rendered from the workload's paramsSchema + x-ui hints.
  const specs = useMemo(() => (workload ? paramSpecs(workload.paramsSchema) : []), [workload]);

  const paramValue = (key: string): string => {
    const spec = specs.find((p) => p.key === key);
    return params[key] ?? (spec ? String(spec.default) : "");
  };

  // Client-side checks are a convenience only; the coordinator and Agent re-validate everything.
  const errors: Errors = useMemo(() => {
    const e: Errors = {};
    if (!workload) {
      e.workload = "Choose a workload.";
      return e;
    }
    const schema = workload.input;
    if (hasInputs && source === "upload") {
      if (uploads.length === 0) e.inputs = "Add at least one image.";
      else if (uploads.length > schema.maxFiles)
        e.inputs = `Up to ${schema.maxFiles} images per job — remove ${uploads.length - schema.maxFiles}.`;
      else {
        const badType = uploads.find((f) => !schema.contentTypes.includes(f.contentType));
        const tooBig = uploads.find((f) => f.bytes > schema.maxBytesPerFile);
        const total = uploads.reduce((n, f) => n + f.bytes, 0);
        if (badType) e.inputs = `${badType.name} isn't a PNG, JPEG or WebP image.`;
        else if (tooBig)
          e.inputs = `${tooBig.name} is ${formatBytes(tooBig.bytes)} — the limit is ${formatBytes(schema.maxBytesPerFile)} per image.`;
        else if (total > schema.maxTotalBytes)
          e.inputs = `These images add up to ${formatBytes(total)} — the limit is ${formatBytes(schema.maxTotalBytes)}.`;
      }
    }
    for (const spec of specs) {
      if (spec.type !== "int") continue;
      const raw = paramValue(spec.key);
      const n = Number(raw);
      const offStep = spec.step ? (n - spec.min) % spec.step !== 0 : false;
      if (raw.trim() === "" || !Number.isInteger(n) || n < spec.min || n > spec.max || offStep) {
        e[spec.key] =
          `Enter a whole number from ${spec.min} to ${spec.max}${spec.unit ? ` ${spec.unit}` : ""}${spec.step ? `, in steps of ${spec.step}` : ""}.`;
      }
    }
    if (network === "RESTRICTED" && !workload.allowedNetworkModes.includes("RESTRICTED"))
      e.network = "This workload only runs offline.";
    return e;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workload, hasInputs, specs, source, uploads, params, network]);

  const risk = useMemo(
    () => (workload ? classifyRisk(workload, network) : null),
    [workload, network],
  );
  const blocked = risk?.tier === "BLOCKED" || risk?.tier === "HIGH";
  const allErrors: Errors = { ...errors, ...serverErrors };
  const errorList = Object.entries(allErrors).filter(([, v]) => v) as Array<[string, string]>;
  const showErrors = attempted || Object.keys(serverErrors).length > 0;

  const onUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const list = Array.from(e.target.files ?? []).map((f) => ({
      name: f.name,
      contentType: f.type || "application/octet-stream",
      bytes: f.size,
    }));
    setUploads(list);
    setServerErrors({});
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setAttempted(true);
    setSubmitError(undefined);
    setServerBlock(undefined);
    if (!workload || Object.keys(errors).length || blocked) {
      summaryRef.current?.focus();
      return;
    }
    setSubmitting(true);
    try {
      const typed: Record<string, string | number> = {};
      for (const spec of specs)
        typed[spec.key] = spec.type === "int" ? Number(paramValue(spec.key)) : paramValue(spec.key);
      const job = await api.submitJob({
        workloadId: workload.id,
        params: typed,
        networkMode: network,
        inputs: hasInputs && source === "upload" ? uploads : [],
        sampleSet: hasInputs && source === "sample" ? SAMPLE_SET.id : undefined,
      });
      announce(`Job ${job.id} submitted. Checking policy.`);
      router.push(`/jobs/${job.id}`);
    } catch (err) {
      setSubmitting(false);
      if (err instanceof ApiError && err.code === "RISK_BLOCKED") {
        const details = err.details as Partial<RiskBlockedDetails> | undefined;
        setServerBlock({
          risk: details?.risk,
          correlationId: err.correlationId,
          auditEventId: details?.auditEventId,
        });
        announce("Blocked by the coordinator's safety policy. Nothing was created.", "assertive");
      } else if (err instanceof ApiError && err.fields && err.code !== "PAYLOAD_TOO_LARGE") {
        setServerErrors(mapFieldKeys(err.fields));
        window.setTimeout(() => summaryRef.current?.focus(), 0);
      } else if (err instanceof ApiError) {
        if (err.fields) setServerErrors(mapFieldKeys(err.fields));
        setSubmitError({
          title: SUBMIT_ERROR_TITLE[err.code] ?? "Not submitted",
          message: err.message,
          correlationId: err.correlationId,
        });
      } else {
        setSubmitError({ title: "Not submitted", message: "Couldn't submit the job." });
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
              <Icon name="alert" /> Fix{" "}
              {errorList.length === 1 ? "this" : `these ${errorList.length} things`} before
              submitting
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

        <Panel
          id="section-workload"
          eyebrow="Step 1"
          title="Workload"
          description="Only signed, digest-pinned workloads from the PowerMesh catalogue can run."
        >
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
                  {w.name}{" "}
                  {w.version !== "—" ? (
                    <span className="pm-muted pm-small">v{w.version}</span>
                  ) : null}
                </>
              ),
              description: w.summary,
              disabled: w.availability.status !== "available",
              disabledReason:
                w.availability.status === "unavailable" ? w.availability.reason : undefined,
            }))}
          />
          {workload ? (
            <div className={styles.signed}>
              <Icon name="shield" />
              <span>
                Signed by {workload.publisher} ·{" "}
                <Digest value={workload.imageDigest} label="workload digest" />
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
              description={
                hasInputs
                  ? `${workload.input.contentTypes.map(contentTypeLabel).join(", ")} · up to ${workload.input.maxFiles} images, ${formatBytes(workload.input.maxBytesPerFile)} each.`
                  : "No files or requester code are sent to this workload."
              }
            >
              {hasInputs ? (
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
                      {
                        value: "sample",
                        label: "Demo sample set",
                        description: "3 abstract images, safe to share. Works without internet.",
                      },
                      {
                        value: "upload",
                        label: "Upload images",
                        description: "Your own PNG, JPEG or WebP files.",
                      },
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
                        hint={
                          IS_LIVE
                            ? "Only file names, types and sizes are sent — the coordinator has no upload storage yet, so it receives no input digests for your own files."
                            : USES_SIMULATOR
                              ? "Offline demo: only file names, types and sizes are sent — outputs use the demo images. These checks are early feedback, not a security guarantee — the server validates again."
                              : "Files are uploaded to scoped, short-lived storage and staged read-only for the job."
                        }
                        error={showErrors ? allErrors.inputs : undefined}
                      >
                        <input
                          type="file"
                          multiple
                          accept={workload.input.contentTypes.join(",")}
                          onChange={onUpload}
                          className={styles.file}
                        />
                      </Field>
                      {uploads.length > 0 ? (
                        <ul role="list" className={styles.fileList}>
                          {uploads.map((f) => {
                            const ok =
                              workload.input.contentTypes.includes(f.contentType) &&
                              f.bytes <= workload.input.maxBytesPerFile;
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
                            {uploads.length} file{uploads.length === 1 ? "" : "s"} ·{" "}
                            {formatBytes(totalUpload)} total
                          </li>
                        </ul>
                      ) : null}
                    </div>
                  )}
                </div>
              ) : (
                <Banner tone="info" title="Hardware-only verification">
                  The provider runs the fixed benchmark image and returns only validated GPU facts.
                </Banner>
              )}
            </Panel>

            {specs.length > 0 ? (
              <Panel
                id="section-params"
                eyebrow="Step 3"
                title="Parameters"
                description="Fixed by the workload's schema — nothing else can be passed to it."
              >
                <div className={styles.params}>
                  {specs.map((spec) =>
                    spec.type === "enum" ? (
                      <Field
                        key={spec.key}
                        label={spec.label}
                        hint={spec.hint}
                        error={showErrors ? allErrors[spec.key] : undefined}
                      >
                        <Select
                          value={paramValue(spec.key)}
                          onChange={(e) => setParams((p) => ({ ...p, [spec.key]: e.target.value }))}
                        >
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
                        error={
                          showErrors || paramValue(spec.key) !== String(spec.default)
                            ? allErrors[spec.key]
                            : undefined
                        }
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
                      { label: "Disk", value: formatMaybeBytes(workload.limits.diskBytes) },
                      { label: "Time", value: formatDuration(workload.limits.timeoutSeconds) },
                      { label: "Processes", value: workload.limits.pidLimit ?? "Not reported" },
                      {
                        label: "Accelerator",
                        value: workload.accelerator === "cuda" ? "1 × NVIDIA CUDA GPU" : "None",
                      },
                      {
                        label: "Isolation",
                        value:
                          workload.minimumIsolation === "docker-rootless"
                            ? "Rootless container or stronger"
                            : workload.minimumIsolation,
                      },
                    ]}
                  />
                </div>
              </Panel>
            ) : null}

            <Panel
              id="section-network"
              eyebrow={`Step ${specs.length ? 4 : 3}`}
              title="Network"
              description="Offline is the default. The sandbox never needs internet to report progress."
            >
              <ChoiceGroup<NetworkMode>
                legend={<span className="pm-visually-hidden">Network mode</span>}
                name="network"
                value={network}
                onChange={(v) => {
                  setNetwork(v);
                  setServerErrors({});
                  setServerBlock(undefined);
                }}
                error={showErrors ? allErrors.network : undefined}
                options={(["OFFLINE", "RESTRICTED", "OPEN_WEB"] as NetworkMode[]).map((mode) => ({
                  value: mode,
                  label: NETWORK_COPY[mode].label,
                  description: NETWORK_COPY[mode].description,
                  disabled:
                    mode === "RESTRICTED" && !workload.allowedNetworkModes.includes("RESTRICTED"),
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
                      value: !hasInputs
                        ? "None — fixed benchmark"
                        : source === "sample"
                          ? "Demo sample set · 3 PNG images"
                          : `${uploads.length} image${uploads.length === 1 ? "" : "s"} · ${formatBytes(totalUpload)}`,
                    },
                    ...(workload.accelerator === "cuda"
                      ? [{ label: "Hardware", value: "NVIDIA CUDA GPU required" }]
                      : []),
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
                  <p className="pm-small pm-muted">
                    The coordinator re-checks policy on submit. A provider must approve before
                    anything runs.
                  </p>
                )}
              </>
            ) : (
              <p className="pm-muted">Choose a workload to see its limits and risk.</p>
            )}
            {serverBlock ? (
              <Banner tone="danger" title="Blocked by the coordinator" role="alert">
                <div className="pm-stack-sm">
                  <p>
                    This request is blocked by the current safety policy. No job was created and
                    nothing was offered to a provider.
                  </p>
                  {serverBlock.risk ? (
                    <RiskExplanationView
                      risk={serverBlock.risk}
                      heading="Coordinator's decision"
                      compact
                    />
                  ) : null}
                  <p className="pm-small">
                    Reference:{" "}
                    <span className="pm-mono">
                      {serverBlock.auditEventId ?? serverBlock.correlationId ?? "—"}
                    </span>
                  </p>
                </div>
              </Banner>
            ) : null}
            {submitError ? (
              <Banner tone="danger" title={submitError.title} role="alert">
                {submitError.message}
                {submitError.correlationId ? (
                  <span className="pm-small pm-mono"> (ref {submitError.correlationId})</span>
                ) : null}
              </Banner>
            ) : null}
            <Button
              type="submit"
              variant="primary"
              size="lg"
              icon="play"
              loading={submitting}
              disabled={!workload || blocked}
            >
              {submitting ? "Submitting…" : "Submit job"}
            </Button>
          </div>
        </Panel>
      </aside>
    </form>
  );
}

const SUBMIT_ERROR_TITLE: Partial<Record<ApiError["code"], string>> = {
  UNAUTHENTICATED: "You're signed out",
  FORBIDDEN: "Not allowed",
  PAYLOAD_TOO_LARGE: "Inputs are too large",
  RATE_LIMITED: "Too many requests",
  UNAVAILABLE: "Coordinator unavailable",
  NETWORK: "Coordinator unreachable",
};

/** Q8 field keys → this form's fields: params.<name> → <name>, limits.* → the parameters section. */
function mapFieldKeys(fields: Record<string, string>): Errors {
  const mapped: Errors = {};
  for (const [k, v] of Object.entries(fields)) {
    const key =
      k === "networkMode"
        ? "network"
        : k === "workloadId"
          ? "workload"
          : k.startsWith("params.")
            ? k.slice("params.".length)
            : k.startsWith("inputs.")
              ? "inputs"
              : k;
    mapped[key] = v;
  }
  return mapped;
}

function sectionFor(key: string): string {
  if (key === "workload") return "workload";
  if (key === "inputs") return "inputs";
  if (key === "network") return "network";
  return "params";
}
