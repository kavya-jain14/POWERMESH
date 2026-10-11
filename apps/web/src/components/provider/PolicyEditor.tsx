"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Banner, Button, ChoiceGroup, Field, Panel, Select, Skeleton, TextInput, useAnnouncer } from "@powermesh/ui";
import type { PolicySchedule, ProviderPolicy } from "@/contracts-draft/types";
import { formatDateTime } from "@/contracts-draft/format";
import { WORKLOADS } from "@/contracts-draft/workloads";
import { ApiError, agent, api } from "@/lib/api";
import { NETWORK_COPY } from "@/lib/copy";
import styles from "./Provider.module.css";

const GB = 1024 * 1024 * 1024;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Q13: IANA zones. Falls back to a short list where the browser can't enumerate them. */
function timeZones(current: string): string[] {
  let zones: string[] = [];
  try {
    zones = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
  } catch {
    zones = [];
  }
  if (zones.length === 0) zones = ["UTC", "Asia/Kolkata", "Europe/London", "Europe/Berlin", "America/New_York", "America/Los_Angeles", "Asia/Singapore", "Australia/Sydney"];
  return zones.includes(current) ? zones : [current, ...zones];
}

function browserZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

/** Server field keys (Q13) → this form's fields. */
const FIELD_KEY: Record<string, string> = {
  "resourceCaps.cpuCores": "cpu",
  "resourceCaps.memoryBytes": "memGb",
  "resourceCaps.diskBytes": "diskGb",
  "resourceCaps.timeoutSeconds": "timeoutMin",
  "resourceCaps.pidLimit": "pids",
  "resourceCaps.maxOutputBytes": "outputMb",
};

type Draft = Omit<ProviderPolicy, "resourceCaps" | "updatedAt" | "nodeId"> & {
  cpu: string;
  memGb: string;
  diskGb: string;
  timeoutMin: string;
  pids: string;
  outputMb: string;
};

const MB = 1024 * 1024;

function toDraft(p: ProviderPolicy): Draft {
  return {
    allowedWorkloads: p.allowedWorkloads,
    riskMax: p.riskMax,
    consentMode: p.consentMode,
    schedule: p.schedule,
    networkModes: p.networkModes,
    cpu: String(p.resourceCaps.cpuCores),
    memGb: String(p.resourceCaps.memoryBytes / GB),
    diskGb: String(p.resourceCaps.diskBytes / GB),
    timeoutMin: String(p.resourceCaps.timeoutSeconds / 60),
    pids: String(p.resourceCaps.pidLimit),
    outputMb: String(p.resourceCaps.maxOutputBytes / MB),
  };
}

