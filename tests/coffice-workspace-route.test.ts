import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  CofficeWorkspaceConflictError,
  type LoadedCofficeWorkspace,
} from "../src/lib/coffice-workspace-store";
import {
  createEmptyCofficeWorkspace,
  MAX_COFFICE_WORKSPACE_MUTATION_BYTES,
} from "../src/lib/coffice-workspace";

const store = vi.hoisted(() => ({
  load: vi.fn(),
  mutate: vi.fn(),
}));

vi.mock("../src/lib/coffice-workspace-store", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/lib/coffice-workspace-store")>();
  return {
    ...actual,
    CofficeWorkspaceStore: class {
      load = store.load;
      mutate = store.mutate;
    },
  };
});

import { GET, PATCH } from "../src/app/api/workspace/route";

const NOW = "2026-08-11T12:00:00.000Z";

function loaded(revision = 0): LoadedCofficeWorkspace {
  return {
    workspace: { ...createEmptyCofficeWorkspace(NOW), revision },
    recovery: { kind: "none" },
  };
}

function mutationRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://127.0.0.1:3003/api/workspace", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Origin: "http://127.0.0.1:3003",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function readRequest(url = "http://127.0.0.1:3003/api/workspace") {
  return new Request(url);
}

describe("workspace API", () => {
  beforeEach(() => {
    store.load.mockReset();
    store.mutate.mockReset();
  });

  it("returns the local workspace with recovery metadata and no-store", async () => {
    store.load.mockResolvedValue(loaded());

    const response = await GET(readRequest());

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store, max-age=0");
    await expect(response.json()).resolves.toMatchObject({
      workspace: { revision: 0 },
      recovery: { kind: "none" },
      persistence: { kind: "local", persistent: true },
    });
  });

  it("accepts one exact validated mutation envelope", async () => {
    store.mutate.mockResolvedValue(loaded(1));
    const mutation = { type: "project.remove", projectId: "project-a" };

    const response = await PATCH(
      mutationRequest({
        expectedRevision: 0,
        mutationId: "mutation-a",
        mutation,
      }),
    );

    expect(response.status).toBe(200);
    expect(store.mutate).toHaveBeenCalledWith(0, "mutation-a", mutation);
    await expect(response.json()).resolves.toMatchObject({
      workspace: { revision: 1 },
      persistence: { persistent: true },
    });
  });

  it("uses the browser Host header when the framework normalizes request.url", async () => {
    store.mutate.mockResolvedValue(loaded(1));
    const body = {
      expectedRevision: 0,
      mutationId: "normalized-url",
      mutation: { type: "project.remove", projectId: "project-a" },
    };

    const response = await PATCH(
      new Request("http://localhost:3003/api/workspace", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Host: "127.0.0.1:3003",
          Origin: "http://127.0.0.1:3003",
        },
        body: JSON.stringify(body),
      }),
    );

    expect(response.status).toBe(200);
    expect(store.mutate).toHaveBeenCalledWith(
      0,
      "normalized-url",
      body.mutation,
    );
  });

  it("accepts a valid attention import larger than the old 64 KiB transport cap", async () => {
    store.mutate.mockResolvedValue(loaded(1));
    const dispositions = Object.fromEntries(
      Array.from({ length: 260 }, (_, index) => [
        `${index.toString().padStart(3, "0")}-${"event".repeat(55)}`,
        { kind: "reviewed", at: NOW },
      ]),
    );
    const mutation = {
      type: "attention.import",
      importedAt: NOW,
      state: {
        version: 2,
        initializedAt: NOW,
        dispositions,
        snoozedUntil: {},
      },
    } as const;
    const body = {
      expectedRevision: 0,
      mutationId: "large-attention-import",
      mutation,
    };
    expect(
      new TextEncoder().encode(JSON.stringify(body)).byteLength,
    ).toBeGreaterThan(64 * 1024);

    const response = await PATCH(mutationRequest(body));

    expect(response.status).toBe(200);
    expect(store.mutate).toHaveBeenCalledWith(
      0,
      "large-attention-import",
      mutation,
    );
  });

  it("requires an exact matching Origin for PATCH but not GET", async () => {
    store.load.mockResolvedValue(loaded());
    const body = {
      expectedRevision: 0,
      mutationId: "origin-required",
      mutation: { type: "project.remove", projectId: "project-a" },
    };

    const patchResponse = await PATCH(
      new Request("http://127.0.0.1:3003/api/workspace", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
    const getResponse = await GET(readRequest());

    expect(patchResponse.status).toBe(403);
    expect(getResponse.status).toBe(200);
    expect(store.mutate).not.toHaveBeenCalled();
  });

  it("stream-counts and cancels an undeclared oversized PATCH body", async () => {
    let cancelled = false;
    let pull = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(
          new Uint8Array(
            pull++ === 0 ? MAX_COFFICE_WORKSPACE_MUTATION_BYTES : 1,
          ),
        );
      },
      cancel() {
        cancelled = true;
      },
    });
    const request = new Request("http://127.0.0.1:3003/api/workspace", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://127.0.0.1:3003",
      },
      body,
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    const response = await PATCH(request);

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      code: "PAYLOAD_TOO_LARGE",
    });
    expect(cancelled).toBe(true);
    expect(store.mutate).not.toHaveBeenCalled();
  });

  it("cancels a declared oversized PATCH body before reading it", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array([1]));
      },
      cancel() {
        cancelled = true;
      },
    });
    const request = new Request("http://127.0.0.1:3003/api/workspace", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": String(MAX_COFFICE_WORKSPACE_MUTATION_BYTES + 1),
        Origin: "http://127.0.0.1:3003",
      },
      body,
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    const response = await PATCH(request);

    expect(response.status).toBe(413);
    expect(cancelled).toBe(true);
    expect(store.mutate).not.toHaveBeenCalled();
  });

  it("rejects cross-origin, non-JSON, oversized, and non-exact requests", async () => {
    const valid = {
      expectedRevision: 0,
      mutationId: "mutation-a",
      mutation: { type: "project.remove", projectId: "project-a" },
    };
    expect(
      (await PATCH(mutationRequest(valid, { Origin: "http://example.test" })))
        .status,
    ).toBe(403);
    expect(
      (
        await PATCH(
          new Request("http://127.0.0.1:3003/api/workspace", {
            method: "PATCH",
            headers: {
              "Content-Type": "text/plain",
              Origin: "http://127.0.0.1:3003",
            },
            body: JSON.stringify(valid),
          }),
        )
      ).status,
    ).toBe(415);
    expect(
      (await PATCH(mutationRequest({ ...valid, unexpected: true }))).status,
    ).toBe(400);
    expect(
      (
        await PATCH(
          mutationRequest("x".repeat(MAX_COFFICE_WORKSPACE_MUTATION_BYTES + 1)),
        )
      ).status,
    ).toBe(413);
    expect(store.mutate).not.toHaveBeenCalled();
    expect(
      (await GET(readRequest("http://example.test/api/workspace"))).status,
    ).toBe(403);
  });

  it("returns the current state on a revision conflict without retrying", async () => {
    store.mutate.mockRejectedValue(new CofficeWorkspaceConflictError(0, 3));
    store.load.mockResolvedValue(loaded(3));

    const response = await PATCH(
      mutationRequest({
        expectedRevision: 0,
        mutationId: "mutation-a",
        mutation: { type: "project.remove", projectId: "project-a" },
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "WORKSPACE_REVISION_CONFLICT",
      workspace: { revision: 3 },
      persistence: { persistent: true },
    });
    expect(store.mutate).toHaveBeenCalledTimes(1);
  });

  it("returns a safe unavailable response without exposing failure details", async () => {
    store.load.mockRejectedValue(
      new Error("C:\\private\\workspace-v1.json permission denied"),
    );

    const response = await GET(readRequest());
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(body).toContain("Coffice workspace is unavailable.");
    expect(body).not.toContain("private");
    expect(body).not.toContain("permission denied");
  });
});
