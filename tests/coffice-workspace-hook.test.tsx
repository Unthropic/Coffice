// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type CofficeWorkspaceController,
  useCofficeWorkspace,
} from "../src/components/use-coffice-workspace";
import {
  ATTENTION_REVIEW_STORAGE_KEY,
  createInitialAttentionReviewState,
  serializeAttentionReviewState,
} from "../src/lib/attention-inbox";
import {
  createEmptyCofficeWorkspace,
  reduceCofficeWorkspace,
  type CofficeWorkspace,
} from "../src/lib/coffice-workspace";

const NOW = "2026-08-11T12:00:00.000Z";
const EPOCH = "1970-01-01T00:00:00.000Z";

function success(
  workspace: CofficeWorkspace,
  recovery:
    | { kind: "none" }
    | { kind: "backup"; reason: "primary-corrupt" | "primary-missing" } = {
    kind: "none",
  },
) {
  return {
    workspace,
    recovery,
    persistence: { persistent: true as const },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((onResolve) => {
    resolve = onResolve;
  });
  return { promise, resolve };
}

describe("useCofficeWorkspace", () => {
  let container: HTMLDivElement;
  let root: Root;
  let controller: CofficeWorkspaceController | null;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    window.localStorage.clear();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    controller = null;
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function Harness() {
    controller = useCofficeWorkspace();
    return null;
  }

  async function renderAndFlush() {
    await act(async () => {
      root.render(<Harness />);
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it("loads the durable workspace and exposes persistence metadata", async () => {
    const workspace = createEmptyCofficeWorkspace(NOW);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(success(workspace))),
    );

    await renderAndFlush();

    expect(controller).toMatchObject({
      ready: true,
      persistent: true,
      recovery: { kind: "none" },
      error: null,
      workspace,
    });
  });

  it("blocks every write until a recovered backup is explicitly reviewed", async () => {
    const workspace = createEmptyCofficeWorkspace(NOW);
    const persisted = { ...workspace, revision: 1 };
    const recovery = {
      kind: "backup" as const,
      reason: "primary-corrupt" as const,
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(success(workspace, recovery)))
      .mockResolvedValueOnce(jsonResponse(success(persisted, recovery)));
    vi.stubGlobal("fetch", fetchMock);

    await renderAndFlush();

    expect(controller).toMatchObject({
      persistent: false,
      recovery,
      recoveryAcknowledged: false,
    });
    await act(async () => {
      await expect(
        controller!.mutate({
          type: "project.remove",
          projectId: "project-a",
        }),
      ).resolves.toEqual({ ok: false, reason: "unavailable" });
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => controller!.acknowledgeRecovery());
    expect(controller).toMatchObject({
      persistent: true,
      recoveryAcknowledged: true,
    });
    await act(async () => {
      await controller!.mutate({
        type: "project.remove",
        projectId: "project-a",
      });
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(controller?.workspace?.revision).toBe(1);
  });

  it("migrates valid browser attention state and clears it only after confirmation", async () => {
    const workspace = createEmptyCofficeWorkspace(NOW);
    const attentionReview = createInitialAttentionReviewState(
      "2026-08-10T12:00:00.000Z",
    );
    window.localStorage.setItem(
      ATTENTION_REVIEW_STORAGE_KEY,
      serializeAttentionReviewState(attentionReview),
    );
    const persisted = reduceCofficeWorkspace(
      workspace,
      {
        type: "attention.import",
        state: attentionReview,
        importedAt: "2026-08-11T12:01:00.000Z",
      },
      "2026-08-11T12:01:00.000Z",
    );
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(success(workspace)))
      .mockResolvedValueOnce(jsonResponse(success(persisted)));
    vi.stubGlobal("fetch", fetchMock);

    await renderAndFlush();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const patch = fetchMock.mock.calls[1];
    expect(patch[0]).toBe("/api/workspace");
    expect(patch[1]).toMatchObject({ method: "PATCH" });
    expect(JSON.parse(String(patch[1]?.body))).toMatchObject({
      expectedRevision: 0,
      mutationId: expect.stringMatching(/^attention-migration-/),
      mutation: {
        type: "attention.import",
        state: attentionReview,
        importedAt: expect.any(String),
      },
    });
    expect(
      window.localStorage.getItem(ATTENTION_REVIEW_STORAGE_KEY),
    ).toBeNull();
    expect(controller?.workspace?.revision).toBe(1);
  });

  it("repairs an epoch browser baseline at the exact durable import time", async () => {
    const workspace = createEmptyCofficeWorkspace(NOW);
    const eventKey = "task-a:failed:2026-08-11T11:00:00.000Z";
    const attentionReview = {
      ...createInitialAttentionReviewState("invalid"),
      dispositions: {
        [eventKey]: { kind: "needs_review" as const, at: NOW },
      },
      snoozedUntil: {
        [eventKey]: "2099-08-11T13:00:00.000Z",
      },
    };
    window.localStorage.setItem(
      ATTENTION_REVIEW_STORAGE_KEY,
      serializeAttentionReviewState(attentionReview),
    );
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      if (init?.method !== "PATCH") {
        return jsonResponse(success(workspace));
      }
      const body = JSON.parse(String(init.body)) as {
        mutation: Parameters<typeof reduceCofficeWorkspace>[1] & {
          importedAt: string;
        };
      };
      return jsonResponse(
        success(
          reduceCofficeWorkspace(
            workspace,
            body.mutation,
            body.mutation.importedAt,
          ),
        ),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await renderAndFlush();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const body = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(body.mutation).toMatchObject({
      type: "attention.import",
      state: {
        initializedAt: body.mutation.importedAt,
        dispositions: attentionReview.dispositions,
        snoozedUntil: attentionReview.snoozedUntil,
      },
    });
    expect(body.mutation.state.initializedAt).not.toBe(EPOCH);
    expect(controller?.workspace?.attentionReview.initializedAt).toBe(
      body.mutation.importedAt,
    );
  });

  it("repairs an already-migrated durable epoch baseline without losing review state", async () => {
    const eventKey = "task-a:failed:2026-08-11T11:00:00.000Z";
    const workspace = {
      ...createEmptyCofficeWorkspace(NOW),
      attentionReview: {
        version: 2 as const,
        initializedAt: EPOCH,
        dispositions: {
          [eventKey]: { kind: "needs_review" as const, at: NOW },
        },
        snoozedUntil: {
          [eventKey]: "2099-08-11T13:00:00.000Z",
        },
      },
      migrations: { attentionReviewV2ImportedAt: NOW },
    };
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      if (init?.method !== "PATCH") {
        return jsonResponse(success(workspace));
      }
      const body = JSON.parse(String(init.body)) as {
        mutation: Parameters<typeof reduceCofficeWorkspace>[1];
      };
      return jsonResponse(
        success(
          reduceCofficeWorkspace(
            workspace,
            body.mutation,
            new Date().toISOString(),
          ),
        ),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await renderAndFlush();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const body = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(body.mutation).toMatchObject({
      type: "attention.update",
      state: {
        dispositions: workspace.attentionReview.dispositions,
        snoozedUntil: workspace.attentionReview.snoozedUntil,
      },
    });
    expect(body.mutation.state.initializedAt).not.toBe(EPOCH);
    expect(controller?.workspace?.attentionReview).toEqual(body.mutation.state);
  });

  it("keeps browser attention state when server persistence is unavailable", async () => {
    const workspace = createEmptyCofficeWorkspace(NOW);
    const attentionReview = createInitialAttentionReviewState(NOW);
    const serialized = serializeAttentionReviewState(attentionReview);
    window.localStorage.setItem(ATTENTION_REVIEW_STORAGE_KEY, serialized);
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(jsonResponse(success(workspace)))
        .mockResolvedValueOnce(
          jsonResponse(
            {
              error: "Coffice workspace is unavailable.",
              code: "COFFICE_WORKSPACE_UNAVAILABLE",
              persistence: { persistent: false },
            },
            503,
          ),
        ),
    );

    await renderAndFlush();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(window.localStorage.getItem(ATTENTION_REVIEW_STORAGE_KEY)).toBe(
      serialized,
    );
    expect(controller?.persistent).toBe(false);
  });

  it("clears a stale browser receipt when the durable import is already confirmed", async () => {
    const attentionReview = createInitialAttentionReviewState(NOW);
    const workspace = {
      ...createEmptyCofficeWorkspace(NOW),
      migrations: { attentionReviewV2ImportedAt: NOW },
    };
    window.localStorage.setItem(
      ATTENTION_REVIEW_STORAGE_KEY,
      serializeAttentionReviewState(attentionReview),
    );
    const fetchMock = vi.fn(async () => jsonResponse(success(workspace)));
    vi.stubGlobal("fetch", fetchMock);

    await renderAndFlush();
    await act(async () => {
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(controller?.workspace?.attentionReview.initializedAt).toBe(NOW);
    expect(
      window.localStorage.getItem(ATTENTION_REVIEW_STORAGE_KEY),
    ).toBeNull();
  });

  it("exposes a confirmed helper for replacing attention review state", async () => {
    const workspace = createEmptyCofficeWorkspace(NOW);
    const attentionReview = createInitialAttentionReviewState(
      "2026-08-11T12:02:00.000Z",
    );
    const persisted = reduceCofficeWorkspace(
      workspace,
      { type: "attention.update", state: attentionReview },
      "2026-08-11T12:02:00.000Z",
    );
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(success(workspace)))
      .mockResolvedValueOnce(jsonResponse(success(persisted)));
    vi.stubGlobal("fetch", fetchMock);
    await renderAndFlush();

    await act(async () => {
      await controller!.replaceAttentionReview(attentionReview);
    });

    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toMatchObject({
      mutation: { type: "attention.update", state: attentionReview },
    });
    expect(controller?.workspace?.attentionReview.initializedAt).toBe(
      "2026-08-11T12:02:00.000Z",
    );
  });

  it("writes one attention event without sending the whole review state", async () => {
    const workspace = createEmptyCofficeWorkspace(NOW);
    const persisted = reduceCofficeWorkspace(
      workspace,
      {
        type: "attention.event",
        eventKey: "task-a:completed:now",
        disposition: { kind: "reviewed", at: NOW },
        snoozedUntil: null,
      },
      NOW,
    );
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(success(workspace)))
      .mockResolvedValueOnce(jsonResponse(success(persisted)));
    vi.stubGlobal("fetch", fetchMock);
    await renderAndFlush();

    await act(async () => {
      await controller!.updateAttentionEvent(
        "task-a:completed:now",
        { kind: "reviewed", at: NOW },
        null,
      );
    });

    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toMatchObject({
      mutation: {
        type: "attention.event",
        eventKey: "task-a:completed:now",
        disposition: { kind: "reviewed", at: NOW },
        snoozedUntil: null,
      },
    });
  });

  it("adopts a conflict response without replaying the mutation", async () => {
    const workspace = createEmptyCofficeWorkspace(NOW);
    const current = { ...workspace, revision: 4 };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(success(workspace)))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error: "The workspace changed.",
            code: "WORKSPACE_REVISION_CONFLICT",
            ...success(current),
          },
          409,
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    await renderAndFlush();

    let result: Awaited<ReturnType<CofficeWorkspaceController["mutate"]>>;
    await act(async () => {
      result = await controller!.mutate({
        type: "project.remove",
        projectId: "missing",
      });
    });

    expect(result!).toEqual({ ok: false, reason: "conflict" });
    expect(controller?.workspace?.revision).toBe(4);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries one byte-identical request after an ambiguous network failure", async () => {
    const workspace = createEmptyCofficeWorkspace(NOW);
    const persisted = { ...workspace, revision: 1 };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(success(workspace)))
      .mockRejectedValueOnce(new TypeError("connection lost"))
      .mockResolvedValueOnce(jsonResponse(success(persisted)));
    vi.stubGlobal("fetch", fetchMock);
    await renderAndFlush();

    await act(async () => {
      await controller!.mutate({
        type: "project.remove",
        projectId: "project-a",
      });
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1][1]?.body).toBe(
      fetchMock.mock.calls[2][1]?.body,
    );
    expect(controller?.workspace?.revision).toBe(1);
  });

  it("serializes concurrent workspace writes against each confirmed revision", async () => {
    const workspace = createEmptyCofficeWorkspace(NOW);
    const firstResponse = deferred<Response>();
    const firstPersisted = { ...workspace, revision: 1 };
    const secondPersisted = { ...workspace, revision: 2 };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(success(workspace)))
      .mockImplementationOnce(async () => await firstResponse.promise)
      .mockResolvedValueOnce(jsonResponse(success(secondPersisted)));
    vi.stubGlobal("fetch", fetchMock);
    await renderAndFlush();

    let first!: ReturnType<CofficeWorkspaceController["mutate"]>;
    let second!: ReturnType<CofficeWorkspaceController["mutate"]>;
    await act(async () => {
      first = controller!.mutate({
        type: "project.remove",
        projectId: "project-a",
      });
      second = controller!.mutate({
        type: "project.remove",
        projectId: "project-b",
      });
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    firstResponse.resolve(jsonResponse(success(firstPersisted)));
    await act(async () => {
      await first;
      await second;
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toMatchObject({
      expectedRevision: 0,
    });
    expect(JSON.parse(String(fetchMock.mock.calls[2][1]?.body))).toMatchObject({
      expectedRevision: 1,
    });
    expect(controller?.workspace?.revision).toBe(2);
  });

  it("does not let a late refresh overwrite a confirmed newer revision", async () => {
    const workspace = createEmptyCofficeWorkspace(NOW);
    const persisted = { ...workspace, revision: 1 };
    const staleRefresh = deferred<Response>();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(success(workspace)))
      .mockImplementationOnce(async () => await staleRefresh.promise)
      .mockResolvedValueOnce(jsonResponse(success(persisted)));
    vi.stubGlobal("fetch", fetchMock);
    await renderAndFlush();

    let refresh: Promise<void>;
    await act(async () => {
      refresh = controller!.refresh();
      await controller!.mutate({
        type: "project.remove",
        projectId: "project-a",
      });
    });
    staleRefresh.resolve(jsonResponse(success(workspace)));
    await act(async () => await refresh!);

    expect(controller?.workspace?.revision).toBe(1);
  });

  it("adopts and locks a lower backup revision instead of hiding recovery", async () => {
    const workspace = createEmptyCofficeWorkspace(NOW);
    const persisted = { ...workspace, revision: 1 };
    const recovery = {
      kind: "backup" as const,
      reason: "primary-corrupt" as const,
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(success(workspace)))
      .mockResolvedValueOnce(jsonResponse(success(persisted)))
      .mockResolvedValueOnce(jsonResponse(success(workspace, recovery)));
    vi.stubGlobal("fetch", fetchMock);
    await renderAndFlush();

    await act(async () => {
      await controller!.mutate({
        type: "project.remove",
        projectId: "project-a",
      });
      await controller!.refresh();
    });

    expect(controller).toMatchObject({
      workspace: { revision: 0 },
      recovery,
      recoveryAcknowledged: false,
      persistent: false,
    });
  });
});
