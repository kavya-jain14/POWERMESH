import { jobStates } from "@powermesh/contracts";
import { type JobEvent, STREAM_TIMING } from "@/contracts-draft/types";
import {
  BridgeError,
  COORDINATOR_TERMINAL,
  type CoordinatorJob,
  errorResponse,
  fetchJob,
} from "@/server/coordinator";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const POLL_MS = 2000;
const HEARTBEAT_MS = STREAM_TIMING.heartbeatSeconds * 1000;

/**
 * Job stream for the Flight Recorder. API v0 has no event endpoint (job_events is stored but not
 * readable), so this polls GET /v1/jobs/:id and emits a `state` event each time the state changes.
 *
 * - Only states the coordinator actually reported are emitted; nothing is back-filled or guessed.
 * - `seq` is the state's position in the contracts' lifecycle order, so a reconnect with
 *   Last-Event-ID never re-renders a state the browser already has.
 * - Un-numbered `heartbeat` events every 10 s (Q19) keep the UI's stale detection honest (follow-ups F3).
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let first: CoordinatorJob;
  try {
    first = await fetchJob(id, { fresh: true });
  } catch (err) {
    return errorResponse(err);
  }

  const url = new URL(req.url);
  const resumeAfter =
    Number(req.headers.get("last-event-id") ?? url.searchParams.get("after") ?? 0) || 0;
  const encoder = new TextEncoder();
  const seqOf = (state: CoordinatorJob["state"]) => jobStates.indexOf(state) + 1;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let lastState: CoordinatorJob["state"] | undefined;
      let poller: ReturnType<typeof setInterval> | undefined;
      let heartbeat: ReturnType<typeof setInterval> | undefined;

      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };

      const emit = (job: CoordinatorJob) => {
        if (job.state === lastState) return;
        const prevState = lastState;
        lastState = job.state;
        const seq = seqOf(job.state);
        if (seq > resumeAfter) {
          const event: JobEvent = {
            seq,
            id: `${job.id}:${job.state}`,
            jobId: job.id,
            type: "state",
            state: job.state,
            prevState,
            message: "Reported by the coordinator.",
            actor: { role: "system", label: "Coordinator" },
            at: job.updatedAt,
            correlationId: "",
            attempt: 1,
          };
          write(`id: ${seq}\nevent: state\ndata: ${JSON.stringify(event)}\n\n`);
        }
        if (COORDINATOR_TERMINAL.includes(job.state)) cleanup();
      };

      function cleanup() {
        if (closed) return;
        closed = true;
        clearInterval(poller);
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }

      write("retry: 2000\n\n");
      emit(first);
      if (closed) return;

      poller = setInterval(() => {
        fetchJob(id)
          .then(emit)
          .catch((err) => {
            // Coordinator down: stop sending heartbeats so the UI shows "stale" and reconnects later.
            if (err instanceof BridgeError) cleanup();
          });
      }, POLL_MS);
      heartbeat = setInterval(() => {
        write(
          `event: heartbeat\ndata: ${JSON.stringify({ at: new Date().toISOString(), state: lastState })}\n\n`,
        );
      }, HEARTBEAT_MS);
      req.signal.addEventListener("abort", cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
