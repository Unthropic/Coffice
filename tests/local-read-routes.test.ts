import { beforeEach, describe, expect, it, vi } from "vitest";

const snapshot = {
  source: { freshness: "fresh" },
  projects: [],
  tasks: [],
  diagnostics: [],
};

const mocks = vi.hoisted(() => ({
  getCodexSnapshot: vi.fn(),
}));

vi.mock("../src/lib/snapshot", () => ({
  DEFAULT_POLL_INTERVAL_MS: 15,
  getCodexSnapshot: mocks.getCodexSnapshot,
}));

import {
  GET as getEvents,
  HEAD as headEvents,
} from "../src/app/api/events/route";
import { GET as getSnapshot } from "../src/app/api/snapshot/route";

type ReadRoute = (request: Request) => Promise<Response> | Response;

const routes: Array<[string, ReadRoute]> = [
  ["snapshot", getSnapshot],
  ["events", getEvents],
];

function request(
  path: string,
  headers: Record<string, string> = {},
  signal?: AbortSignal,
) {
  return new Request(`http://localhost:3003/api/${path}`, { headers, signal });
}

describe("local read routes", () => {
  beforeEach(() => {
    mocks.getCodexSnapshot.mockReset();
    mocks.getCodexSnapshot.mockResolvedValue(snapshot);
  });

  it("serves a direct snapshot GET without caching", async () => {
    const response = await getSnapshot(
      request("snapshot", { Host: "127.0.0.1:3003" }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store, max-age=0");
    await expect(response.json()).resolves.toEqual(snapshot);
  });

  it("preserves the event stream contract for an allowed local GET", async () => {
    const abort = new AbortController();
    const response = await getEvents(
      request(
        "events",
        {
          Host: "localhost:3003",
          Origin: "http://localhost:3003",
          "Sec-Fetch-Site": "same-origin",
        },
        abort.signal,
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(
      "text/event-stream; charset=utf-8",
    );
    expect(response.headers.get("Cache-Control")).toBe(
      "no-store, no-transform",
    );
    expect(response.headers.get("Connection")).toBe("keep-alive");
    expect(response.headers.get("X-Accel-Buffering")).toBe("no");

    const first = await response.body?.getReader().read();
    expect(new TextDecoder().decode(first?.value)).toContain("event: snapshot");
    abort.abort();
  });

  it("stops polling safely when the response reader cancels mid-refresh", async () => {
    let resolveFirst: ((value: typeof snapshot) => void) | undefined;
    mocks.getCodexSnapshot
      .mockImplementationOnce(
        () =>
          new Promise<typeof snapshot>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValue(snapshot);
    const unhandled: unknown[] = [];
    const recordUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", recordUnhandled);

    try {
      const response = await getEvents(
        request("events", { Host: "127.0.0.1:3003" }),
      );
      const reader = response.body?.getReader();
      const pendingRead = reader?.read();
      expect(mocks.getCodexSnapshot).toHaveBeenCalledTimes(1);

      await reader?.cancel();
      resolveFirst?.(snapshot);
      await expect(pendingRead).resolves.toMatchObject({ done: true });
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mocks.getCodexSnapshot).toHaveBeenCalledTimes(1);
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", recordUnhandled);
    }
  });

  it("closes immediately when the request signal is already aborted", async () => {
    const abort = new AbortController();
    abort.abort();

    const response = await getEvents(
      request("events", { Host: "127.0.0.1:3003" }, abort.signal),
    );
    const result = await response.body?.getReader().read();

    expect(result).toMatchObject({ done: true });
    expect(mocks.getCodexSnapshot).not.toHaveBeenCalled();
  });

  it("answers a local event-stream HEAD without polling metadata", async () => {
    const response = headEvents(
      request("events", {
        Host: "127.0.0.1:3003",
        "Sec-Fetch-Site": "none",
      }),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("Cache-Control")).toBe("no-store, max-age=0");
    await expect(response.text()).resolves.toBe("");
    expect(mocks.getCodexSnapshot).not.toHaveBeenCalled();
  });

  it("rejects a non-local event-stream HEAD without polling metadata", async () => {
    const response = headEvents(request("events", { Host: "example.test" }));

    expect(response.status).toBe(403);
    expect(response.headers.get("Cache-Control")).toBe("no-store, max-age=0");
    expect(mocks.getCodexSnapshot).not.toHaveBeenCalled();
  });

  it.each(routes)(
    "rejects hostile Host authority at the %s route without reading metadata",
    async (path, route) => {
      const response = await route(
        request(path, {
          Host: "example.test",
          Origin: "http://example.test",
        }),
      );

      expect(response.status).toBe(403);
      expect(response.headers.get("Cache-Control")).toBe("no-store, max-age=0");
      await expect(response.json()).resolves.toEqual({
        error: "Local request required.",
        code: "FORBIDDEN",
      });
      expect(mocks.getCodexSnapshot).not.toHaveBeenCalled();
    },
  );

  it.each(routes)(
    "rejects a mismatched Origin at the %s route",
    async (path, route) => {
      const response = await route(
        request(path, {
          Host: "127.0.0.1:3003",
          Origin: "http://localhost:3003",
        }),
      );

      expect(response.status).toBe(403);
      expect(mocks.getCodexSnapshot).not.toHaveBeenCalled();
    },
  );

  it.each(routes)(
    "rejects cross-site browser traffic at the %s route",
    async (path, route) => {
      const response = await route(
        request(path, {
          Host: "127.0.0.1:3003",
          Origin: "http://127.0.0.1:3003",
          "Sec-Fetch-Site": "cross-site",
        }),
      );

      expect(response.status).toBe(403);
      expect(mocks.getCodexSnapshot).not.toHaveBeenCalled();
    },
  );
});
