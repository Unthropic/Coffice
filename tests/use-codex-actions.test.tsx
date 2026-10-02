// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  codexOperationNotice,
  type CodexActionsController,
  useCodexActions,
} from "../src/components/use-codex-actions";
import type { CodexOperation } from "../src/lib/codex-app-server";

const NOW = "2026-08-11T13:00:00.000Z";

function operation(overrides: Partial<CodexOperation> = {}): CodexOperation {
  return {
    id: "operation-one",
    kind: "send_follow_up",
    taskId: "thread-one",
    state: "running",
    createdAt: NOW,
    updatedAt: NOW,
    turnId: "turn-one",
    ...overrides,
  };
}

function json(body: unknown, status = 200): Response {
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

describe("useCodexActions", () => {
  let container: HTMLDivElement;
  let root: Root;
  let controller: CodexActionsController | null;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    controller = null;
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function Harness() {
    controller = useCodexActions();
    return null;
  }

  async function renderAndFlush() {
    await act(async () => {
      root.render(<Harness />);
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it("loads structural operations and exposes their latest state", async () => {
    const waiting = operation({ state: "waiting" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ operations: [waiting] })),
    );

    await renderAndFlush();

    expect(controller).toMatchObject({
      available: true,
      error: null,
      operations: [waiting],
    });
    expect(controller!.latestOperationFor("thread-one")).toEqual(waiting);
    expect(codexOperationNotice(waiting)).toBe("user_action_required");
    expect(codexOperationNotice(operation({ state: "unknown" }))).toBe(
      "confirmation_lost",
    );
  });

  it("sends the exact confirmed follow-up payload without retaining its text", async () => {
    const accepted = operation();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ operations: [] }))
      .mockResolvedValueOnce(json({ operation: accepted }, 202));
    vi.stubGlobal("fetch", fetchMock);
    await renderAndFlush();

    let result: CodexOperation;
    await act(async () => {
      result = await controller!.submitFollowUp(
        "thread-one",
        "private instruction text",
      );
    });

    expect(result!).toEqual(accepted);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const request = fetchMock.mock.calls[1];
    expect(request[0]).toBe("/api/codex-actions");
    expect(request[1]).toMatchObject({
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    });
    expect(JSON.parse(String(request[1]?.body))).toEqual({
      action: "send_follow_up",
      taskId: "thread-one",
      text: "private instruction text",
      idempotencyKey: expect.any(String),
      confirmed: true,
      confirmationToken: "CONFIRM_SEND",
    });
    expect(JSON.stringify(controller)).not.toContain("private instruction");
  });

  it("sends the exact detached review request contract", async () => {
    const accepted = operation({
      id: "review-operation",
      kind: "request_review",
      reviewThreadId: "review-thread",
    });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ operations: [] }))
      .mockResolvedValueOnce(json({ operation: accepted }, 202));
    vi.stubGlobal("fetch", fetchMock);
    await renderAndFlush();

    await act(async () => {
      await controller!.requestReview("thread-one");
    });

    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({
      action: "request_review",
      taskId: "thread-one",
      idempotencyKey: expect.any(String),
      confirmed: true,
      confirmationToken: "CONFIRM_REVIEW",
    });
    expect(
      controller!.latestOperationFor("thread-one", "request_review")?.id,
    ).toBe("review-operation");
  });

  it("sends the exact confirmed archive request contract", async () => {
    const accepted = operation({
      id: "archive-operation",
      kind: "archive_task",
      state: "completed",
      turnId: undefined,
    });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ operations: [] }))
      .mockResolvedValueOnce(json({ operation: accepted }, 202));
    vi.stubGlobal("fetch", fetchMock);
    await renderAndFlush();

    await act(async () => {
      await controller!.archiveTask!("thread-one");
    });

    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({
      action: "archive_task",
      taskId: "thread-one",
      idempotencyKey: expect.any(String),
      confirmed: true,
      confirmationToken: "CONFIRM_ARCHIVE",
    });
    expect(
      controller!.latestOperationFor("thread-one", "archive_task"),
    ).toMatchObject({ id: "archive-operation", state: "completed" });
  });

  it("sends one exact stop request for a tracked active turn", async () => {
    const running = operation();
    const cancelling = operation({
      cancelRequestedAt: "2026-08-11T13:00:30.000Z",
    });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ operations: [running] }))
      .mockResolvedValueOnce(json({ operation: cancelling }, 202));
    vi.stubGlobal("fetch", fetchMock);
    await renderAndFlush();

    await act(async () => {
      await controller!.cancelOperation!(running.id, running.taskId);
    });

    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({
      action: "cancel_operation",
      taskId: "thread-one",
      operationId: "operation-one",
      confirmed: true,
      confirmationToken: "CONFIRM_CANCEL_OPERATION",
    });
    expect(controller!.latestOperationFor("thread-one")).toEqual(cancelling);
  });

  it("loads one pending clarification and sends its exact confirmed response", async () => {
    const waiting = operation({ state: "waiting" });
    const running = operation({ state: "running" });
    const pending = {
      id: "request-one",
      operationId: waiting.id,
      taskId: waiting.taskId,
      receivedAt: NOW,
      kind: "clarification",
      questions: [
        {
          id: "local-question",
          header: "Deployment target",
          question: "Which environment should be used?",
          isSecret: false,
          allowOther: false,
          options: [{ label: "Staging", description: "Use staging." }],
        },
      ],
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        json({ operations: [waiting], pendingRequests: [pending] }),
      )
      .mockResolvedValueOnce(
        json({ operation: running, pendingRequests: [] }, 202),
      );
    vi.stubGlobal("fetch", fetchMock);
    await renderAndFlush();

    const answers = { "local-question": ["Staging"] };
    await act(async () => {
      await controller!.respondToClarification!(
        "request-one",
        "thread-one",
        answers,
      );
    });

    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({
      action: "respond_clarification",
      taskId: "thread-one",
      requestId: "request-one",
      answers: { "local-question": ["Staging"] },
      confirmed: true,
      confirmationToken: "CONFIRM_CLARIFICATION_RESPONSE",
    });
    expect(answers).toEqual({ "local-question": [] });
    expect(controller!.pendingRequests).toEqual([]);
    expect(controller!.latestOperationFor("thread-one")?.state).toBe("running");
  });

  it("keeps a stop request unknown when browser confirmation is lost", async () => {
    const running = operation();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ operations: [running] }))
      .mockRejectedValueOnce(new TypeError("connection lost"));
    vi.stubGlobal("fetch", fetchMock);
    await renderAndFlush();

    let result: CodexOperation | undefined;
    await act(async () => {
      result = await controller!.cancelOperation!(running.id, running.taskId);
    });

    expect(result).toMatchObject({
      id: running.id,
      state: "unknown",
      errorCode: "APP_SERVER_UNAVAILABLE",
    });
    expect(controller?.error).toBe(
      "Stop confirmation was lost. Check the task before taking another action.",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("polls active work and stops when it becomes terminal", async () => {
    vi.useFakeTimers();
    const running = operation();
    const completed = operation({
      state: "completed",
      updatedAt: `${NOW}-done`,
    });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ operations: [] }))
      .mockResolvedValueOnce(json({ operation: running }, 202))
      .mockResolvedValueOnce(json({ operations: [completed] }));
    vi.stubGlobal("fetch", fetchMock);
    await renderAndFlush();
    await act(async () => {
      await controller!.submitFollowUp("thread-one", "continue");
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(controller!.latestOperationFor("thread-one")?.state).toBe(
      "completed",
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("never automatically resends after ambiguous POST failure", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ operations: [] }))
      .mockRejectedValueOnce(new TypeError("connection lost"));
    vi.stubGlobal("fetch", fetchMock);
    await renderAndFlush();

    let result: CodexOperation;
    await act(async () => {
      result = await controller!.submitFollowUp("thread-one", "private retry");
    });

    expect(result!).toMatchObject({ state: "unknown" });
    expect(controller).toMatchObject({
      available: false,
      error: "Action confirmation was lost. Check the task before retrying.",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(controller)).not.toContain("private retry");
  });

  it("keeps authoritative work active and recovers after bounded status failures", async () => {
    vi.useFakeTimers();
    const running = operation();
    const completed = operation({ state: "completed" });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ operations: [] }))
      .mockResolvedValueOnce(json({ operation: running }, 202))
      .mockRejectedValueOnce(new TypeError("status unavailable"))
      .mockRejectedValueOnce(new TypeError("status unavailable"))
      .mockRejectedValueOnce(new TypeError("status unavailable"))
      .mockRejectedValueOnce(new TypeError("status unavailable"))
      .mockRejectedValueOnce(new TypeError("status unavailable"))
      .mockResolvedValueOnce(json({ operations: [completed] }));
    vi.stubGlobal("fetch", fetchMock);
    await renderAndFlush();
    await act(async () => {
      await controller!.submitFollowUp("thread-one", "continue");
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });

    expect(controller!.latestOperationFor("thread-one")?.state).toBe("unknown");
    expect(controller?.error).toBe(
      "Action status confirmation was lost. Check the task before retrying.",
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(controller!.latestOperationFor("thread-one")?.state).toBe(
      "completed",
    );
    expect(controller?.error).toBeNull();
  });

  it("marks a locally active operation unknown when the server manager loses it", async () => {
    vi.useFakeTimers();
    const running = operation();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ operations: [] }))
      .mockResolvedValueOnce(json({ operation: running }, 202))
      .mockResolvedValueOnce(json({ operations: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await renderAndFlush();
    await act(async () => {
      await controller!.submitFollowUp("thread-one", "continue");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    expect(controller!.latestOperationFor("thread-one")).toMatchObject({
      state: "unknown",
      errorCode: "APP_SERVER_EXITED",
    });
    expect(
      codexOperationNotice(controller!.latestOperationFor("thread-one")),
    ).toBe("confirmation_lost");
  });

  it("recovers from a transient initial status failure without a reload", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("temporarily unavailable"))
      .mockResolvedValueOnce(json({ operations: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await renderAndFlush();

    expect(controller?.available).toBe(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(controller).toMatchObject({ available: true, error: null });
  });

  it("stops low-frequency recovery polling after a bounded outage window", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError("unavailable"));
    vi.stubGlobal("fetch", fetchMock);
    await renderAndFlush();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(130_000);
    });
    const boundedCalls = fetchMock.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(boundedCalls).toBeGreaterThan(1);
    expect(fetchMock).toHaveBeenCalledTimes(boundedCalls);
  });

  it("does not let a late initial GET erase a newly submitted operation", async () => {
    const initial = deferred<Response>();
    const accepted = operation();
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      if (init?.method === "POST") return json({ operation: accepted }, 202);
      return await initial.promise;
    });
    vi.stubGlobal("fetch", fetchMock);
    await renderAndFlush();

    await act(async () => {
      await controller!.submitFollowUp("thread-one", "continue");
    });
    initial.resolve(json({ operations: [] }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(controller!.latestOperationFor("thread-one")?.id).toBe(
      "operation-one",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
