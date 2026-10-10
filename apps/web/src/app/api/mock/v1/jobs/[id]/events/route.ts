import { currentUser, errorResponse } from "@/mock/http";
import { assertCoordinatorUp, eventView, getEvents, getJob, registerStream, state, subscribe } from "@/mock/store";
import type { JobEvent } from "@/contracts-draft/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEARTBEAT_MS = 5000;

/**
 * SSE job stream (proposal G1 §6 Q5): `id` = per-job seq for Last-Event-ID resume,
 * `event` = state | progress | log; plus un-numbered `heartbeat` events so the UI can detect staleness.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let user;
  try {
    user = await currentUser();
    assertCoordinatorUp();
    getJob(id, user);
  } catch (err) {
    return errorResponse(err);
  }

  const url = new URL(req.url);
  const lastId = Number(req.headers.get("last-event-id") ?? url.searchParams.get("after") ?? 0) || 0;
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
      const send = (e: JobEvent) => write(`id: ${e.seq}\nevent: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);

      write("retry: 2000\n\n");
      getEvents(id, user, lastId).forEach(send);
      const unsubscribe = subscribe(id, (e) => send(eventView(e, user)));
      const heartbeat = setInterval(() => {
        const job = state().jobs.get(id);
        write(`event: heartbeat\ndata: ${JSON.stringify({ at: new Date().toISOString(), state: job?.state })}\n\n`);
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
