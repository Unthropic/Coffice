// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DecisionRequestsCard } from "../src/components/decision-requests";
import type { CofficeWorkspaceController } from "../src/components/use-coffice-workspace";
import {
  createEmptyCofficeWorkspace,
  reduceCofficeWorkspace,
  type CofficeWorkspace,
  type ReviewAssessmentTarget,
  type WorkspaceMutation,
} from "../src/lib/coffice-workspace";

const NOW = "2026-08-19T12:00:00.000Z";
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
                status: "in_progress",
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

function textarea(container: HTMLElement, label: string) {
  const found = [...container.querySelectorAll("label")].find((candidate) =>
    candidate.textContent?.trim().startsWith(label),
  )?.control;
  if (!(found instanceof HTMLTextAreaElement))
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

describe("DecisionRequestsCard", () => {
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

  it("creates a durable request for the exact visible scope and renders text safely", async () => {
    let current = workspace();
    const mutate = vi.fn(async (mutation: WorkspaceMutation) => {
      current = reduceCofficeWorkspace(current, mutation, NOW);
      return { ok: true as const, workspace: current };
    });
    await act(async () =>
      root.render(
        <DecisionRequestsCard
          controller={controller(current, mutate)}
          target={RESULT_TARGET}
          scopeLabel="Exact result"
        />,
      ),
    );
    expect(container.textContent).toContain("0 open");
    await click(button(container, "Add decision request"));
    await enter(
      textarea(container, "Decision needed"),
      '<img src=x onerror="alert(1)"> Choose staging?',
    );
    await click(button(container, "Add request"));
    expect(mutate).toHaveBeenCalledWith({
      type: "decisionRequest.create",
      request: {
        id: expect.stringMatching(/^decision-/u),
        target: RESULT_TARGET,
        prompt: '<img src=x onerror="alert(1)"> Choose staging?',
      },
    });
    await act(async () =>
      root.render(
        <DecisionRequestsCard
          controller={controller(current, mutate)}
          target={RESULT_TARGET}
          scopeLabel="Exact result"
        />,
      ),
    );
    expect(container.textContent).toContain("1 open");
    expect(container.textContent).toContain("Choose staging?");
    expect(container.querySelector("img")).toBeNull();
  });

  it("edits, resolves, reopens, and explicitly confirms removal", async () => {
    let current = reduceCofficeWorkspace(
      workspace(),
      {
        type: "decisionRequest.create",
        request: { id: "decision-a", target: TARGET, prompt: "Choose target" },
      },
      NOW,
    );
    const mutate = vi.fn(async (mutation: WorkspaceMutation) => {
      current = reduceCofficeWorkspace(current, mutation, NOW);
      return { ok: true as const, workspace: current };
    });
    const render = async () =>
      act(async () =>
        root.render(
          <DecisionRequestsCard
            controller={controller(current, mutate)}
            target={TARGET}
            scopeLabel="Work item"
          />,
        ),
      );

    await render();
    await click(button(container, "Edit"));
    expect(button(container, "Resolve").disabled).toBe(true);
    expect(button(container, "Remove").disabled).toBe(true);
    await enter(textarea(container, "Decision needed"), "Choose exact target");
    await click(button(container, "Save request"));
    expect(mutate).toHaveBeenLastCalledWith({
      type: "decisionRequest.update",
      id: "decision-a",
      prompt: "Choose exact target",
    });

    await render();
    await click(button(container, "Resolve"));
    await enter(textarea(container, "Recorded resolution"), "Use staging");
    await click(button(container, "Mark resolved"));
    expect(mutate).toHaveBeenLastCalledWith({
      type: "decisionRequest.resolve",
      id: "decision-a",
      resolution: "Use staging",
    });

    await render();
    expect(container.textContent).toContain("Resolved history (1)");
    await click(button(container, "Reopen"));
    expect(mutate).toHaveBeenLastCalledWith({
      type: "decisionRequest.reopen",
      id: "decision-a",
    });

    await render();
    await click(button(container, "Remove"));
    expect(mutate).toHaveBeenCalledTimes(3);
    await click(button(container, "Confirm remove"));
    expect(mutate).toHaveBeenLastCalledWith({
      type: "decisionRequest.remove",
      id: "decision-a",
    });
  });

  it("keeps a draft when another writer changes the selected request", async () => {
    let current = reduceCofficeWorkspace(
      workspace(),
      {
        type: "decisionRequest.create",
        request: { id: "decision-a", target: TARGET, prompt: "Original" },
      },
      NOW,
    );
    const mutate = vi.fn(async () => ({
      ok: false as const,
      reason: "conflict" as const,
    }));
    await act(async () =>
      root.render(
        <DecisionRequestsCard
          controller={controller(current, mutate)}
          target={TARGET}
          scopeLabel="Work item"
        />,
      ),
    );
    await click(button(container, "Edit"));
    await enter(textarea(container, "Decision needed"), "Unsaved draft");
    current = reduceCofficeWorkspace(
      current,
      {
        type: "decisionRequest.update",
        id: "decision-a",
        prompt: "External edit",
      },
      "2026-08-19T12:01:00.000Z",
    );
    await act(async () =>
      root.render(
        <DecisionRequestsCard
          controller={controller(current, mutate)}
          target={TARGET}
          scopeLabel="Work item"
        />,
      ),
    );
    expect(container.textContent).toContain("Decision changed elsewhere");
    expect(textarea(container, "Decision needed").value).toBe("Unsaved draft");
    expect(button(container, "Save request").disabled).toBe(true);
    expect(mutate).not.toHaveBeenCalled();
  });
});
