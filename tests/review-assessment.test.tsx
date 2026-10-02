// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ReviewAssessmentCard } from "../src/components/review-assessment";
import type { CofficeWorkspaceController } from "../src/components/use-coffice-workspace";
import {
  createEmptyCofficeWorkspace,
  reduceCofficeWorkspace,
  type CofficeWorkspace,
  type ReviewAssessmentTarget,
  type WorkspaceMutation,
} from "../src/lib/coffice-workspace";

const NOW = "2026-08-12T10:00:00.000Z";
const TARGET: ReviewAssessmentTarget = {
  projectId: "project-a",
  objectiveId: "objective-a",
  workItemId: "work-a",
};
const RESULT_TARGET: ReviewAssessmentTarget = {
  ...TARGET,
  attemptId: "attempt-a",
  resultKey: { kind: "turn", id: "turn-a" },
};

function workspace(): CofficeWorkspace {
  return {
    ...createEmptyCofficeWorkspace(NOW),
    projects: [
      {
        id: "project-a",
        title: "Project A",
        createdAt: NOW,
        updatedAt: NOW,
        objectives: [
          {
            id: "objective-a",
            title: "Objective",
            status: "active",
            createdAt: NOW,
            updatedAt: NOW,
            workItems: [
              {
                id: "work-a",
                title: "Work",
                expectedOutcome: "Done",
                status: "ready_for_review",
                createdAt: NOW,
                updatedAt: NOW,
                attempts: [
                  {
                    id: "attempt-a",
                    codexTaskId: "task-a",
                    relationship: "primary",
                    linkedAt: NOW,
                    resultCycles: [
                      {
                        key: { kind: "turn", id: "turn-a" },
                        observedAt: NOW,
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

function controller(
  current: CofficeWorkspace,
  mutate: CofficeWorkspaceController["mutate"],
): CofficeWorkspaceController {
  return {
    workspace: current,
    ready: true,
    persistent: true,
    recovery: { kind: "none" },
    recoveryAcknowledged: true,
    error: null,
    refresh: vi.fn(async () => undefined),
    acknowledgeRecovery: vi.fn(),
    mutate,
    replaceAttentionReview: vi.fn(async () => ({
      ok: false as const,
      reason: "unavailable" as const,
    })),
    updateAttentionEvent: vi.fn(async () => ({
      ok: false as const,
      reason: "unavailable" as const,
    })),
  };
}

function button(container: HTMLElement, name: string) {
  const found = [...container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === name,
  );
  if (!(found instanceof HTMLButtonElement)) throw new Error(`Missing ${name}`);
  return found;
}

function field(container: HTMLElement, label: string) {
  const found = [...container.querySelectorAll("label")].find((candidate) =>
    candidate.textContent?.trim().startsWith(label),
  )?.control;
  if (!(
    found instanceof HTMLTextAreaElement || found instanceof HTMLSelectElement
  ))
    throw new Error(`Missing ${label}`);
  return found;
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.click();
    await Promise.resolve();
  });
}

async function enter(element: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  await act(async () => {
    setter?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function flushFocusFrame() {
  await act(
    async () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  );
}

describe("ReviewAssessmentCard", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("shows missing and recorded states and renders hostile strings only as text", async () => {
    let current = workspace();
    const mutate = vi.fn(async (mutation: WorkspaceMutation) => {
      current = reduceCofficeWorkspace(current, mutation, NOW);
      return { ok: true as const, workspace: current };
    });
    await act(async () =>
      root.render(
        <ReviewAssessmentCard
          controller={controller(current, mutate)}
          target={TARGET}
          scopeLabel="Work item"
        />,
      ),
    );
    expect(container.textContent).toContain("Nothing recorded");
    await click(button(container, "Record notes"));
    await enter(
      field(container, "Your assessment") as HTMLTextAreaElement,
      '<img src=x onerror="alert(1)">',
    );
    await enter(
      field(container, "Risks") as HTMLTextAreaElement,
      "  Risk one  \n\n Risk two ",
    );
    await click(button(container, "Save notes"));
    expect(mutate).toHaveBeenCalledWith({
      type: "assessment.set",
      assessment: expect.objectContaining({
        target: TARGET,
        reviewSummary: '<img src=x onerror="alert(1)">',
        risks: ["Risk one", "Risk two"],
      }),
    });
    await act(async () =>
      root.render(
        <ReviewAssessmentCard
          controller={controller(current, mutate)}
          target={TARGET}
          scopeLabel="Work item"
        />,
      ),
    );
    expect(container.textContent).toContain("You recorded");
    const savedDetails = container.querySelector("details");
    expect(savedDetails?.open).toBe(false);
    expect(savedDetails?.querySelector("summary")?.textContent).toBe(
      "Review saved notes",
    );
    expect(container.textContent).toContain('<img src=x onerror="alert(1)">');
    expect(container.querySelector("img")).toBeNull();
    await click(button(container, "Edit notes"));
    await click(button(container, "Clear notes"));
    expect(mutate).toHaveBeenCalledTimes(1);
    await click(button(container, "Confirm clear"));
    expect(mutate).toHaveBeenLastCalledWith({
      type: "assessment.clear",
      target: TARGET,
    });
  });

  it("keeps a failed draft and detects external edits without overwriting it", async () => {
    let current = workspace();
    const failed = vi.fn(async () => ({
      ok: false as const,
      reason: "unavailable" as const,
    }));
    await act(async () =>
      root.render(
        <ReviewAssessmentCard
          controller={controller(current, failed)}
          target={TARGET}
          scopeLabel="Work item"
        />,
      ),
    );
    await click(button(container, "Record notes"));
    await enter(
      field(container, "Your assessment") as HTMLTextAreaElement,
      "Unsaved draft",
    );
    await click(button(container, "Save notes"));
    expect(
      (field(container, "Your assessment") as HTMLTextAreaElement).value,
    ).toBe("Unsaved draft");
    expect(container.textContent).toContain("draft was not saved");

    current = reduceCofficeWorkspace(
      current,
      {
        type: "assessment.set",
        assessment: {
          target: TARGET,
          reviewSummary: "External",
          risks: [],
          uncertainties: [],
          blockedDecisions: [],
        },
      },
      NOW,
    );
    await act(async () =>
      root.render(
        <ReviewAssessmentCard
          controller={controller(current, failed)}
          target={TARGET}
          scopeLabel="Work item"
        />,
      ),
    );
    expect(container.textContent).toContain("Assessment changed elsewhere");
    expect(
      (field(container, "Your assessment") as HTMLTextAreaElement).value,
    ).toBe("Unsaved draft");
    expect(button(container, "Save notes").disabled).toBe(true);
  });

  it("hands focus to each newly revealed editor and clear control", async () => {
    const current = reduceCofficeWorkspace(
      workspace(),
      {
        type: "assessment.set",
        assessment: {
          target: TARGET,
          reviewSummary: "Saved assessment",
          risks: [],
          uncertainties: [],
          blockedDecisions: [],
        },
      },
      NOW,
    );
    const mutate = vi.fn(async () => ({
      ok: false as const,
      reason: "unavailable" as const,
    }));
    await act(async () =>
      root.render(
        <ReviewAssessmentCard
          controller={controller(current, mutate)}
          target={TARGET}
          scopeLabel="Work item"
        />,
      ),
    );

    const edit = button(container, "Edit notes");
    edit.focus();
    await click(edit);
    await flushFocusFrame();
    expect(document.activeElement).toBe(field(container, "Your assessment"));

    const clear = button(container, "Clear notes");
    clear.focus();
    await click(clear);
    await flushFocusFrame();
    expect(document.activeElement).toBe(button(container, "Confirm clear"));

    await click(button(container, "Keep notes"));
    await flushFocusFrame();
    expect(document.activeElement).toBe(button(container, "Clear notes"));

    await click(button(container, "Cancel"));
    await flushFocusFrame();
    expect(document.activeElement).toBe(button(container, "Edit notes"));
  });

  it("freezes the opened target when the visible result switches", async () => {
    const current = workspace();
    const mutate = vi.fn(async () => ({
      ok: false as const,
      reason: "unavailable" as const,
    }));
    await act(async () =>
      root.render(
        <ReviewAssessmentCard
          controller={controller(current, mutate)}
          target={RESULT_TARGET}
          scopeLabel="Exact result"
        />,
      ),
    );
    await click(button(container, "Record notes"));
    const other: ReviewAssessmentTarget = {
      projectId: "project-a",
      objectiveId: "objective-a",
      workItemId: "work-a",
      attemptId: "attempt-a",
      resultKey: { kind: "turn", id: "turn-b" },
    };
    await act(async () =>
      root.render(
        <ReviewAssessmentCard
          controller={controller(current, mutate)}
          target={other}
          scopeLabel="Exact result"
        />,
      ),
    );
    expect(container.textContent).toContain("Review scope changed");
    expect(button(container, "Save notes").disabled).toBe(true);
    const loadCurrent = button(container, "Load current scope");
    loadCurrent.focus();
    await click(loadCurrent);
    await flushFocusFrame();
    expect(container.textContent).not.toContain("Review scope changed");
    expect(document.activeElement).toBe(field(container, "Your assessment"));
  });

  it("rejects an over-limit draft before mutation", async () => {
    const current = workspace();
    const mutate = vi.fn(async () => ({
      ok: false as const,
      reason: "unavailable" as const,
    }));
    await act(async () =>
      root.render(
        <ReviewAssessmentCard
          controller={controller(current, mutate)}
          target={TARGET}
          scopeLabel="Work item"
        />,
      ),
    );
    await click(button(container, "Record notes"));
    await enter(
      field(container, "Risks") as HTMLTextAreaElement,
      Array.from({ length: 65 }, (_, index) => `Risk ${index}`).join("\n"),
    );
    await click(button(container, "Save notes"));
    expect(container.textContent).toContain(
      "Use no more than 64 lines in each list.",
    );
    expect(mutate).not.toHaveBeenCalled();
  });
});
