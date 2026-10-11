import { isTerminal, type JobEvent, STREAM_TIMING } from "@/contracts-draft/types";
import { currentUser, errorResponse } from "@/mock/http";
import {
  assertCoordinatorUp,
  assertOfflineDemoEnabled,
  eventView,
  getEvents,
  getJob,
  registerStream,
  state,
  subscribe,
} from "@/mock/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEARTBEAT_MS = STREAM_TIMING.heartbeatSeconds * 1000;

/**
 * SSE job stream (Q18): `id` = per-job seq for Last-Event-ID resume (wins over ?after=),
 * `event` = state | progress | log. Heartbeats every 5 s (Q19) are sent as a named, un-numbered
 * `heartbeat` event — not a comment line, which EventSource hides from scripts (follow-ups F3).
 * A finished job replays its history and then the stream closes.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let user: Awaited<ReturnType<typeof currentUser>>;
  try {
    assertOfflineDemoEnabled();
    user = await currentUser();
    assertCoordinatorUp();
    getJob(id, user);
  } catch (err) {
    return errorResponse(err);
  }

  const url = new URL(req.url);
  const lastId =
    Number(req.headers.get("last-event-id") ?? url.searchParams.get("after") ?? 0) || 0;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };
      const send = (e: JobEvent) =>
        write(`id: ${e.seq}\nevent: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);

      write("retry: 2000\n\n");
      getEvents(id, user, lastId).forEach(send);
      const current = state().jobs.get(id);
      if (current && isTerminal(current.state)) {
        closed = true;
        controller.close();
        return;
      }
      const unsubscribe = subscribe(id, (e) => send(eventView(e, user)));
      const heartbeat = setInterval(() => {
        const job = state().jobs.get(id);
        write(
          `event: heartbeat\ndata: ${JSON.stringify({ at: new Date().toISOString(), state: job?.state })}\n\n`,
        );
      }, HEARTBEAT_MS);

      function cleanup() {
        if (closed) return;
        closed = true;
        unsubscribe();
        clearInterval(heartbeat);
        unregister();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
      const unregister = registerStream(cleanup);
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
