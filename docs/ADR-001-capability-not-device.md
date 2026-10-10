# ADR-001: Share a capability, not a device

- Status: accepted
- Owners: Kavya and Gargi
- Date: 2026-10-10

## Context

PowerMesh executes requester workloads on provider-owned hardware. Treating the provider as a remotely accessible machine would expose files, credentials, network identity, and devices that the requester does not need.

## Decision

The requester submits a versioned, declarative workload. The coordinator matches only advertised capability. The provider Agent pulls a signed assignment, asks for local consent, and creates a per-job sandbox. No inbound requester connection is accepted.

The requester can supply validated inputs and receive validated outputs. They cannot request a shell, arbitrary host paths, privileged mode, the Docker socket, or raw devices.

## Consequences

- The contract and policy engine become the integration boundary.
- Interactive arbitrary code execution is outside the first release.
- Platform support is capability-based; Windows, macOS, and Linux do not pretend to provide identical isolation.
- A result proves what the approved workload produced, not that an unknown provider is inherently trustworthy.
