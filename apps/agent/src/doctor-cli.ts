import { runAgentDoctor } from "./doctor";

const coordinatorUrl = process.env.POWERMESH_COORDINATOR_URL;
if (!coordinatorUrl) throw new Error("POWERMESH_COORDINATOR_URL is required");

const requireGpu = process.argv.includes("--require-gpu");
const report = await runAgentDoctor({
  coordinatorUrl,
  requireGpu,
  gpuProbeImage: process.env.POWERMESH_GPU_PROBE_IMAGE,
});

for (const check of report.checks) {
  process.stdout.write(`${check.ok ? "PASS" : "FAIL"}  ${check.label}: ${check.detail}\n`);
}
process.stdout.write(
  report.ready
    ? "READY: this provider can reach the coordinator and execute the selected profile.\n"
    : "BLOCKED: fix every failed check before the two-laptop demo.\n",
);
if (!report.ready) process.exitCode = 1;
