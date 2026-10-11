"use client";

import { useState } from "react";
import { Button, Dialog, Toggle, Select, Field, Banner } from "@powermesh/ui";
import { ApiError, devApi, type DevFlags } from "@/lib/api";

/**
 * Offline-demo rehearsal controls (Q30: explicit offline-demo mode only). Rehearse network failure and
 * a provider-kill scenario: drives the simulator so every degraded/offline/retry state is reachable.
 */
export function DemoControls() {
  const [open, setOpen] = useState(false);
  const [flags, setFlags] = useState<DevFlags>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const load = async () => setFlags(await devApi.status());
  const send = async (action: string, value?: number) => {
    setBusy(true);
    setError(undefined);
    try {
      setFlags(await devApi.send({ action, value }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That didn't work.");
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
        description="Simulate failures to rehearse the demo. Offline demo only."
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
              description="Turn off to simulate the provider's Agent disappearing mid-job: heartbeats stop, the lease expires after 30 s plus a 10 s grace, and a job that's safe to repeat goes back to the queue once."
            />
            <Toggle
              checked={!flags.coordinatorDown}
              disabled={busy}
              onChange={(on) => void send(on ? "coordinator-up" : "coordinator-down")}
              label="Coordinator reachable"
              description="Turn off to simulate a control-plane outage. Live streams drop and reconnect. The Provider Console keeps working, because it talks to the Agent on the device."
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
            {error ? (
              <Banner tone="danger" title="Not done" role="alert">
                {error}
              </Banner>
            ) : null}
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
