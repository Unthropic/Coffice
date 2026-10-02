import { describe, expect, it } from "vitest";

import {
  consumeAttentionTransitionCueBatch,
  createInitialAttentionTransitionCueState,
  reconcileAttentionTransitionCueState,
} from "../src/lib/attention-transition-cue";
import type {
  AttentionDisposition,
  AttentionItem,
} from "../src/lib/attention-inbox";

function item(eventKey: string, priority = 0): AttentionItem {
  return {
    eventKey,
    kind: "needs_input",
    priority,
    projectId: "project-a",
    projectName: "Project A",
    taskId: `task-${eventKey}`,
    openTaskId: `task-${eventKey}`,
    taskTitle: `Task ${eventKey}`,
    occurredAt: "2026-08-12T08:00:00.000Z",
    status: "waiting_for_user",
    evidence: "observed",
    stale: false,
    reason: "Codex is waiting for your response.",
    recommendedAction: "Open the task and respond",
  };
}

function reconcile(
  state: ReturnType<typeof createInitialAttentionTransitionCueState>,
  items: readonly AttentionItem[],
  options: {
    admissionReady?: boolean;
    dispositions?: Readonly<Record<string, AttentionDisposition>>;
  } = {},
) {
  return reconcileAttentionTransitionCueState(state, {
    admissionReady: options.admissionReady ?? true,
    items,
    dispositionFor: (eventKey) => options.dispositions?.[eventKey],
  });
}

describe("attention transition cue tracker", () => {
  it("silently observes the first authoritative canonical set", () => {
    const initial = createInitialAttentionTransitionCueState();
    const stale = reconcile(initial, [item("old")], {
      admissionReady: false,
    });
    expect(stale).toBe(initial);

    const baseline = reconcile(stale, [item("old"), item("existing-failure")]);
    expect(baseline.baselined).toBe(true);
    expect([...baseline.observedEventKeys]).toEqual([
      "old",
      "existing-failure",
    ]);
    expect(baseline.batchEventKeys).toEqual([]);
  });

  it("keeps one ordered batch, observes disposed arrivals, and consumes it whole", () => {
    let state = reconcile(createInitialAttentionTransitionCueState(), [
      item("baseline"),
    ]);
    state = reconcile(
      state,
      [item("reply", 0), item("failure", 1), item("baseline", 3)],
      {
        dispositions: {
          failure: {
            kind: "needs_review",
            at: "2026-08-12T08:01:00.000Z",
          },
        },
      },
    );
    expect(state.batchEventKeys).toEqual(["reply"]);
    expect(state.observedEventKeys.has("failure")).toBe(true);

    state = reconcile(state, [
      item("urgent-later", 0),
      item("reply", 0),
      item("baseline", 3),
    ]);
    expect(state.batchEventKeys).toEqual(["reply", "urgent-later"]);
    expect(consumeAttentionTransitionCueBatch(state).batchEventKeys).toEqual(
      [],
    );
  });

  it("reconciles only fresh input and never re-cues the same event key", () => {
    let state = reconcile(createInitialAttentionTransitionCueState(), [
      item("baseline"),
    ]);
    state = reconcile(state, [item("baseline"), item("new")]);
    expect(state.batchEventKeys).toEqual(["new"]);

    const unavailable = reconcile(state, [item("other")], {
      admissionReady: false,
    });
    expect(unavailable).toBe(state);

    state = reconcile(state, [item("baseline")]);
    expect(state.batchEventKeys).toEqual([]);
    state = reconcile(state, [item("baseline"), item("new")]);
    expect(state.batchEventKeys).toEqual([]);
    state = reconcile(state, [item("baseline"), item("new-revision")]);
    expect(state.batchEventKeys).toEqual(["new-revision"]);
  });

  it("removes seen, reviewed, dismissed, snoozed, and resolved batch keys", () => {
    let state = reconcile(createInitialAttentionTransitionCueState(), []);
    state = reconcile(state, [
      item("seen"),
      item("reviewed"),
      item("dismissed"),
      item("snoozed-or-resolved"),
      item("live"),
    ]);
    expect(state.batchEventKeys).toEqual([
      "seen",
      "reviewed",
      "dismissed",
      "snoozed-or-resolved",
      "live",
    ]);

    state = reconcile(
      state,
      [item("seen"), item("reviewed"), item("dismissed"), item("live")],
      {
        dispositions: {
          seen: {
            kind: "needs_review",
            at: "2026-08-12T08:02:00.000Z",
          },
          reviewed: {
            kind: "reviewed",
            at: "2026-08-12T08:03:00.000Z",
          },
          dismissed: {
            kind: "dismissed",
            at: "2026-08-12T08:04:00.000Z",
          },
        },
      },
    );
    expect(state.batchEventKeys).toEqual(["live"]);
  });

  it("fails quiet without evicting observed keys when the safety bound fills", () => {
    const baselineItems = Array.from({ length: 4_095 }, (_, index) =>
      item(`baseline-${index}`),
    );
    let state = reconcile(
      createInitialAttentionTransitionCueState(),
      baselineItems,
    );
    expect(state.observedEventKeys.size).toBe(4_095);

    state = reconcile(state, [
      ...baselineItems,
      item("overflow-a"),
      item("overflow-b"),
    ]);
    expect(state.saturated).toBe(true);
    expect(state.batchEventKeys).toEqual([]);
    expect(state.observedEventKeys.size).toBe(4_095);
    expect(state.observedEventKeys.has("baseline-0")).toBe(true);
    expect(state.observedEventKeys.has("overflow-a")).toBe(false);
  });
});
