"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api } from "./api";
import { STREAM_TIMING, isTerminal, type Job, type JobEvent } from "@/contracts-draft/types";

/* ── Polling resource ───────────────────────────────────────────────────── */

export interface Resource<T> {
  data: T | undefined;
  error: ApiError | undefined;
  /** True only before the first response. */
  loading: boolean;
  /** Last successful response time; data older than this + interval is stale. */
  updatedAt: number | undefined;
  refresh: () => Promise<void>;
  setData: (value: T) => void;
}

/**
 * Fetch and optionally poll. Keeps the last good data when a refresh fails so screens can show
 * "stale" instead of blanking out (master plan §6: distinguish outage from empty).
 */
export function useResource<T>(fetcher: () => Promise<T>, { intervalMs, key }: { intervalMs?: number; key?: string } = {}): Resource<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<ApiError>();
  const [updatedAt, setUpdatedAt] = useState<number>();
  const [loading, setLoading] = useState(true);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const refresh = useCallback(async () => {
    try {
      const next = await fetcherRef.current();
      setData(next);
      setError(undefined);
      setUpdatedAt(Date.now());
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, "INTERNAL", "Unexpected error."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    void refresh();
    if (!intervalMs) return;
    const t = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, intervalMs);
    return () => window.clearInterval(t);
  }, [refresh, intervalMs, key]);

  const set = useCallback((value: T) => {
    setData(value);
    setUpdatedAt(Date.now());
    setError(undefined);
  }, []);

  return { data, error, loading, updatedAt, refresh, setData: set };
}

/* ── Job event stream (G7) ──────────────────────────────────────────────── */

export type StreamStatus = "connecting" | "live" | "reconnecting" | "stale" | "ended";

/** Q19 (packages/contracts protocolTiming): heartbeats every 5 s; stale after 12 s; reconnect backoff capped at 15 s. */
const STALE_AFTER_MS = STREAM_TIMING.staleAfterSeconds * 1000;
const MAX_BACKOFF_MS = STREAM_TIMING.maxBackoffSeconds * 1000;

export interface JobStream {
  job: Job | undefined;
  jobError: ApiError | undefined;
  events: JobEvent[];
  status: StreamStatus;
  lastMessageAt: number | undefined;
  reconnectAttempts: number;
  refreshJob: () => Promise<void>;
}

/**
 * Subscribes to GET /v1/jobs/:id/events.
 * - De-duplicates by `seq` and keeps events ordered — reconnects never double-render.
 * - Resumes from the last seen seq (Last-Event-ID natively; `?after=` on manual reconnect).
 * - Marks the stream stale after 12 s of silence (Q19); reconnects with exponential backoff.
 * - Never reconnects after a terminal state event (Q18).
 * - Never invents state: the job snapshot is re-fetched on every state event.
 */
export function useJobStream(jobId: string): JobStream {
  const [job, setJob] = useState<Job>();
  const [jobError, setJobError] = useState<ApiError>();
  const [events, setEvents] = useState<JobEvent[]>([]);
  const [status, setStatus] = useState<StreamStatus>("connecting");
  const [lastMessageAt, setLastMessageAt] = useState<number>();
  const [reconnectAttempts, setReconnectAttempts] = useState(0);

  const lastSeq = useRef(0);
  const seen = useRef(new Set<number>());
  const ended = useRef(false);

  const refreshJob = useCallback(async () => {
    try {
      const next = await api.getJob(jobId);
      setJob(next);
      setJobError(undefined);
    } catch (err) {
      setJobError(err instanceof ApiError ? err : new ApiError(0, "INTERNAL", "Unexpected error."));
    }
  }, [jobId]);

  useEffect(() => {
    let source: EventSource | null = null;
    let retryTimer: number | undefined;
    let staleTimer: number | undefined;
    let attempts = 0;
    let disposed = false;
    lastSeq.current = 0;
    seen.current = new Set();
    ended.current = false;
    setEvents([]);
    setStatus("connecting");

    const touch = () => {
      setLastMessageAt(Date.now());
      window.clearTimeout(staleTimer);
      staleTimer = window.setTimeout(() => {
        if (!disposed && !ended.current) setStatus("stale");
      }, STALE_AFTER_MS);
    };

    const ingest = (raw: MessageEvent<string>) => {
      touch();
      let event: JobEvent;
      try {
        event = JSON.parse(raw.data) as JobEvent;
      } catch {
        return;
      }
      if (seen.current.has(event.seq)) return;
      seen.current.add(event.seq);
      lastSeq.current = Math.max(lastSeq.current, event.seq);
      setEvents((prev) => [...prev, event].sort((a, b) => a.seq - b.seq));
      if (event.type === "state") {
        void refreshJob();
        if (event.state && isTerminal(event.state)) {
          ended.current = true;
          setStatus("ended");
          source?.close();
          window.clearTimeout(staleTimer);
        }
      }
    };

    const connect = () => {
      if (disposed || ended.current) return;
      source = new EventSource(api.jobEventsUrl(jobId, lastSeq.current), { withCredentials: true });
      source.onopen = () => {
        attempts = 0;
        setReconnectAttempts(0);
        setStatus("live");
        touch();
      };
      for (const type of ["state", "progress", "log"]) source.addEventListener(type, ingest as EventListener);
      source.addEventListener("heartbeat", () => {
        touch();
        setStatus((s) => (s === "stale" ? "live" : s));
      });
      source.onerror = () => {
        if (disposed || ended.current) return;
        // Native EventSource retries on its own while OPEN/CONNECTING; we take over once it gives up.
        if (source?.readyState === EventSource.CLOSED) {
          source.close();
          attempts += 1;
          setReconnectAttempts(attempts);
          setStatus("reconnecting");
          const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.min(attempts, 4));
          retryTimer = window.setTimeout(() => {
            void refreshJob();
            connect();
          }, delay);
        } else {
          setStatus("reconnecting");
        }
      };
    };

    // Snapshot first, then the stream. For a finished job the stream replays the full history and
    // closes itself when it reaches the terminal state event.
    void refreshJob().then(connect);

    return () => {
      disposed = true;
      source?.close();
      window.clearTimeout(retryTimer);
      window.clearTimeout(staleTimer);
    };
  }, [jobId, refreshJob]);

  return { job, jobError, events, status, lastMessageAt, reconnectAttempts, refreshJob };
}

/** Re-renders every `ms` so relative times and countdowns stay current. */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(t);
  }, [ms]);
  return now;
}
