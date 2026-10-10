# Security baseline

Docker is a useful packaging boundary, not an impenetrable security boundary. PowerMesh uses layered controls and states residual risk honestly.

## Required before real execution

- Rootless runtime with all Linux capabilities dropped
- No host filesystem mounts and no Docker socket
- Read-only root filesystem plus a bounded per-job workspace
- CPU, memory, PID, disk, output-size, and wall-clock limits
- `OFFLINE` networking by default
- Exact-host egress proxy for `RESTRICTED` mode; redirects, private IP ranges, DNS rebinding, and quotas enforced
- Signed workload manifest, pinned image digest, nonce, and expiry
- Agent bearer tokens stored as one-way hashes and required for heartbeat, polling, approval, and claim
- Provider approval showing image identity, inputs, limits, network mode, and risk reasons
- Local kill switch that works without coordinator connectivity
- Output type, size, archive depth, digest, and active-content validation
- Append-only safe audit events with secret redaction

## Risk policy v0

| Tier | Examples | MVP action |
| --- | --- | --- |
| LOW | Pinned workload, offline, default limits | Auto-eligible after provider policy |
| MEDIUM | Restricted egress or increased resource envelope | Explicit provider approval |
| HIGH | Open web or unreviewed image | Do not execute in MVP |
| BLOCKED | Privileged, host mount, Docker socket, raw device | Reject before scheduling |

## gVisor

gVisor adds a userspace-kernel boundary between the workload and host kernel. It reduces the exposed kernel attack surface, but it can break syscall-heavy software, reduce I/O or networking performance, complicate debugging, and is not uniformly available across Windows and macOS hosts. The UI must display the isolation level the Agent actually verified.

## Release blockers

- Sandbox can reach a known host file or Docker socket
- Unsigned or unpinned workload executes
- Kill switch depends on the coordinator
- A blocked job reaches the matcher
- Raw active output is rendered in the browser
- An offer can be claimed twice, after expiry, or by a different provider node
- A production coordinator starts with an ephemeral signing key
