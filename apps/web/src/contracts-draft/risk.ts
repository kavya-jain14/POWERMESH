/**
 * ⚠️ DRAFT — client-side *preview* of the deterministic risk classifier (master plan §4).
 * The coordinator's policy engine (K5, Kavya) is the only authority; the Composer uses this so the
 * risk panel can explain itself before submit. Fact labels are user-facing copy (Gargi).
 */
import { RISK_ORDER, type NetworkMode, type RiskExplanation, type RiskFact, type RiskTier, type WorkloadDefinition } from "./types";
import { shortHash } from "./format";

export const POLICY_VERSION = "draft-2026-10-10";

function maxTier(a: RiskTier, b: RiskTier): RiskTier {
  return RISK_ORDER.indexOf(a) >= RISK_ORDER.indexOf(b) ? a : b;
}

export function classifyRisk(workload: WorkloadDefinition, networkMode: NetworkMode, now = new Date()): RiskExplanation {
  let tier: RiskTier = "LOW";
  const facts: RiskFact[] = [];

  // 1. Signed and digest-pinned?
  if (workload.signatureVerified && workload.imageDigest.startsWith("sha256:")) {
    facts.push({
      code: "SIGNED_DIGEST_PINNED",
      label: `Signed by ${workload.publisher} and pinned to ${shortHash(workload.imageDigest)}.`,
      effect: "lowers",
    });
  } else {
    tier = maxTier(tier, networkMode === "OPEN_WEB" ? "BLOCKED" : "HIGH");
    facts.push({ code: "UNSIGNED_OR_UNPINNED", label: "The workload image isn't signed or pinned to a digest.", effect: "raises" });
  }

  // 2. Requester-provided code?
  if (workload.runsRequesterCode) {
    if (networkMode === "OPEN_WEB") {
      tier = "BLOCKED";
      facts.push({ code: "CODE_WITH_OPEN_WEB", label: "Requester code combined with open internet is never allowed.", effect: "blocks" });
    } else {
      tier = maxTier(tier, "HIGH");
      facts.push({ code: "RUNS_REQUESTER_CODE", label: "Runs code supplied by the requester.", effect: "raises" });
    }
  } else {
    facts.push({ code: "NO_REQUESTER_CODE", label: "Runs only the approved workload — no requester code or commands.", effect: "lowers" });
  }

  // 3. Network mode.
  if (networkMode === "OFFLINE") {
    facts.push({ code: "NETWORK_OFFLINE", label: "No network access while running.", effect: "lowers" });
  } else if (networkMode === "RESTRICTED") {
    tier = maxTier(tier, "MEDIUM");
    facts.push({
      code: "NETWORK_RESTRICTED",
      label: "Can reach approved HTTPS destinations only, through the egress gateway.",
      effect: "raises",
    });
  } else {
    tier = "BLOCKED";
    facts.push({ code: "NETWORK_OPEN_WEB", label: "Open internet isn't allowed on personal devices.", effect: "blocks" });
  }

  // 4. Secrets or device access.
  if (workload.needsSecrets || workload.needsDeviceAccess) {
    tier = maxTier(tier, "HIGH");
    facts.push({
      code: "SECRETS_OR_DEVICES",
      label: workload.needsSecrets ? "Needs secrets to run." : "Needs direct device access.",
      effect: "raises",
    });
  }

  // 5. Bounded schemas.
  const bounded = workload.inputSchema.maxFiles > 0 && workload.inputSchema.maxTotalBytes > 0 && workload.outputSchema.contentTypes.length > 0;
  facts.push(
    bounded
      ? { code: "BOUNDED_SCHEMAS", label: "Inputs and outputs have fixed types and size limits.", effect: "lowers" }
      : { code: "UNBOUNDED_SCHEMAS", label: "Inputs or outputs aren't bounded.", effect: "raises" },
  );
  if (!bounded) tier = maxTier(tier, "HIGH");

  // Routing consequence, stated plainly.
  if (tier === "HIGH") {
    facts.push({ code: "ROUTE_DEDICATED_ONLY", label: "HIGH risk jobs only run on dedicated verified nodes — never personal devices.", effect: "blocks" });
  }

  return { tier, facts, policyVersion: POLICY_VERSION, decidedAt: now.toISOString() };
}
