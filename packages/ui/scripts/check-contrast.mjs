// WCAG contrast check for PowerMesh tokens (G2 / G12).
//   node packages/ui/scripts/check-contrast.mjs
// Parses tokens.css and checks every text/background pairing the components actually use.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const css = readFileSync(path.join(here, "../src/tokens.css"), "utf8");
const tokens = Object.fromEntries([...css.matchAll(/--(pm-[\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]));

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

// [foreground, background, minimum, note]
const pairs = [
  ["pm-ink", "pm-paper", 4.5, "body text"],
  ["pm-ink", "pm-surface", 4.5, "body text on panels"],
  ["pm-ink-2", "pm-paper", 4.5, "secondary text"],
  ["pm-ink-3", "pm-paper", 4.5, "muted text"],
  ["pm-ink-3", "pm-surface", 4.5, "muted text on panels"],
  ["pm-ink-3", "pm-surface-sunken", 4.5, "muted text in wells / kill bar"],
  ["pm-ink-2", "pm-surface-sunken", 4.5, "table headers"],
  ["pm-on-accent", "pm-accent", 4.5, "primary button / active nav"],
  ["pm-on-accent", "pm-accent-hover", 4.5, "primary button hover"],
  ["pm-on-accent", "pm-accent-press", 4.5, "primary button pressed"],
  ["pm-accent", "pm-paper", 4.5, "accent text on page"],
  ["pm-accent-text", "pm-surface-sunken", 4.5, "kill bar accent"],
  ["pm-ink", "pm-accent-tint", 4.5, "selected choice / accent panel"],
  ["pm-ink-3", "pm-accent-tint", 4.5, "muted text in accent panel"],
  ["pm-on-danger", "pm-danger-fill", 4.5, "danger button"],
  ["pm-on-danger", "pm-danger-fill-hover", 4.5, "danger button hover"],
  ["pm-success", "pm-success-tint", 4.5, "success badge"],
  ["pm-info", "pm-info-tint", 4.5, "info badge"],
  ["pm-warning", "pm-warning-tint", 4.5, "warning badge"],
  ["pm-danger", "pm-danger-tint", 4.5, "danger badge"],
  ["pm-neutral", "pm-neutral-tint", 4.5, "neutral badge"],
  ["pm-ink", "pm-success-tint", 4.5, "healthy status card"],
  ["pm-ink", "pm-warning-tint", 4.5, "degraded status card"],
  ["pm-ink", "pm-danger-tint", 4.5, "incident status card"],
  ["pm-success", "pm-surface", 4.5, "success text"],
  ["pm-danger", "pm-surface", 4.5, "error text"],
  ["pm-danger", "pm-paper", 4.5, "error text on page"],
  ["pm-warning", "pm-surface", 4.5, "warning text"],
  ["pm-info", "pm-surface", 4.5, "info text"],
  ["pm-risk-low-fg", "pm-risk-low-bg", 4.5, "LOW risk"],
  ["pm-risk-medium-fg", "pm-risk-medium-bg", 4.5, "MEDIUM risk"],
  ["pm-risk-high-fg", "pm-risk-high-bg", 4.5, "HIGH risk"],
  ["pm-risk-blocked-fg", "pm-risk-blocked-bg", 4.5, "BLOCKED risk"],
  ["pm-ink-3", "pm-surface", 3, "input borders (non-text, 3:1)"],
  ["pm-danger-fill", "pm-paper", 3, "kill bar border (non-text, 3:1)"],
];

let failed = 0;
for (const [fg, bg, min, note] of pairs) {
  const r = ratio(tokens[fg], tokens[bg]);
  const ok = r >= min;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${r.toFixed(2).padStart(5)}:1  (min ${min})  ${fg} on ${bg} — ${note}`);
}
console.log(failed ? `\n${failed} pairing(s) below WCAG AA.` : "\nAll pairings meet WCAG AA.");
process.exit(failed ? 1 : 0);
