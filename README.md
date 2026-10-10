# PowerMesh

**Share a capability, not a device.** A trusted-community compute network: a provider shares one narrowly
defined capability (for the MVP, an offline image-transform workload) without exposing their computer.

- Source of truth: [`context.md`](context.md) — live status + the Fresh-Start Master Plan v1.0.
- Design docs: [`docs/design/`](docs/design/) — information architecture, route map, state/copy requirements.

## Run the web app

Requires Node ≥ 20.9 and pnpm.

```bash
pnpm install
pnpm dev:web
```

Open http://localhost:3000. The app runs against an **in-app mock coordinator** (draft contracts, fixture data)
until Kavya's API lands — a grey strip at the top of every page says so.

- **Viewing as** (sidebar): switch between Requester, Provider and Admin.
- **Demo controls** (sidebar): disconnect the provider Agent, take the coordinator down, open an incident,
  change simulation pace, reset data. Use these to rehearse failure paths.

### Demo click path (≈ 2 minutes)

1. **Requester** → New job → Demo sample set → Submit. Watch the Flight Recorder go Checking → Queued → Offered.
2. Switch to **Provider** → "Review request" → read the Approval Sheet → **Approve once**.
3. Back as **Requester**, open the job: live timeline, limits, then the validated result with digests and downloads.
4. Run another job and, as Provider, press **Stop job** (or Ctrl + .) while it runs.
5. As **Admin**: Control Room for health and nodes, Policy & Audit to trace why any job was allowed or blocked.

## Layout

```
apps/web/             Next.js app (Gargi) — six surfaces + mock coordinator under /api/mock
  src/contracts-draft/  ⚠ provisional types/fixtures — replaced by packages/contracts (Kavya, K2)
  src/mock/             in-memory simulator; enforces the canonical state table
  scripts/              generate-samples.py (safe demo images)
packages/ui/          design tokens + shared primitives (G2)
docs/                 design docs, assets
```

## Checks

```bash
pnpm typecheck
pnpm build:web
pnpm check:contrast
```

## Swapping in the real API

Set `NEXT_PUBLIC_POWERMESH_API` (coordinator) and `NEXT_PUBLIC_POWERMESH_AGENT` (local Agent, loopback) — see
`apps/web/.env.example`. Client paths already follow API contract v0 (master plan §7).
