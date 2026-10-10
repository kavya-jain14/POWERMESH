# ADR-002: Loopback Agent Console and Local Control Path

- Status: Proposed
- Date: 2026-10-10
- Owners: Kavya (security/runtime), Gargi (provider UX)

## Context

The provider must be able to stop a workload within five seconds even when the coordinator is unreachable. A coordinator-hosted page calling `127.0.0.1` depends on browser CORS and Private Network Access behaviour and creates an unnecessary cross-origin authentication surface.

## Decision

The Agent serves the Provider Console and its control API on `http://127.0.0.1:4765`. It must bind only to loopback and reject non-local `Host` and `Origin` values.

The local API owns stop, availability, and offer decisions:

- `GET /v1/local/state`
- `POST /v1/local/stop`
- `POST /v1/local/availability`
- `POST /v1/local/offers/:id/decision`

Initial pairing issues an `HttpOnly`, `SameSite=Strict` local session cookie. The token is never placed in a query string, local storage, or frontend JavaScript. The Agent mirrors signed decisions and safe state to the coordinator over its outbound authenticated connection.

The local stop path revokes the workload network, requests graceful termination, forcibly kills the process/container if required, and verifies process death without waiting for coordinator acknowledgement.

## Consequences

- Emergency stop remains available during coordinator or internet failure.
- The Provider Console avoids cross-origin loopback requests and browser PNA exceptions.
- Provider UI assets must ship with the Agent and be versioned with its local API.
- Remote access to the provider console is intentionally unsupported in v0.
- The local session, origin checks, loopback binding, and stop timing require integration tests before real execution is enabled.
