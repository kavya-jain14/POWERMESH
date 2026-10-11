/** Display helpers shared by contracts-draft and UI. Pure functions, no React. */

export function shortHash(value: string, head = 8, tail = 4): string {
  const idx = value.indexOf(":");
  const algo = idx >= 0 ? value.slice(0, idx + 1) : "";
  const hash = idx >= 0 ? value.slice(idx + 1) : value;
  if (hash.length <= head + tail + 1) return value;
  return `${algo}${hash.slice(0, head)}…${hash.slice(-tail)}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 10 || Number.isInteger(v) ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

/** For values a source may not report: never print an invented number. */
export function formatMaybeBytes(bytes: number | null | undefined): string {
  return bytes == null ? "Not reported" : formatBytes(bytes);
}

/** "3 files · 7.3 MB", or "3 files" when sizes weren't reported. */
export function formatInputs(
  inputs: { count: number; totalBytes: number | null },
  noun = "file",
): string {
  const files = `${inputs.count} ${noun}${inputs.count === 1 ? "" : "s"}`;
  return inputs.totalBytes == null ? files : `${files} · ${formatBytes(inputs.totalBytes)}`;
}

export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return rem ? `${m}m ${rem}s` : `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
}

export function formatRelative(iso: string, now = Date.now()): string {
  const diff = Math.round((now - new Date(iso).getTime()) / 1000);
  if (diff < 5) return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function contentTypeLabel(ct: string): string {
  const map: Record<string, string> = {
    "image/png": "PNG",
    "image/jpeg": "JPEG",
    "image/webp": "WebP",
    "image/svg+xml": "SVG",
    "text/html": "HTML",
  };
  return map[ct] ?? ct;
}
