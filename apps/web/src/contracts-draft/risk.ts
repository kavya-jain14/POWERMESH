/**
 * ⚠️ DRAFT — client-side *preview* of the deterministic risk classifier (master plan §4).
 * The coordinator's policy engine is the only authority; the Composer uses this so the risk panel can
 * explain itself before submit.
 *
 * Q7: policy emits stable codes; labels come from RISK_FACT_COPY, keyed by code, which moves to
 * packages/contracts. Wording can change here without touching policy logic.
 */

import { shortHash } from "./format";
import {
  type NetworkMode,
  RISK_ORDER,
  type RiskExplanation,
  type RiskFact,
  type RiskFactCode,
  type RiskTier,
  type WorkloadDefinition,
} from "./types";

/** User-facing copy (Gargi). Keep sentences short; the effect is shown separately as icon + text. */
export const RISK_FACT_COPY: Record<RiskFactCode, string> = {
  SIGNED_DIGEST_PINNED: "Signed and pinned to an exact image digest.",
  UNSIGNED_OR_UNPINNED: "The workload image isn't signed or pinned to a digest.",
  NO_REQUESTER_CODE: "Runs only the approved workload — no requester code or commands.",
  RUNS_REQUESTER_CODE: "Runs code supplied by the requester.",
  NETWORK_OFFLINE: "No network access while running.",
  NETWORK_RESTRICTED: "Can reach approved HTTPS destinations only, through the egress gateway.",
  NETWORK_OPEN_WEB: "Open internet isn't allowed on personal devices.",
  CODE_WITH_OPEN_WEB: "Requester code combined with open internet is never allowed.",
  SECRETS_OR_DEVICES: "Needs secrets or direct device access.",
  BOUNDED_SCHEMAS: "Inputs and outputs have fixed types and size limits.",
  UNBOUNDED_SCHEMAS: "Inputs or outputs aren't bounded.",
  PRIVILEGED_EXECUTION: "Asks for privileged execution, which is never allowed.",
  HOST_FILESYSTEM_ACCESS: "Asks for files on the provider's device, which is never allowed.",
  DOCKER_SOCKET_ACCESS: "Asks for the Docker socket, which is never allowed.",
  RAW_DEVICE_ACCESS: "Asks for raw device access, which is never allowed.",
  RESOURCE_ENVELOPE_ELEVATED:
    "Asks for more CPU, memory or time than the workload's standard limits.",
  ROUTE_DEDICATED_ONLY:
    "HIGH risk jobs only run on dedicated verified nodes — never personal devices.",
};

function fact(code: RiskFactCode, effect: RiskFact["effect"], detail?: string): RiskFact {
  return { code, label: RISK_FACT_COPY[code], effect, ...(detail ? { detail } : {}) };
}

export const POLICY_VERSION = "draft-2026-10-10";

function maxTier(a: RiskTier, b: RiskTier): RiskTier {
  return RISK_ORDER.indexOf(a) >= RISK_ORDER.indexOf(b) ? a : b;
}

export function classifyRisk(
  workload: WorkloadDefinition,
  networkMode: NetworkMode,
  now = new Date(),
): RiskExplanation {
  let tier: RiskTier = "LOW";
  const facts: RiskFact[] = [];

  // 1. Signed and digest-pinned?
  if (workload.signatureVerified && workload.imageDigest.startsWith("sha256:")) {
    facts.push(
      fact(
        "SIGNED_DIGEST_PINNED",
        "lowers",
        `Signed by ${workload.publisher} · ${shortHash(workload.imageDigest)}`,
      ),
    );
  } else {
    tier = maxTier(tier, networkMode === "OPEN_WEB" ? "BLOCKED" : "HIGH");
    facts.push(fact("UNSIGNED_OR_UNPINNED", "raises"));
  }

  // 2. Requester-provided code?
  if (workload.runsRequesterCode) {
    if (networkMode === "OPEN_WEB") {
      tier = "BLOCKED";
      facts.push(fact("CODE_WITH_OPEN_WEB", "blocks"));
    } else {
      tier = maxTier(tier, "HIGH");
      facts.push(fact("RUNS_REQUESTER_CODE", "raises"));
    }
  } else {
    facts.push(fact("NO_REQUESTER_CODE", "lowers"));
  }

  // 3. Network mode.
  if (networkMode === "OFFLINE") {
    facts.push(fact("NETWORK_OFFLINE", "lowers"));
  } else if (networkMode === "RESTRICTED") {
    tier = maxTier(tier, "MEDIUM");
    facts.push(fact("NETWORK_RESTRICTED", "raises"));
  } else {
    tier = "BLOCKED";
    facts.push(fact("NETWORK_OPEN_WEB", "blocks"));
  }

  // 4. Secrets or device access.
  if (workload.needsSecrets || workload.needsDeviceAccess) {
    tier = maxTier(tier, "HIGH");
    facts.push(
      fact("SECRETS_OR_DEVICES", "raises", workload.needsSecrets ? "Secrets" : "Device access"),
    );
  }

  // 5. Bounded schemas.
  const hasNoInputs =
    workload.input.contentTypes.length === 0 &&
    workload.input.maxFiles === 0 &&
    workload.input.maxBytesPerFile === 0 &&
    workload.input.maxTotalBytes === 0;
  const hasBoundedInputs =
    workload.input.contentTypes.length > 0 &&
    workload.input.maxFiles > 0 &&
    workload.input.maxBytesPerFile > 0 &&
    workload.input.maxTotalBytes > 0;
  const hasBoundedOutput =
    workload.output.contentTypes.length > 0 && workload.output.maxBytesPerFile > 0;
  const bounded = (hasNoInputs || hasBoundedInputs) && hasBoundedOutput;
  facts.push(bounded ? fact("BOUNDED_SCHEMAS", "lowers") : fact("UNBOUNDED_SCHEMAS", "raises"));
  if (!bounded) tier = maxTier(tier, "HIGH");

  // Routing consequence, stated plainly.
  if (tier === "HIGH") {
    facts.push(fact("ROUTE_DEDICATED_ONLY", "blocks"));
  }

  return { tier, facts, policyVersion: POLICY_VERSION, decidedAt: now.toISOString() };
}