/** Provider sharing policy (GET/PUT /v1/nodes/:id/policy). Deny-first defaults; nothing broader than the MVP allows. */
export function PolicyEditor() {
  const { announce } = useAnnouncer();
  const [nodeId, setNodeId] = useState<string>();
  const [policy, setPolicy] = useState<ProviderPolicy>();
  const [draft, setDraft] = useState<Draft>();
  const [loadError, setLoadError] = useState<string>();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        // The Agent on this device knows which node this is (Q21); the policy itself lives on the coordinator.
        const local = await agent.state();
        setNodeId(local.node.id);
        const p = await api.getPolicy(local.node.id);
        setPolicy(p);
        setDraft(toDraft(p));
      } catch (err) {
        setLoadError(err instanceof ApiError ? err.message : "Couldn't load your policy.");
      }
    })();
  }, []);

  if (loadError) return <Banner tone="danger" title="We couldn't load your sharing policy">{loadError}</Banner>;
  if (!draft || !policy || !nodeId) {
    return (
      <div className="pm-stack" aria-busy="true">
        <span className="pm-visually-hidden">Loading policy…</span>
        <Skeleton height={160} />
        <Skeleton height={160} />
      </div>
    );
  }

  const update = (patch: Partial<Draft>) => {
    setDraft({ ...draft, ...patch });
    setSaved(false);
  };

  const setWindow = (patch: { start?: string; end?: string }) => {
    const current = draft.schedule.mode === "window" ? draft.schedule : { start: "18:00", end: "08:00" };
    update({ schedule: { mode: "window", start: patch.start ?? current.start, end: patch.end ?? current.end, timezone: draft.schedule.timezone } });
  };

  const validate = (): Record<string, string> => {
    const e: Record<string, string> = {};
    const num = (v: string, min: number, max: number) => Number.isFinite(Number(v)) && Number(v) >= min && Number(v) <= max;
    if (!num(draft.cpu, 1, 64)) e.cpu = "Enter 1–64 cores.";
    if (!num(draft.memGb, 0.5, 256)) e.memGb = "Enter 0.5–256 GB.";
    if (!num(draft.diskGb, 1, 1024)) e.diskGb = "Enter 1–1024 GB.";
    if (!num(draft.timeoutMin, 1, 1440) || !Number.isInteger(Number(draft.timeoutMin))) e.timeoutMin = "Enter 1–1440 whole minutes.";
    if (!num(draft.pids, 1, 4096) || !Number.isInteger(Number(draft.pids))) e.pids = "Enter 1–4096 processes.";
    if (!num(draft.outputMb, 1, 10240)) e.outputMb = "Enter 1–10240 MB.";
    if (draft.schedule.mode === "window") {
      if (!HHMM.test(draft.schedule.start)) e["schedule.start"] = "Use a 24-hour time like 18:00.";
      if (!HHMM.test(draft.schedule.end)) e["schedule.end"] = "Use a 24-hour time like 08:00.";
      else if (draft.schedule.start === draft.schedule.end) e["schedule.end"] = "The window must end at a different time than it starts.";
    }
    if (!draft.schedule.timezone) e["schedule.timezone"] = "Choose a time zone.";
    return e;
  };

  const onSubmit = async (ev: FormEvent) => {
    ev.preventDefault();
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) return;
    setSaving(true);
    try {
      const next = await api.putPolicy(nodeId, {
        allowedWorkloads: draft.allowedWorkloads,
        riskMax: draft.riskMax,
        consentMode: draft.consentMode,
        schedule: draft.schedule,
        networkModes: draft.networkModes,
        resourceCaps: {
          cpuCores: Number(draft.cpu),
          memoryBytes: Math.round(Number(draft.memGb) * GB),
          diskBytes: Math.round(Number(draft.diskGb) * GB),
          timeoutSeconds: Number(draft.timeoutMin) * 60,
          pidLimit: Number(draft.pids),
          maxOutputBytes: Math.round(Number(draft.outputMb) * MB),
        },
      });
      setPolicy(next);
      setDraft(toDraft(next));
      setSaved(true);
      announce("Sharing policy saved.");
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(Object.fromEntries(Object.entries(err.fields).map(([k, v]) => [FIELD_KEY[k] ?? k, v])));
      else setErrors({ form: err instanceof ApiError ? err.message : "Couldn't save." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className={styles.policyForm} onSubmit={onSubmit} noValidate>
      {saved ? <Banner tone="success" title="Saved" role="status">New requests are matched against this policy from now on.</Banner> : null}
      {errors.form ? <Banner tone="danger" title="Not saved" role="alert">{errors.form}</Banner> : null}

      <Panel title="What you share" description="Only workloads on this list can ever be offered to this device.">
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="pm-visually-hidden">Allowed workloads</legend>
          {WORKLOADS.map((w) => {
            const available = w.availability.status === "available";
            const id = `wl-${w.id}`;
            return (
              <div key={w.id} className={styles.checkRow}>
                <input
                  id={id}
                  type="checkbox"
                  disabled={!available}
                  checked={draft.allowedWorkloads.includes(w.id)}
                  onChange={(e) =>
                    update({ allowedWorkloads: e.target.checked ? [...draft.allowedWorkloads, w.id] : draft.allowedWorkloads.filter((x) => x !== w.id) })
                  }
                  aria-describedby={`${id}-d`}
                />
                <div>
                  <label htmlFor={id} style={{ fontWeight: 500 }}>
                    {w.name} <span className="pm-muted">v{w.version}</span>
                  </label>
                  <p id={`${id}-d`} className="pm-small pm-muted">
                    {available ? w.summary : w.availability.status === "unavailable" ? w.availability.reason : null}
                  </p>
                </div>
              </div>
            );
          })}
        </fieldset>
      </Panel>

      <Panel title="Consent">
        <div className="pm-stack">
          <ChoiceGroup
            legend="Highest risk you accept"
            name="riskMax"
            value={draft.riskMax}
            onChange={(v) => update({ riskMax: v })}
            error={errors.riskMax}
            options={[
              { value: "LOW", label: "LOW only", description: "Signed workloads with fixed inputs and no network." },
              { value: "MEDIUM", label: "Up to MEDIUM", description: "Also allows approved HTTPS destinations through the egress gateway (when available)." },
            ]}
            hint="HIGH and BLOCKED work never runs on personal devices — it isn't an option."
          />
          <ChoiceGroup
            legend="How requests are approved"
            name="consentMode"
            value={draft.consentMode}
            onChange={(v) => update({ consentMode: v })}
            options={[
              { value: "ask", label: "Ask me every time", description: "Each request waits for you on the Approval Sheet." },
              { value: "auto", label: "Approve automatically", description: "Only when a request matches every rule on this page. Every auto-approval is logged." },
            ]}
          />
        </div>
      </Panel>

      <Panel title="When and how much">
        <div className="pm-stack">
          <ChoiceGroup
            legend="When to accept requests"
            name="schedule"
            value={draft.schedule.mode}
            onChange={(v) =>
              update({
                schedule: v === "always" ? { mode: "always", timezone: draft.schedule.timezone } : { mode: "window", start: "18:00", end: "08:00", timezone: draft.schedule.timezone },
              })
            }
            error={errors["schedule.mode"]}
            options={[
              { value: "always", label: "Any time I'm available" },
              { value: "window", label: "Only during a daily window" },
            ]}
          />
          {draft.schedule.mode === "window" ? (
            <div className={styles.inline3}>
              <Field label="From (24-hour)" error={errors["schedule.start"]}>
                <TextInput value={draft.schedule.start} onChange={(e) => setWindow({ start: e.target.value })} placeholder="18:00" />
              </Field>
              <Field label="Until (24-hour)" error={errors["schedule.end"]} hint="Can cross midnight, like 18:00 to 08:00.">
                <TextInput value={draft.schedule.end} onChange={(e) => setWindow({ end: e.target.value })} placeholder="08:00" />
              </Field>
            </div>
          ) : null}
          <Field
            label="Time zone"
            error={errors["schedule.timezone"]}
            hint={`Your schedule always follows this zone, not the device's clock.${browserZone() && browserZone() !== draft.schedule.timezone ? ` This browser is set to ${browserZone()}.` : ""}`}
          >
            <Select value={draft.schedule.timezone} onChange={(e) => update({ schedule: { ...draft.schedule, timezone: e.target.value } as PolicySchedule })}>
              {timeZones(draft.schedule.timezone).map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </Select>
          </Field>
          <div className={styles.inline3}>
            <Field label="CPU cores to share" error={errors.cpu}>
              <TextInput type="number" inputMode="numeric" min={1} value={draft.cpu} onChange={(e) => update({ cpu: e.target.value })} />
            </Field>
            <Field label="Memory (GB)" error={errors.memGb}>
              <TextInput type="number" inputMode="decimal" min={0.5} step={0.5} value={draft.memGb} onChange={(e) => update({ memGb: e.target.value })} />
            </Field>
            <Field label="Disk (GB)" error={errors.diskGb}>
              <TextInput type="number" inputMode="numeric" min={1} value={draft.diskGb} onChange={(e) => update({ diskGb: e.target.value })} />
            </Field>
          </div>
          <div className={styles.inline3}>
            <Field label="Longest run (minutes)" error={errors.timeoutMin} hint="Jobs that need longer are never offered to you.">
              <TextInput type="number" inputMode="numeric" min={1} value={draft.timeoutMin} onChange={(e) => update({ timeoutMin: e.target.value })} />
            </Field>
            <Field label="Max processes" error={errors.pids}>
              <TextInput type="number" inputMode="numeric" min={1} value={draft.pids} onChange={(e) => update({ pids: e.target.value })} />
            </Field>
            <Field label="Max output (MB)" error={errors.outputMb}>
              <TextInput type="number" inputMode="numeric" min={1} value={draft.outputMb} onChange={(e) => update({ outputMb: e.target.value })} />
            </Field>
          </div>
        </div>
      </Panel>

      <Panel title="Network" description="Network access is off unless you allow it here.">
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="pm-visually-hidden">Allowed network modes</legend>
          {(["OFFLINE", "RESTRICTED"] as const).map((mode) => {
            const id = `net-${mode}`;
            const locked = mode === "RESTRICTED";
            return (
              <div key={mode} className={styles.checkRow}>
                <input
                  id={id}
                  type="checkbox"
                  disabled={locked}
                  checked={draft.networkModes.includes(mode)}
                  onChange={(e) => update({ networkModes: e.target.checked ? [...draft.networkModes, mode] : draft.networkModes.filter((m) => m !== mode) })}
                  aria-describedby={`${id}-d`}
                />
                <div>
                  <label htmlFor={id} style={{ fontWeight: 500 }}>
                    {NETWORK_COPY[mode].label}
                  </label>
                  <p id={`${id}-d`} className="pm-small pm-muted">
                    {locked ? "Not available yet — needs the controlled egress gateway." : NETWORK_COPY[mode].description}
                  </p>
                </div>
              </div>
            );
          })}
          <p className="pm-small pm-muted">Open internet is never available on personal devices.</p>
        </fieldset>
      </Panel>

      <div className={styles.formActions}>
        <Button type="submit" variant="primary" size="lg" loading={saving}>
          Save policy
        </Button>
        <span className="pm-small pm-muted">Last saved {formatDateTime(policy.updatedAt)}</span>
      </div>
    </form>
  );
}
