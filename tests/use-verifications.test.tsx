// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  useVerifications,
  type VerificationsController,
} from "../src/components/use-verifications";

const target = {
  projectId: "project-a",
  objectiveId: "objective-a",
  workItemId: "work-a",
  attemptId: "attempt-a",
  resultKey: { kind: "revision" as const, id: "result-a" },
};

const profile = {
  id: "test",
  version: "1",
  label: "Tests",
  description: "Run the project test suite.",
  eligible: true,
};

const queuedReceipt = {
  id: "receipt-a",
  target,
  profile: { id: "test", version: "1" },
  checks: [
    {
      id: "test",
      version: "1",
      state: "queued",
      queuedAt: "2026-08-12T01:00:00.000Z",
    },
  ],
  state: "queued",
  queuedAt: "2026-08-12T01:00:00.000Z",
};

const passedReceipt = {
  ...queuedReceipt,
  state: "passed",
  startedAt: "2026-08-12T01:00:01.000Z",
  completedAt: "2026-08-12T01:00:02.000Z",
  checks: [
    {
      ...queuedReceipt.checks[0],
      state: "passed",
      startedAt: "2026-08-12T01:00:01.000Z",
      completedAt: "2026-08-12T01:00:02.000Z",
    },
  ],
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function snapshot(receipts: unknown[] = [], operations: unknown[] = []) {
  return { profiles: [profile], receipts, operations };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((onResolve) => {
    resolve = onResolve;
  });
  return { promise, resolve };
}

describe("useVerifications", () => {
  let container: HTMLDivElement;
  let root: Root;
  let controller: VerificationsController | null;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
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
    vi.useRealTimers();
  });

  function Harness({
    projectId,
    onReceiptChanged,
  }: {
    projectId: string | null;
    onReceiptChanged?: () => void | Promise<void>;
  }) {
    controller = useVerifications(projectId, onReceiptChanged);
    return null;
  }

  async function render(
    projectId: string | null,
    onReceiptChanged?: () => void | Promise<void>,
  ) {
    await act(async () => {
      root.render(
        <Harness projectId={projectId} onReceiptChanged={onReceiptChanged} />,
      );
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      await Promise.resolve();
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      await Promise.resolve();
    });
  }

  async function waitForReady() {
    await act(async () => {
      for (let attempt = 0; attempt < 20 && !controller?.ready; attempt += 1) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 5));
      }
    });
  }

  it("sends only the exact confirmed target and fixed profile reference", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(snapshot()))
      .mockResolvedValueOnce(
        response(
          {
            receipt: queuedReceipt,
            operation: { receiptId: "receipt-a", state: "running" },
            replayed: false,
          },
          202,
        ),
      )
      .mockResolvedValueOnce(
        response(
          {
            receipt: queuedReceipt,
            operation: { receiptId: "receipt-a", state: "cancelling" },
            replayed: false,
          },
          202,
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    await render("project-a");
    await waitForReady();

    expect(controller).toMatchObject({ ready: true, available: true });
    await act(async () => {
      await controller!.run(target, { id: "test", version: "1" });
    });

    const request = fetchMock.mock.calls[1];
    expect(request[0]).toBe("/api/verifications");
    const body = JSON.parse(String((request[1] as RequestInit).body));
    expect(body).toMatchObject({
      action: "run",
      profileId: "test",
      profileVersion: "1",
      projectId: "project-a",
      objectiveId: "objective-a",
      workItemId: "work-a",
      attemptId: "attempt-a",
      resultKey: { kind: "revision", id: "result-a" },
      confirmed: true,
      confirmationToken: "CONFIRM_VERIFICATION",
    });
    expect(body.idempotencyKey).toMatch(/^verification-/u);
    expect(JSON.stringify(body)).not.toMatch(
      /root|path|argv|command|output|environment|policy/iu,
    );

    await act(async () => {
      await controller!.cancel("receipt-a");
    });
    expect(JSON.parse(String(fetchMock.mock.calls[2][1]?.body))).toEqual({
      action: "cancel",
      receiptId: "receipt-a",
      confirmed: true,
      confirmationToken: "CONFIRM_CANCEL_VERIFICATION",
    });
  });

  it("does not retry an ambiguous write or retain a private response sentinel", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(snapshot()))
      .mockResolvedValueOnce(
        response({
          receipt: queuedReceipt,
          replayed: false,
          root: "PRIVATE_SENTINEL",
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    await render("project-a");
    await waitForReady();

    let result: Awaited<ReturnType<VerificationsController["run"]>> | null =
      null;
    await act(async () => {
      result = await controller!.run(target, { id: "test", version: "1" });
      await Promise.resolve();
    });
    expect(result).toEqual({ ok: false, reason: "confirmation_lost" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(controller).toMatchObject({ degraded: true, receipts: [] });
    expect(JSON.stringify(controller)).not.toContain("PRIVATE_SENTINEL");
  });

  it("refreshes durable workspace state after an ambiguous run", async () => {
    const onReceiptChanged = vi.fn();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(snapshot()))
      .mockRejectedValueOnce(new TypeError("connection lost"));
    vi.stubGlobal("fetch", fetchMock);
    await render("project-a", onReceiptChanged);
    await waitForReady();

    let result: Awaited<ReturnType<VerificationsController["run"]>> | null =
      null;
    await act(async () => {
      result = await controller!.run(target, { id: "test", version: "1" });
    });

    expect(result).toEqual({ ok: false, reason: "confirmation_lost" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onReceiptChanged).toHaveBeenCalledTimes(1);
    expect(controller).toMatchObject({ degraded: true });
  });

  it("does not accept a structurally valid receipt for a different result", async () => {
    const wrongReceipt = {
      ...queuedReceipt,
      target: {
        ...target,
        resultKey: { kind: "revision" as const, id: "different-result" },
      },
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(snapshot()))
      .mockResolvedValueOnce(
        response({ receipt: wrongReceipt, replayed: false }, 202),
      );
    vi.stubGlobal("fetch", fetchMock);
    await render("project-a");
    await waitForReady();

    let result: Awaited<ReturnType<VerificationsController["run"]>> | null =
      null;
    await act(async () => {
      result = await controller!.run(target, { id: "test", version: "1" });
    });
    expect(result).toEqual({ ok: false, reason: "confirmation_lost" });
    expect(controller?.receipts).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("recovers an ambiguous run from a later durable GET without allowing a duplicate run", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(snapshot()))
      .mockResolvedValueOnce(
        response({
          receipt: queuedReceipt,
          replayed: false,
          output: "PRIVATE_SENTINEL",
        }),
      )
      .mockResolvedValueOnce(
        response(
          snapshot(
            [queuedReceipt],
            [{ receiptId: "receipt-a", state: "running" }],
          ),
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => root.render(<Harness projectId="project-a" />));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
    });
    expect(controller).toMatchObject({ ready: true, degraded: false });

    let first: Awaited<ReturnType<VerificationsController["run"]>> | null =
      null;
    await act(async () => {
      first = await controller!.run(target, { id: "test", version: "1" });
    });
    expect(first).toEqual({ ok: false, reason: "confirmation_lost" });
    expect(controller).toMatchObject({ degraded: true });

    let duplicate: Awaited<ReturnType<VerificationsController["run"]>> | null =
      null;
    await act(async () => {
      duplicate = await controller!.run(target, { id: "test", version: "1" });
    });
    expect(duplicate).toEqual({ ok: false, reason: "unavailable" });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(controller).toMatchObject({ degraded: false });
    expect(controller?.receipts[0]?.state).toBe("queued");
    expect(JSON.stringify(controller)).not.toContain("PRIVATE_SENTINEL");
  });

  it("treats a cancellation 503 as ambiguous and never retries it", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(snapshot([queuedReceipt])))
      .mockResolvedValueOnce(
        response({ error: "PRIVATE_SENTINEL", code: "UNAVAILABLE" }, 503),
      );
    vi.stubGlobal("fetch", fetchMock);
    await render("project-a");
    await waitForReady();

    let result: Awaited<ReturnType<VerificationsController["cancel"]>> | null =
      null;
    await act(async () => {
      result = await controller!.cancel("receipt-a");
      await Promise.resolve();
    });

    expect(result).toEqual({ ok: false, reason: "confirmation_lost" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(controller)).not.toContain("PRIVATE_SENTINEL");
  });

  it("treats a run 503 as ambiguous and refreshes durable workspace state", async () => {
    const onReceiptChanged = vi.fn();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(snapshot()))
      .mockResolvedValueOnce(
        response({ error: "PRIVATE_SENTINEL", code: "UNAVAILABLE" }, 503),
      );
    vi.stubGlobal("fetch", fetchMock);
    await render("project-a", onReceiptChanged);
    await waitForReady();

    let result: Awaited<ReturnType<VerificationsController["run"]>> | null =
      null;
    await act(async () => {
      result = await controller!.run(target, { id: "test", version: "1" });
    });

    expect(result).toEqual({ ok: false, reason: "confirmation_lost" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onReceiptChanged).toHaveBeenCalledTimes(1);
    expect(controller).toMatchObject({ degraded: true });
    expect(JSON.stringify(controller)).not.toContain("PRIVATE_SENTINEL");
  });

  it("ignores a slow response from the project left during navigation", async () => {
    const first = deferred<Response>();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce(
        response({
          profiles: [{ ...profile, label: "Project B tests" }],
          receipts: [],
          operations: [],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await render("project-a");
    await render("project-b");
    await waitForReady();
    expect(controller?.profiles[0]?.label).toBe("Project B tests");

    await act(async () => {
      first.resolve(
        response({
          profiles: [{ ...profile, label: "Stale project A tests" }],
          receipts: [queuedReceipt],
          operations: [],
        }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(controller?.profiles[0]?.label).toBe("Project B tests");
    expect(controller?.receipts).toEqual([]);
  });

  it("refreshes durable workspace after a run response arrives following a project switch", async () => {
    const post = deferred<Response>();
    const onReceiptChanged = vi.fn();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(snapshot()))
      .mockImplementationOnce(() => post.promise)
      .mockResolvedValueOnce(
        response({
          profiles: [{ ...profile, label: "Project B tests" }],
          receipts: [],
          operations: [],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await render("project-a", onReceiptChanged);
    await waitForReady();
    let runPromise!: ReturnType<VerificationsController["run"]>;
    await act(async () => {
      runPromise = controller!.run(target, { id: "test", version: "1" });
      await Promise.resolve();
    });

    await render("project-b", onReceiptChanged);
    await waitForReady();
    expect(controller?.profiles[0]?.label).toBe("Project B tests");

    let result: Awaited<ReturnType<VerificationsController["run"]>> | null =
      null;
    await act(async () => {
      post.resolve(response({ receipt: queuedReceipt, replayed: false }, 202));
      result = await runPromise;
    });

    expect(result).toEqual({ ok: false, reason: "confirmation_lost" });
    expect(onReceiptChanged).toHaveBeenCalledTimes(1);
    expect(controller?.profiles[0]?.label).toBe("Project B tests");
    expect(controller?.receipts).toEqual([]);
  });

  it("does not relabel project A verification data when project B fails to load", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response({
          profiles: [{ ...profile, label: "Project A tests" }],
          receipts: [queuedReceipt],
          operations: [],
        }),
      )
      .mockRejectedValueOnce(new Error("project B unavailable"));
    vi.stubGlobal("fetch", fetchMock);

    await render("project-a");
    await waitForReady();
    expect(controller?.profiles[0]?.label).toBe("Project A tests");
    expect(controller?.receipts).toHaveLength(1);

    await render("project-b");
    await waitForReady();
    expect(controller).toMatchObject({ ready: true, degraded: true });
    expect(controller?.profiles).toEqual([]);
    expect(controller?.receipts).toEqual([]);
    expect(controller?.operations).toEqual([]);
    expect(controller?.available).toBe(false);
  });

  it("keeps polling a saved active receipt at a lower rate after repeated read failures", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response(
          snapshot(
            [queuedReceipt],
            [{ receiptId: "receipt-a", state: "running" }],
          ),
        ),
      )
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce(response(snapshot([passedReceipt])));
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => root.render(<Harness projectId="project-a" />));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
    });
    expect(controller).toMatchObject({ ready: true, degraded: false });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
      await Promise.resolve();
    });
    expect(controller).toMatchObject({ degraded: true });
    expect(controller?.receipts[0]?.state).toBe("queued");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(10_000);
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(controller).toMatchObject({ degraded: false });
    expect(controller?.receipts[0]?.state).toBe("passed");
  });
});
