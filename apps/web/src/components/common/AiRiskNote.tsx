"use client";

import { Icon } from "@powermesh/ui";
import { useEffect, useState } from "react";
import type { RiskExplanation } from "@/contracts-draft/types";
import styles from "./common.module.css";

interface Explanation {
  summary: string;
  reasons: string[];
  providerAdvice: string;
  source: "gemini" | "template";
  label: string;
}

const cache = new Map<string, Explanation>();

/**
 * Plain-language explanation of a policy decision, written by Gemini on the coordinator (or rule text when AI is
 * unavailable). Advisory only: the tier and facts above it come from the deterministic policy and never from this.
 */
export function AiRiskNote({
  risk,
  audience = "requester",
}: {
  risk: RiskExplanation;
  audience?: "requester" | "provider";
}) {
  const key = JSON.stringify([risk.tier, risk.facts.map((f) => [f.code, f.label])]);
  const [data, setData] = useState<Explanation | null>(cache.get(key) ?? null);
  const [failed, setFailed] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` is a stable serialisation of `risk`; depending on the object itself would refetch on every render.
  useEffect(() => {
    const cached = cache.get(key);
    if (cached) {
      setData(cached);
      return;
    }
    let live = true;
    setData(null);
    setFailed(false);
    fetch("/api/live/v1/risk/explain", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ risk }),
    })
      .then((res) =>
        res.ok
          ? (res.json() as Promise<Explanation>)
          : Promise.reject(new Error(String(res.status))),
      )
      .then((body) => {
        cache.set(key, body);
        if (live) setData(body);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key captures risk
  }, [key]);

  if (failed) return null; // the policy reasons above remain the full explanation
  return (
    <div className={styles.aiNote} aria-live="polite" aria-busy={!data}>
      <span className={styles.aiNoteLabel}>
        <Icon name={data?.source === "gemini" ? "activity" : "info"} size={14} />
        {data ? data.label : "Explaining this decision…"}
      </span>
      {data ? (
        <>
          <p>{data.summary}</p>
          {data.reasons.length > 0 ? (
            <ul>
              {data.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          ) : null}
          {audience === "provider" ? (
            <p className={styles.aiNoteAdvice}>{data.providerAdvice}</p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
