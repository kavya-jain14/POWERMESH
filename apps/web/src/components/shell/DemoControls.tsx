"use client";

import { useState } from "react";
import { Button, Dialog, Toggle, Select, Field, Banner } from "@powermesh/ui";
import { devApi, type DevFlags } from "@/lib/api";

/**
 * Mock-only rehearsal controls (master plan §8 working rhythm: rehearse with network failure and a
 * provider-kill scenario). Drives the simulator so every degraded/offline/retry state is reachable.
 */
export function DemoControls() {
  const [open, setOpen] = useState(false);
  const [flags, setFlags] = useState<DevFlags>();
  const [busy, setBusy] = useState(false);

  const load = async () => setFlags(await devApi.status());
  const send = async (action: string, value?: number) => {
    setBusy(true);
    try {
      setFlags(await devApi.send({ action, value }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        icon="activity"
        onClick={() => {
          setOpen(true);
          void load();
        }}
      >
        Demo controls
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Demo controls"
        description="Simulate failures to rehearse the demo. Mock coordinator only."
        footer={
          <>
            <Button variant="secondary" icon="refresh" loading={busy} onClick={() => void send("reset")}>
              Reset demo data
            </Button>
            <Button variant="primary" onClick={() => setOpen(false)}>
              Done
            </Button>
          </>
        }
      >
        {!flags ? (
          <p>Loading…</p>
        ) : (
          <div style={{ display: "grid", gap: "var(--pm-space-5)" }}>
            <Toggle
              checked={flags.agentConnected}
              disabled={busy}
              onChange={(on) => void send(on ? "agent-reconnect" : "agent-disconnect")}
              label="Provider Agent connected"
              description="Turn off to simulate the provider disappearing mid-job: heartbeats stop, the lease expires, and an idempotent job is requeued once."
            />
            <Toggle
              checked={!flags.coordinatorDown}
              disabled={busy}
              onChange={(on) => void send(on ? "coordinator-up" : "coordinator-down")}
              label="Coordinator reachable"
              description="Turn off to simulate a control-plane outage. Live streams drop and reconnect; the provider's local stop keeps working."
            />
            <Toggle
              checked={Boolean(flags.incident)}
              disabled={busy}
              onChange={(on) => void send(on ? "incident-open" : "incident-close")}
              label="Open incident"
              description="Shows the incident state in the Control Room."
            />
            <Field label="Simulation pace" hint="Slower pace stretches each step for a narrated demo.">
              <Select value={String(flags.pace)} disabled={busy} onChange={(e) => void send("pace", Number(e.target.value))}>
                <option value="0.3">Fast (×0.3)</option>
                <option value="1">Demo (×1)</option>
                <option value="2">Narrated (×2)</option>
              </Select>
            </Field>
            {flags.coordinatorDown ? (
              <Banner tone="warning" title="Coordinator is down">
                Coordinator API calls now fail with 503. Remember to turn it back on.
              </Banner>
            ) : null}
          </div>
        )}
      </Dialog>
    </>
  );
}
