// @vitest-environment happy-dom

import { act, useCallback, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type AttentionReviewController,
  useAttentionReviewState,
} from "../src/components/use-attention-review-state";
import {
  ATTENTION_REVIEW_LEGACY_STORAGE_KEY,
  ATTENTION_REVIEW_STORAGE_KEY,
  createInitialAttentionReviewState,
  parseAttentionReviewState,
  serializeAttentionReviewState,
  type AttentionDisposition,
  type AttentionProject,
} from "../src/lib/attention-inbox";

const projects: AttentionProject[] = [
  {
    id: "project-a",
    name: "Project A",
    tasks: [
      {
        id: "task-a",
        title: "Finish the review slice",
        status: {
          value: "completed",
          evidence: "observed",
          source: "session-jsonl:event_msg.turn_complete",
          timestamp: "2026-08-10T10:05:00.000Z",
          stale: false,
        },
      },
    ],
  },
];

describe("attention review state storage", () => {
  let container: HTMLDivElement;
  let root: Root;
  let controller: AttentionReviewController | null;

  beforeEach(() => {
    vi.restoreAllMocks();
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    window.localStorage.clear();
    window.localStorage.setItem(
      ATTENTION_REVIEW_STORAGE_KEY,
      serializeAttentionReviewState(
        createInitialAttentionReviewState("2026-08-10T10:00:00.000Z"),
      ),
    );
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    controller = null;
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("migrates a legacy review receipt to the current storage key", async () => {
    const eventKey = "task-a:completed:2026-08-10T10:05:00.000Z";
    window.localStorage.clear();
    window.localStorage.setItem(
      ATTENTION_REVIEW_LEGACY_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        initializedAt: "2026-08-10T10:00:00.000Z",
        dispositions: {
          [eventKey]: {
            kind: "reviewed",
            at: "2026-08-10T10:06:00.000Z",
          },
        },
      }),
    );

    function Harness() {
      controller = useAttentionReviewState(
        projects,
        Date.parse("2026-08-10T10:06:00.000Z"),
        true,
      );
      return null;
    }

    await act(async () => root.render(<Harness />));

    expect(controller?.items).toHaveLength(0);
    expect(
      parseAttentionReviewState(
        window.localStorage.getItem(ATTENTION_REVIEW_STORAGE_KEY),
      ),
    ).toMatchObject({
      version: 2,
      dispositions: {
        [eventKey]: {
          kind: "reviewed",
          at: "2026-08-10T10:06:00.000Z",
        },
      },
    });
    expect(
      window.localStorage.getItem(ATTENTION_REVIEW_LEGACY_STORAGE_KEY),
    ).toBeNull();
  });

  it("keeps the latest review action in memory when localStorage rejects a write", async () => {
    const storedBeforeFailure = window.localStorage.getItem(
      ATTENTION_REVIEW_STORAGE_KEY,
    );
    const setItem = vi
      .spyOn(window.localStorage, "setItem")
      .mockImplementation(() => {
        throw new DOMException("Quota exceeded", "QuotaExceededError");
      });

    function Harness() {
      controller = useAttentionReviewState(
        projects,
        Date.parse("2026-08-10T10:06:00.000Z"),
        true,
      );
      return null;
    }

    await act(async () => root.render(<Harness />));
    expect(controller?.items).toHaveLength(1);
    const eventKey = controller!.items[0].eventKey;

    await act(async () => controller!.markReviewed(eventKey));

    expect(controller?.items).toHaveLength(0);
    expect(controller?.persistent).toBe(false);
    expect(window.localStorage.getItem(ATTENTION_REVIEW_STORAGE_KEY)).toBe(
      storedBeforeFailure,
    );

    await act(async () => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: ATTENTION_REVIEW_STORAGE_KEY,
          newValue: storedBeforeFailure,
        }),
      );
    });

    expect(controller?.items).toHaveLength(0);
    expect(controller?.dispositionFor(eventKey)?.kind).toBe("reviewed");
    expect(controller?.persistent).toBe(false);
    setItem.mockRestore();
  });

  it("uses the durable Coffice workspace instead of browser storage", async () => {
    const browserValue = window.localStorage.getItem(
      ATTENTION_REVIEW_STORAGE_KEY,
    );
    const save = vi.fn();

    function Harness() {
      const [durableState, setDurableState] = useState(() =>
        createInitialAttentionReviewState("2026-08-10T10:00:00.000Z"),
      );
      const persist = useCallback(
        async (
          eventKey: string,
          disposition: AttentionDisposition | null,
          snoozedUntil: string | null,
        ) => {
          save(eventKey, disposition, snoozedUntil);
          setDurableState((current) => {
            const dispositions = { ...current.dispositions };
            const snoozes = { ...current.snoozedUntil };
            if (disposition) dispositions[eventKey] = disposition;
            else delete dispositions[eventKey];
            if (snoozedUntil) snoozes[eventKey] = snoozedUntil;
            else delete snoozes[eventKey];
            return {
              ...current,
              dispositions,
              snoozedUntil: snoozes,
            };
          });
          return { ok: true };
        },
        [],
      );
      controller = useAttentionReviewState(
        projects,
        Date.parse("2026-08-10T10:06:00.000Z"),
        true,
        Date.parse("2026-08-10T10:00:00.000Z"),
        {
          state: durableState,
          ready: true,
          persistent: true,
          updateEvent: persist,
        },
      );
      return null;
    }

    await act(async () => root.render(<Harness />));
    expect(controller?.items).toHaveLength(1);
    const eventKey = controller!.items[0].eventKey;
    let saved = false;

    await act(async () => {
      saved = await controller!.markReviewed(eventKey);
    });

    expect(saved).toBe(true);
    expect(save).toHaveBeenCalledOnce();
    expect(controller?.items).toHaveLength(0);
    expect(controller?.dispositionFor(eventKey)?.kind).toBe("reviewed");
    expect(window.localStorage.getItem(ATTENTION_REVIEW_STORAGE_KEY)).toBe(
      browserValue,
    );
  });

  it("marks a result seen without removing it from Attention", async () => {
    const save = vi.fn();

    function Harness() {
      const [durableState, setDurableState] = useState(() =>
        createInitialAttentionReviewState("2026-08-10T10:00:00.000Z"),
      );
      const updateEvent = useCallback(
        async (
          eventKey: string,
          disposition: AttentionDisposition | null,
          snoozedUntil: string | null,
        ) => {
          save(eventKey, disposition, snoozedUntil);
          setDurableState((current) => ({
            ...current,
            dispositions: disposition
              ? { ...current.dispositions, [eventKey]: disposition }
              : current.dispositions,
            snoozedUntil: snoozedUntil
              ? { ...current.snoozedUntil, [eventKey]: snoozedUntil }
              : current.snoozedUntil,
          }));
          return { ok: true };
        },
        [],
      );
      controller = useAttentionReviewState(
        projects,
        Date.parse("2026-08-10T10:06:00.000Z"),
        true,
        Date.parse("2026-08-10T10:00:00.000Z"),
        {
          state: durableState,
          ready: true,
          persistent: true,
          updateEvent,
        },
      );
      return null;
    }

    await act(async () => root.render(<Harness />));
    const eventKey = controller!.items[0].eventKey;
    let saved = false;

    await act(async () => {
      saved = await controller!.markSeen(eventKey);
    });

    expect(saved).toBe(true);
    expect(save).toHaveBeenCalledOnce();
    expect(controller?.items.map((entry) => entry.eventKey)).toEqual([
      eventKey,
    ]);
    expect(controller?.dispositionFor(eventKey)?.kind).toBe("needs_review");
  });

  it("preserves the first-seen receipt when the same result is opened again", async () => {
    const save = vi.fn();

    function Harness() {
      const [durableState, setDurableState] = useState(() =>
        createInitialAttentionReviewState("2026-08-10T10:00:00.000Z"),
      );
      const updateEvent = useCallback(
        async (
          eventKey: string,
          disposition: AttentionDisposition | null,
          snoozedUntil: string | null,
        ) => {
          save(eventKey, disposition, snoozedUntil);
          setDurableState((current) => ({
            ...current,
            dispositions: disposition
              ? { ...current.dispositions, [eventKey]: disposition }
              : current.dispositions,
            snoozedUntil: snoozedUntil
              ? { ...current.snoozedUntil, [eventKey]: snoozedUntil }
              : current.snoozedUntil,
          }));
          return { ok: true };
        },
        [],
      );
      controller = useAttentionReviewState(
        projects,
        Date.parse("2026-08-10T10:06:00.000Z"),
        true,
        Date.parse("2026-08-10T10:00:00.000Z"),
        {
          state: durableState,
          ready: true,
          persistent: true,
          updateEvent,
        },
      );
      return null;
    }

    await act(async () => root.render(<Harness />));
    const eventKey = controller!.items[0].eventKey;

    await act(async () => {
      expect(await controller!.markSeen(eventKey)).toBe(true);
    });
    const firstSeenAt = controller!.dispositionFor(eventKey)?.at;

    await act(async () => {
      expect(await controller!.markSeen(eventKey)).toBe(true);
    });

    expect(save).toHaveBeenCalledOnce();
    expect(controller?.dispositionFor(eventKey)).toEqual({
      kind: "needs_review",
      at: firstSeenAt,
    });
  });

  it("does not claim a durable seen receipt was saved when persistence fails", async () => {
    const updateEvent = vi.fn(async () => ({ ok: false }));

    function Harness() {
      controller = useAttentionReviewState(
        projects,
        Date.parse("2026-08-10T10:06:00.000Z"),
        true,
        Date.parse("2026-08-10T10:00:00.000Z"),
        {
          state: createInitialAttentionReviewState("2026-08-10T10:00:00.000Z"),
          ready: true,
          persistent: true,
          updateEvent,
        },
      );
      return null;
    }

    await act(async () => root.render(<Harness />));
    const eventKey = controller!.items[0].eventKey;
    let saved = true;

    await act(async () => {
      saved = await controller!.markSeen(eventKey);
    });

    expect(saved).toBe(false);
    expect(updateEvent).toHaveBeenCalledOnce();
    expect(controller?.dispositionFor(eventKey)).toBeUndefined();
    expect(controller?.items.map((entry) => entry.eventKey)).toEqual([
      eventKey,
    ]);
  });

  it("surfaces a failed review receipt write and still resolves the exact workspace-reviewed key", async () => {
    const eventKey = "task-a:completed:2026-08-10T10:05:00.000Z";
    const updateEvent = vi.fn(async () => ({ ok: false }));

    function Harness({ resolved }: { resolved: boolean }) {
      controller = useAttentionReviewState(
        projects,
        Date.parse("2026-08-10T10:06:00.000Z"),
        true,
        Date.parse("2026-08-10T10:00:00.000Z"),
        {
          state: createInitialAttentionReviewState("2026-08-10T10:00:00.000Z"),
          ready: true,
          persistent: true,
          updateEvent,
        },
        resolved ? new Set([eventKey]) : new Set(),
      );
      return null;
    }

    await act(async () => root.render(<Harness resolved={false} />));
    let saved = true;
    await act(async () => {
      saved = await controller!.markReviewed(eventKey);
    });

    expect(saved).toBe(false);
    expect(controller?.dispositionFor(eventKey)).toBeUndefined();
    expect(controller?.items.map((item) => item.eventKey)).toEqual([eventKey]);

    await act(async () => root.render(<Harness resolved />));
    expect(controller?.dispositionFor(eventKey)).toBeUndefined();
    expect(controller?.items).toEqual([]);
  });

  it("repairs an epoch baseline in memory before historical results can flood the inbox", async () => {
    const observationTime = Date.parse("2026-08-10T10:06:00.000Z");
    const liveProjects: AttentionProject[] = [
      {
        ...projects[0],
        tasks: [
          projects[0].tasks[0],
          {
            id: "task-input",
            title: "Answer a question",
            status: {
              value: "waiting_for_user",
              evidence: "observed",
              timestamp: "2026-08-09T10:00:00.000Z",
            },
          },
          {
            id: "task-failed",
            title: "Inspect a failure",
            status: {
              value: "failed",
              evidence: "observed",
              timestamp: "2026-08-09T10:00:00.000Z",
            },
          },
        ],
      },
    ];
    const updateEvent = vi.fn(async () => ({ ok: true }));

    function Harness() {
      controller = useAttentionReviewState(
        liveProjects,
        observationTime,
        true,
        observationTime,
        {
          state: createInitialAttentionReviewState("invalid"),
          ready: true,
          persistent: true,
          updateEvent,
        },
      );
      return null;
    }

    await act(async () => root.render(<Harness />));

    expect(controller?.initializedAt).toBe("2026-08-10T10:06:00.000Z");
    expect(controller?.items.map((item) => item.kind)).toEqual([
      "needs_input",
      "task_failed",
    ]);
    expect(updateEvent).not.toHaveBeenCalled();
  });
});
