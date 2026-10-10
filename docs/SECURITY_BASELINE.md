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

## Execution sandbox

- Provider execution is advertised only when Docker is available in rootless mode on Linux.
- gVisor is advertised only when the `runsc` runtime is installed and detected.
- Workload images must be immutable SHA-256 digest references.
- Containers run without networking, host mounts, capabilities, privilege escalation, devices, or the Docker socket.
- The root filesystem is read-only and the container UID/GID is an unprivileged numeric identity.
- CPU, memory, swap, PID, temporary filesystem, wall-clock, and captured-output limits are mandatory.
- The local kill switch terminates both the client process and the named container.
- Outputs are size-limited, type checked, magic-byte checked, and hashed before acceptance.
- Execution completion contains output sizes, hashes, and validation status only; raw bytes and
  active content never cross the Agent-to-coordinator control-plane endpoint.
- Restricted jobs run on a per-job internal Docker network with a fixed proxy IP and no usable DNS.
- Only the digest-pinned proxy sidecar joins both the internal network and a separate uplink network.
- The proxy uses exact normalized host allowlists, permits only HTTP/80 and HTTPS CONNECT/443,
  resolves DNS again for every request, connects to the resolved IP, and rejects the complete answer
  set if any IPv4/IPv6 address is private, loopback, link-local, multicast, reserved, or documentation-only.
- Proxy request, byte, and time quotas are enforced; hop-by-hop and proxy-authorization headers are stripped.
- Redirects are not followed by the proxy, so every redirected destination returns through the same checks.
- `OPEN_WEB` remains forbidden and restricted execution fails closed if the proxy cannot start.
