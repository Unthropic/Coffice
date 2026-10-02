import { assertLocalRequest } from "../../../lib/local-request-security";
import {
  DEFAULT_POLL_INTERVAL_MS,
  getCodexSnapshot,
} from "../../../lib/snapshot";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const encoder = new TextEncoder();
const MAX_STREAM_LIFETIME_MS = 55_000;
const FORBIDDEN_HEADERS = { "Cache-Control": "no-store, max-age=0" };

function event(name: string, data: unknown): Uint8Array {
  return encoder.encode(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
}

function localFailure(request: Request): Response | undefined {
  try {
    assertLocalRequest(request, false);
    return undefined;
  } catch {
    return Response.json(
      { error: "Local request required.", code: "FORBIDDEN" },
      {
        status: 403,
        headers: FORBIDDEN_HEADERS,
      },
    );
  }
}

export function HEAD(request: Request) {
  const failure = localFailure(request);
  if (failure) return failure;
  return new Response(null, {
    status: 204,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

export async function GET(request: Request) {
  const failure = localFailure(request);
  if (failure) return failure;

  let cleanupStream: ((closeController: boolean) => void) | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let stopped = false;
      let lastPayload = "";
      let pushInFlight = false;
      const timers: {
        interval?: ReturnType<typeof setInterval>;
        lifetime?: ReturnType<typeof setTimeout>;
      } = {};
      const abortHandler = () => cleanup(true);

      function cleanup(closeController: boolean) {
        if (stopped) return;
        stopped = true;
        if (timers.interval) clearInterval(timers.interval);
        if (timers.lifetime) clearTimeout(timers.lifetime);
        request.signal.removeEventListener("abort", abortHandler);
        if (closeController) {
          try {
            controller.close();
          } catch {
            // A concurrent consumer cancellation already owns stream closure.
          }
        }
      }
      cleanupStream = cleanup;

      const enqueue = (payload: Uint8Array): boolean => {
        if (stopped) return false;
        try {
          controller.enqueue(payload);
          return true;
        } catch {
          cleanup(false);
          return false;
        }
      };

      const pushSnapshot = async () => {
        if (stopped || pushInFlight) return;
        pushInFlight = true;
        try {
          const snapshot = await getCodexSnapshot();
          if (stopped) return;
          const comparable = JSON.stringify({
            source: snapshot.source,
            projects: snapshot.projects,
            tasks: snapshot.tasks,
            diagnostics: snapshot.diagnostics,
          });
          if (comparable !== lastPayload) {
            lastPayload = comparable;
            enqueue(event("snapshot", snapshot));
          } else {
            enqueue(event("heartbeat", { at: new Date().toISOString() }));
          }
        } catch {
          if (!stopped) {
            enqueue(
              event("source-error", {
                code: "CODEX_SOURCE_UNAVAILABLE",
                at: new Date().toISOString(),
              }),
            );
          }
        } finally {
          pushInFlight = false;
        }
      };

      if (request.signal.aborted) {
        cleanup(true);
        return;
      }
      request.signal.addEventListener("abort", abortHandler, { once: true });

      timers.interval = setInterval(
        () => void pushSnapshot(),
        DEFAULT_POLL_INTERVAL_MS,
      );
      timers.lifetime = setTimeout(() => cleanup(true), MAX_STREAM_LIFETIME_MS);
      void pushSnapshot();
    },
    cancel() {
      cleanupStream?.(false);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
