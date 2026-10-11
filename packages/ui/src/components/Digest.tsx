"use client";

import { useState } from "react";
import styles from "./Digest.module.css";
import { Icon } from "./Icon";

/** Shortens "sha256:abcdef…" to "sha256:abcdef12…9f3e" for display. */
export function shortDigest(value: string, head = 8, tail = 4): string {
  const [algo, hash] = value.includes(":")
    ? (value.split(":", 2) as [string, string])
    : ["", value];
  if (hash.length <= head + tail + 1) return value;
  return `${algo ? `${algo}:` : ""}${hash.slice(0, head)}…${hash.slice(-tail)}`;
}

/** Monospace hash / id with a copy button. The full value is in the title and copied on click. */
export function Digest({
  value,
  label = "digest",
  short = true,
}: {
  value: string;
  label?: string;
  short?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be unavailable (permissions / insecure context); the value stays selectable.
    }
  };
  return (
    <span className={styles.digest}>
      <code className={styles.code} title={value}>
        {short ? shortDigest(value) : value}
      </code>
      <button
        type="button"
        className={styles.copy}
        onClick={copy}
        aria-label={copied ? `Copied ${label}` : `Copy ${label}`}
      >
        <Icon name={copied ? "check" : "copy"} size={14} />
      </button>
    </span>
  );
}
