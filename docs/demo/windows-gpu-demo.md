# Windows-to-Windows NVIDIA demo

This is the real two-machine path. Gargi's browser submits through the public coordinator; the
provider Agent runs inside WSL2 on Fuzail's Windows machine and launches a fixed CUDA container on
his NVIDIA GPU. Reverse the roles for a second run if time permits.

The WSL2 Docker Desktop profile is a clearly labelled development runtime. It proves remote
scheduling and GPU execution; it does not claim rootless or gVisor isolation.

## 1. Publish and configure the workload once

The `Publish demo workload image` GitHub Action builds both catalogue images. After its first GPU
build, make `powermesh-gpu-benchmark` public in GitHub Packages and copy the immutable digest printed
by the action.

Set this exact value on the coordinator service and redeploy it:

```text
POWERMESH_GPU_BENCHMARK_IMAGE=ghcr.io/kavya-jain14/powermesh-gpu-benchmark@sha256:<digest>
```

The coordinator must also use PostgreSQL and a stable `OFFER_SIGNING_PRIVATE_KEY_BASE64`; otherwise a
restart forgets nodes or changes the signing identity.

The API container runs pending database migrations before it starts whenever `DATABASE_URL` is set.

## 2. Check each Windows NVIDIA machine

Open PowerShell as the normal user from the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\windows-gpu-check.ps1
```

The final line must be `READY`. If `nvidia-smi` fails inside the container, update the Windows NVIDIA
driver, run `wsl --update`, and confirm Docker Desktop is using the WSL2 backend.

## 3. Enrol Fuzail's provider

Open Ubuntu in WSL2. Clone/pull the repository inside the Linux filesystem, then:

```bash
corepack enable
pnpm install --frozen-lockfile

export POWERMESH_COORDINATOR_URL="https://powermesh-api.onrender.com"
export POWERMESH_ENROLLMENT_KEY="<same secret configured on the coordinator>"
export POWERMESH_OWNER_ID="$(node -e "console.log(require('node:crypto').randomUUID())")"
export AGENT_NODE_NAME="fuzail-windows-nvidia"
export POWERMESH_ALLOW_DESKTOP_SANDBOX="true"
export POWERMESH_CREDENTIAL_STORE="windows-dpapi"

pnpm --filter @powermesh/agent enroll
```

Verify the displayed Ed25519 fingerprint against the coordinator's trusted fingerprint. Save the
returned node ID, then start the Agent:

```bash
export POWERMESH_NODE_ID="<node id returned by enroll>"
export POWERMESH_AUTO_APPROVE_LOW_RISK="true"
pnpm --filter @powermesh/agent start
```

The first `AGENT_READY` output must show:

- `executionMode: WSL2_DOCKER_DESKTOP`
- at least one `NVIDIA_CUDA` accelerator
- the actual NVIDIA model and VRAM

Leave this terminal running. The Agent only makes outbound HTTPS requests; no router port forwarding
is needed.

## 4. Run the proof from Gargi's Windows machine

1. Open `https://powermesh-gargi-demo.onrender.com/jobs/new`.
2. Select **NVIDIA GPU benchmark**.
3. Use matrix size `2048` and `20` iterations.
4. Submit.
5. Watch `POLICY_CHECKED → OFFERED → APPROVED → CLAIMED → RUNNING → VALIDATING → SUCCEEDED`.
6. The result panel must show Fuzail's real GPU model, CUDA runtime, compute capability, GPU memory,
   kernel time and a validated checksum.

Keep Windows Task Manager's GPU compute graph or `nvidia-smi -l 1` visible on Fuzail's machine as
physical evidence while the job is running.

## 5. Prove symmetry

Repeat provider enrolment on Gargi's machine using a different owner UUID and node name. Stop or pause
Fuzail's Agent, then submit from Fuzail's browser. The coordinator should select Gargi's GPU.

## Demo claim

Say: “The requester sent a bounded catalogue job, not code or remote-control access. The cloud
coordinator matched an outbound-connected Windows provider, and this CUDA result came from that
provider's NVIDIA GPU.”

Do not call the WSL2 demo runtime rootless or gVisor-isolated. Those are separate hardened execution
profiles.
