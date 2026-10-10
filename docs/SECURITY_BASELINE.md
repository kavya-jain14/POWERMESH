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

## Identity and enrollment

- Requester IDs are derived from bearer credentials; clients cannot choose another requester ID.
- Reading a job requires its requester credential or the separate coordinator credential.
- First-time requester and provider enrollment requires a deployment enrollment key.
- Provider credential rotation requires the current Agent token.
- Enrollment endpoints have stricter rate limits and the API has a global abuse limit.
- Agent tokens and pinned coordinator keys use Keychain on macOS, DPAPI on Windows, and Secret
  Service on Linux. A changed signing key fails closed until the provider explicitly re-enrolls.

## Automated security gates

Pull requests run CodeQL extended queries, Gitleaks, a production dependency audit, Trivy filesystem
and configuration analysis, and a Trivy scan of the non-root API image. Third-party actions are
pinned to reviewed commit SHAs; this is especially important because scanner actions themselves are
part of the software supply chain.
