import { describe, expect, it } from "vitest";

import {
  createInitialAttentionReviewState,
  createProjectReviewAttentionItem,
  selectAttentionItems,
  setAttentionDisposition,
  type AttentionProject,
} from "../src/lib/attention-inbox";

const BEFORE = "2026-08-19T08:59:00.000Z";
const DUE = "2026-08-19T09:00:00.000Z";
const AFTER = "2026-08-19T09:01:00.000Z";

function project(nextReviewAt = DUE): AttentionProject {
  return {
    id: "project-1",
    name: "Coffice",
    tasks: [],
    reviewSchedule: { nextReviewAt },
  };
}

describe("scheduled project review Attention", () => {
  it("admits an explicitly scheduled review only when it is due", () => {
    expect(
      createProjectReviewAttentionItem(project(), Date.parse(BEFORE)),
    ).toBeNull();
    expect(
      createProjectReviewAttentionItem(project(), Date.parse(DUE)),
    ).toMatchObject({
      kind: "project_review_due",
      planProjectId: "project-1",
      projectId: "project-1",
      occurredAt: DUE,
      reason: "Your scheduled project review is due.",
      recommendedAction: "Open the project plan",
    });
  });

  it("keeps the due reminder after it is opened and removes only a reviewed disposition", () => {
    const initial = createInitialAttentionReviewState(BEFORE);
    const first = selectAttentionItems([project()], initial, Date.parse(AFTER));
    expect(first).toHaveLength(1);
    const eventKey = first[0].eventKey;

    const seen = setAttentionDisposition(
      initial,
      eventKey,
      "needs_review",
      AFTER,
    );
    expect(
      selectAttentionItems([project()], seen, Date.parse(AFTER)),
    ).toHaveLength(1);

    const reviewed = setAttentionDisposition(seen, eventKey, "reviewed", AFTER);
    expect(
      selectAttentionItems([project()], reviewed, Date.parse(AFTER)),
    ).toEqual([]);
  });

  it("uses the exact scheduled occurrence as the deduplication identity", () => {
    const state = createInitialAttentionReviewState(BEFORE);
    const first = selectAttentionItems(
      [project()],
      state,
      Date.parse(AFTER),
    )[0];
    const next = selectAttentionItems(
      [project("2026-08-20T09:00:00.000Z")],
      state,
      Date.parse("2026-08-20T09:01:00.000Z"),
    )[0];
    expect(next.eventKey).not.toBe(first.eventKey);
  });
});
