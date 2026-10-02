// @vitest-environment happy-dom

import { act, useCallback, useMemo, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  selectLatestClosedTaskWorkContext,
  WorkPlannerPanel,
} from "../src/components/work-planner";
import type { CofficeWorkspaceController } from "../src/components/use-coffice-workspace";
import {
  createEmptyCofficeWorkspace,
  reduceCofficeWorkspace,
  type CofficeWorkspace,
  type WorkspaceMutation,
} from "../src/lib/coffice-workspace";

const NOW = "2026-08-11T14:00:00.000Z";

function normalized(value: string | null | undefined): string {
  return value?.replace(/\s+/gu, " ").trim() ?? "";
}

function buttonNamed(container: HTMLElement, name: string): HTMLButtonElement {
  const button = [
    ...container.querySelectorAll<HTMLButtonElement>("button"),
  ].find(
    (candidate) =>
      normalized(
        candidate.getAttribute("aria-label") ?? candidate.textContent,
      ) === name,
  );
  if (!button) throw new Error(`Missing button named "${name}".`);
  return button;
}

function controlLabelled<T extends HTMLInputElement | HTMLTextAreaElement>(
  container: HTMLElement,
  name: string,
): T {
  const label = [...container.querySelectorAll<HTMLLabelElement>("label")].find(
    (candidate) => normalized(candidate.textContent).startsWith(name),
  );
  const control = label?.control;
  if (!(
    control instanceof HTMLInputElement ||
    control instanceof HTMLTextAreaElement
  )) {
    throw new Error(`Missing form control labelled "${name}".`);
  }
  return control as T;
}

function selectLabelled(
  container: HTMLElement,
  name: string,
): HTMLSelectElement {
  const label = [...container.querySelectorAll<HTMLLabelElement>("label")].find(
    (candidate) => normalized(candidate.textContent).startsWith(name),
  );
  if (!(label?.control instanceof HTMLSelectElement)) {
    throw new Error(`Missing select labelled "${name}".`);
  }
  return label.control;
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.click();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function enterText(
  element: HTMLInputElement | HTMLTextAreaElement,
  value: string,
) {
  const prototype =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  await act(async () => {
    setter?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function selectValue(element: HTMLSelectElement, value: string) {
  await act(async () => {
    element.value = value;
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function milestoneWorkspace(): CofficeWorkspace {
  return reduceCofficeWorkspace(
    createEmptyCofficeWorkspace(NOW),
    {
      type: "project.upsert",
      project: {
        id: "project-a",
        title: "Project A",
        createdAt: NOW,
        updatedAt: NOW,
        objectives: [
          {
            id: "objective-a",
            title: "Ship useful milestones",
            expectedOutcome: "The intended sequence is clear.",
            status: "active",
            createdAt: NOW,
            updatedAt: NOW,
            workItems: [
              {
                id: "work-first",
                title: "First milestone",
                expectedOutcome: "The foundation is ready.",
                status: "planned",
                createdAt: NOW,
                updatedAt: NOW,
                attempts: [],
              },
              {
                id: "work-second",
                title: "Second milestone",
                expectedOutcome: "The useful workflow is complete.",
                status: "in_progress",
                createdAt: NOW,
                updatedAt: NOW,
                attempts: [],
              },
              {
                id: "work-third",
                title: "Third milestone",
                expectedOutcome: "The result is ready to review.",
                status: "ready_for_review",
                createdAt: NOW,
                updatedAt: NOW,
                attempts: [],
              },
            ],
          },
        ],
      },
    },
    NOW,
  );
}

function milestoneOrder(container: HTMLElement): string[] {
  return [
    ...container.querySelectorAll<HTMLElement>("[data-milestone-position]"),
  ].map((article) => normalized(article.querySelector("h4")?.textContent));
}

async function openDefinitionDisclosure(card: HTMLElement) {
  const details = card.querySelector<HTMLDetailsElement>(
    '[data-definition-of-done-current="true"] details',
  );
  if (!details) throw new Error("Missing Definition of Done disclosure.");
  await act(async () => {
    details.open = true;
    details.dispatchEvent(new Event("toggle"));
    await Promise.resolve();
  });
  return details;
}

function expectOpenDefinitionTriggerFocused(card: HTMLElement) {
  const details = card.querySelector<HTMLDetailsElement>(
    '[data-definition-of-done-current="true"] details',
  );
  const trigger = buttonNamed(card, "Edit criteria");
  expect(details?.open).toBe(true);
  expect(trigger.getClientRects().length).toBeGreaterThan(0);
  expect(document.activeElement).toBe(trigger);
}

async function nextFrame() {
  await new Promise<void>((resolve) =>
    window.requestAnimationFrame(() => resolve()),
  );
}

describe("WorkPlannerPanel", () => {
  it("matches the core latest-closed tie break", () => {
    const base = createEmptyCofficeWorkspace(NOW);
    const attempt = (id: string, linkedAt: string) => ({
      id,
      codexTaskId: "task-a",
      relationship: "continuation" as const,
      linkedAt,
      unlinkedAt: NOW,
      resultCycles: [],
    });
    const tied: CofficeWorkspace = {
      ...base,
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
                    attempt("attempt-z", "2026-08-11T13:55:00.000Z"),
                    attempt("attempt-a", "2026-08-11T13:54:00.000Z"),
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    expect(selectLatestClosedTaskWorkContext(tied, "task-a")?.attempt.id).toBe(
      "attempt-z",
    );
  });

  let container: HTMLDivElement;
  let root: Root;
  let mutations: WorkspaceMutation[];

  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const visibleRect = [{} as DOMRect] as unknown as DOMRectList;
    const hiddenRect = [] as unknown as DOMRectList;
    vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(
      function (this: HTMLElement) {
        const details = this.closest("details");
        if (
          details &&
          !details.open &&
          this !== details &&
          this !== details.querySelector("summary")
        ) {
          return hiddenRect;
        }
        return visibleRect;
      },
    );
    mutations = [];
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("creates and edits an objective, then creates and starts a work item", async () => {
    const initial = createEmptyCofficeWorkspace(NOW);

    function Harness() {
      const [workspace, setWorkspace] = useState<CofficeWorkspace>(initial);
      const mutate = useCallback(
        async (mutation: WorkspaceMutation) => {
          mutations.push(mutation);
          const next = reduceCofficeWorkspace(
            workspace,
            mutation,
            new Date().toISOString(),
          );
          setWorkspace(next);
          return { ok: true as const, workspace: next };
        },
        [workspace],
      );
      const controller = useMemo<CofficeWorkspaceController>(
        () => ({
          workspace,
          ready: true,
          persistent: true,
          recovery: { kind: "none" },
          recoveryAcknowledged: true,
          error: null,
          refresh: async () => undefined,
          acknowledgeRecovery: vi.fn(),
          mutate,
          replaceAttentionReview: async () => ({
            ok: false,
            reason: "unavailable",
          }),
          updateAttentionEvent: async () => ({
            ok: false,
            reason: "unavailable",
          }),
        }),
        [mutate, workspace],
      );
      return (
        <WorkPlannerPanel
          project={{ id: "project-a", name: "Project A" }}
          controller={controller}
          onClose={vi.fn()}
        />
      );
    }

    await act(async () => root.render(<Harness />));

    await click(buttonNamed(container, "Set objective"));
    await enterText(
      controlLabelled<HTMLInputElement>(container, "Objective"),
      "Ship a useful command center",
    );
    await enterText(
      controlLabelled<HTMLTextAreaElement>(container, "Definition of success"),
      "A reviewer can plan, inspect, and act without leaving Coffice.",
    );
    await click(buttonNamed(container, "Save objective"));

    expect(mutations[0]).toMatchObject({
      type: "project.upsert",
      project: {
        id: "project-a",
        title: "Project A",
        objectives: [
          {
            title: "Ship a useful command center",
            expectedOutcome:
              "A reviewer can plan, inspect, and act without leaving Coffice.",
            status: "active",
          },
        ],
      },
    });
    expect(container.textContent).toContain("Ship a useful command center");

    await click(buttonNamed(container, "Edit"));
    await enterText(
      controlLabelled<HTMLInputElement>(container, "Objective"),
      "Ship the review command center",
    );
    await click(buttonNamed(container, "Save objective"));
    expect(mutations[1]).toMatchObject({
      type: "objective.upsert",
      projectId: "project-a",
      objective: { title: "Ship the review command center" },
    });

    const addWorkTrigger = buttonNamed(container, "Add work");
    await click(addWorkTrigger);
    await enterText(
      controlLabelled<HTMLInputElement>(container, "Work item"),
      "Verify the review workflow",
    );
    await enterText(
      controlLabelled<HTMLTextAreaElement>(container, "Expected outcome"),
      "A completed Codex task can be accepted or redirected.",
    );
    await click(buttonNamed(container, "Add work item"));
    await act(nextFrame);

    expect(mutations[2]).toMatchObject({
      type: "workItem.upsert",
      projectId: "project-a",
      workItem: {
        title: "Verify the review workflow",
        expectedOutcome:
          "A completed Codex task can be accepted or redirected.",
        status: "planned",
        attempts: [],
      },
    });
    expect(container.textContent).toContain("Verify the review workflow");
    expect(document.activeElement).toBe(addWorkTrigger);

    await click(buttonNamed(container, "Start"));
    expect(mutations[3]).toMatchObject({
      type: "workItem.upsert",
      projectId: "project-a",
      workItem: {
        title: "Verify the review workflow",
        status: "in_progress",
      },
    });
    expect(container.textContent).toContain("In progress");
  });

  it("authors advisory work-item dependencies and handoffs with one intent write", async () => {
    const initial = milestoneWorkspace();

    function Harness() {
      const [workspace, setWorkspace] = useState(initial);
      const mutate = useCallback(
        async (mutation: WorkspaceMutation) => {
          mutations.push(mutation);
          const next = reduceCofficeWorkspace(workspace, mutation, NOW);
          setWorkspace(next);
          return { ok: true as const, workspace: next };
        },
        [workspace],
      );
      const controller = useMemo<CofficeWorkspaceController>(
        () => ({
          workspace,
          ready: true,
          persistent: true,
          recovery: { kind: "none" },
          recoveryAcknowledged: true,
          error: null,
          refresh: async () => undefined,
          acknowledgeRecovery: vi.fn(),
          mutate,
          replaceAttentionReview: vi.fn(),
          updateAttentionEvent: vi.fn(),
        }),
        [mutate, workspace],
      );
      return (
        <WorkPlannerPanel
          project={{ id: "project-a", name: "Project A" }}
          controller={controller}
          onClose={vi.fn()}
        />
      );
    }

    await act(async () => root.render(<Harness />));
    const trigger = buttonNamed(container, "Add work links");
    await click(trigger);
    expect(container.textContent).toContain(
      "Coffice does not infer readiness, change status, or run Codex",
    );
    await click(buttonNamed(container, "Add work link"));
    const kind = selectLabelled(container, "Link 1");
    const target = selectLabelled(container, "Target work item");
    await selectValue(kind, "hands_off_to");
    const thirdTarget = [...target.options].find((option) =>
      normalized(option.textContent).includes("Third milestone"),
    );
    expect(thirdTarget).toBeDefined();
    await selectValue(target, thirdTarget!.value);
    await click(buttonNamed(container, "Save work links"));
    await act(nextFrame);

    expect(mutations).toHaveLength(1);
    expect(mutations[0]).toEqual({
      type: "workItem.relationships.set",
      projectId: "project-a",
      objectiveId: "objective-a",
      workItemId: "work-first",
      relationships: [
        {
          kind: "hands_off_to",
          targetObjectiveId: "objective-a",
          targetWorkItemId: "work-third",
        },
      ],
    });
    expect(container.textContent).toContain("Work links · 1");
    expect(container.textContent).toContain("Hands off to Third milestone");
    expect(document.activeElement).toBe(
      buttonNamed(container, "Edit work links"),
    );
  });

  it("preserves a work-link draft across a concurrent relationship conflict", async () => {
    const initial = milestoneWorkspace();
    let firstAttempt = true;

    function Harness() {
      const [workspace, setWorkspace] = useState(initial);
      const mutate = useCallback(
        async (mutation: WorkspaceMutation) => {
          mutations.push(mutation);
          if (firstAttempt && mutation.type === "workItem.relationships.set") {
            firstAttempt = false;
            const concurrent = reduceCofficeWorkspace(
              workspace,
              {
                type: "workItem.relationships.set",
                projectId: "project-a",
                objectiveId: "objective-a",
                workItemId: "work-first",
                relationships: [
                  {
                    kind: "hands_off_to",
                    targetObjectiveId: "objective-a",
                    targetWorkItemId: "work-third",
                  },
                ],
              },
              NOW,
            );
            setWorkspace(concurrent);
            return {
              ok: false as const,
              reason: "conflict" as const,
              workspace: concurrent,
            };
          }
          const next = reduceCofficeWorkspace(workspace, mutation, NOW);
          setWorkspace(next);
          return { ok: true as const, workspace: next };
        },
        [workspace],
      );
      const controller = useMemo<CofficeWorkspaceController>(
        () => ({
          workspace,
          ready: true,
          persistent: true,
          recovery: { kind: "none" },
          recoveryAcknowledged: true,
          error: null,
          refresh: async () => undefined,
          acknowledgeRecovery: vi.fn(),
          mutate,
          replaceAttentionReview: vi.fn(),
          updateAttentionEvent: vi.fn(),
        }),
        [mutate, workspace],
      );
      return (
        <WorkPlannerPanel
          project={{ id: "project-a", name: "Project A" }}
          controller={controller}
          onClose={vi.fn()}
        />
      );
    }

    await act(async () => root.render(<Harness />));
    await click(buttonNamed(container, "Add work links"));
    await click(buttonNamed(container, "Add work link"));
    await click(buttonNamed(container, "Save work links"));
    expect(container.textContent).toContain("Work links changed elsewhere");
    expect(container.textContent).toContain("Your draft was preserved");
    await click(buttonNamed(container, "Use my draft"));
    expect(container.textContent).toContain(
      "Your preserved draft will replace the latest work links if you save.",
    );
    await click(buttonNamed(container, "Save work links"));

    expect(mutations).toHaveLength(2);
    expect(mutations[0]).toEqual(mutations[1]);
    expect(container.textContent).toContain("Work links saved.");
    expect(container.textContent).toContain("Depends on Second milestone");
  });

  it("flags known project-context concerns and clears them only after confirmation", async () => {
    const initial = milestoneWorkspace();

    function Harness() {
      const [workspace, setWorkspace] = useState(initial);
      const mutate = useCallback(
        async (mutation: WorkspaceMutation) => {
          mutations.push(mutation);
          const next = reduceCofficeWorkspace(workspace, mutation, NOW);
          setWorkspace(next);
          return { ok: true as const, workspace: next };
        },
        [workspace],
      );
      const controller = useMemo<CofficeWorkspaceController>(
        () => ({
          workspace,
          ready: true,
          persistent: true,
          recovery: { kind: "none" },
          recoveryAcknowledged: true,
          error: null,
          refresh: async () => undefined,
          acknowledgeRecovery: vi.fn(),
          mutate,
          replaceAttentionReview: vi.fn(),
          updateAttentionEvent: vi.fn(),
        }),
        [mutate, workspace],
      );
      return (
        <WorkPlannerPanel
          project={{ id: "project-a", name: "Project A" }}
          controller={controller}
          onClose={vi.fn()}
        />
      );
    }

    await act(async () => root.render(<Harness />));
    expect(container.textContent).toContain("No context concerns flagged.");
    await click(buttonNamed(container, "Flag context"));
    const stale = controlLabelled<HTMLInputElement>(container, "Stale");
    const contradictory = controlLabelled<HTMLInputElement>(
      container,
      "Contradictory",
    );
    await click(stale);
    await click(contradictory);
    await enterText(
      controlLabelled<HTMLTextAreaElement>(container, "Review note"),
      "  Reconcile the current release guidance.  ",
    );
    await click(buttonNamed(container, "Save context flag"));

    expect(mutations[0]).toEqual({
      type: "project.contextReview.set",
      projectId: "project-a",
      concerns: ["stale", "contradictory"],
      note: "Reconcile the current release guidance.",
    });
    expect(container.textContent).toContain(
      "Needs context review · Stale + Contradictory",
    );
    expect(container.textContent).toContain(
      "Reconcile the current release guidance.",
    );

    await click(buttonNamed(container, "Mark context reviewed"));
    expect(container.textContent).toContain("Mark current context reviewed?");
    expect(mutations).toHaveLength(1);
    await click(buttonNamed(container, "Back"));
    expect(container.textContent).toContain("Known concern");
    await click(buttonNamed(container, "Cancel"));
    await click(buttonNamed(container, "Mark context reviewed"));
    await click(buttonNamed(container, "Mark reviewed"));

    expect(mutations[1]).toEqual({
      type: "project.contextReview.clear",
      projectId: "project-a",
    });
    expect(container.textContent).toContain("Project context marked reviewed.");
    expect(container.textContent).toContain("No context concerns flagged.");
  });

  it("creates a rules-first plan and saves ordered project rules", async () => {
    const initial = createEmptyCofficeWorkspace(NOW);

    function Harness() {
      const [workspace, setWorkspace] = useState(initial);
      const mutate = useCallback(
        async (mutation: WorkspaceMutation) => {
          mutations.push(mutation);
          const next = reduceCofficeWorkspace(workspace, mutation, NOW);
          setWorkspace(next);
          return { ok: true as const, workspace: next };
        },
        [workspace],
      );
      const controller = useMemo<CofficeWorkspaceController>(
        () => ({
          workspace,
          ready: true,
          persistent: true,
          recovery: { kind: "none" },
          recoveryAcknowledged: true,
          error: null,
          refresh: async () => undefined,
          acknowledgeRecovery: vi.fn(),
          mutate,
          replaceAttentionReview: vi.fn(),
          updateAttentionEvent: vi.fn(),
        }),
        [mutate, workspace],
      );
      return (
        <WorkPlannerPanel
          project={{ id: "project-a", name: "Project A" }}
          controller={controller}
          onClose={vi.fn()}
        />
      );
    }

    await act(async () => root.render(<Harness />));
    expect(container.textContent).toContain("No project rules recorded.");
    expect(container.textContent).toContain(
      "Saving the first rule also creates this project's local Coffice plan.",
    );
    const trigger = buttonNamed(container, "Add project rules");
    await click(trigger);
    expect(container.textContent).toContain("Editing draft");
    expect(container.textContent).not.toContain("Not recorded");
    await click(buttonNamed(container, "Add rule"));
    await act(nextFrame);
    const first = controlLabelled<HTMLTextAreaElement>(
      container,
      "Project rule 1",
    );
    expect(document.activeElement).toBe(first);
    await enterText(first, "  Keep private paths out of reports.  ");
    await click(buttonNamed(container, "Add rule"));
    await act(nextFrame);
    const second = controlLabelled<HTMLTextAreaElement>(
      container,
      "Project rule 2",
    );
    await enterText(second, "Review every user-visible change.");
    await click(buttonNamed(container, "Move project rule 2 up"));
    await act(nextFrame);
    expect(document.activeElement?.closest("[data-project-rule-row-key]")).toBe(
      second.closest("[data-project-rule-row-key]"),
    );
    await click(buttonNamed(container, "Save rules"));
    await act(nextFrame);

    expect(mutations).toHaveLength(1);
    expect(mutations[0]).toMatchObject({
      type: "project.upsert",
      project: {
        id: "project-a",
        title: "Project A",
        rules: [
          "Review every user-visible change.",
          "Keep private paths out of reports.",
        ],
        objectives: [],
      },
    });
    expect(
      container.querySelector('[data-project-rules-status="true"]')
        ?.textContent,
    ).toContain("Project rules saved.");
    expect(document.activeElement).toBe(buttonNamed(container, "Edit rules"));
    expect(
      container.querySelector<HTMLDetailsElement>(
        "[data-project-rules] details",
      )?.open,
    ).toBe(true);
    expect(buttonNamed(container, "Set objective").disabled).toBe(false);
  });

  it("creates a quality-bars-first plan with one atomic save", async () => {
    const initial = createEmptyCofficeWorkspace(NOW);

    function Harness() {
      const [workspace, setWorkspace] = useState(initial);
      const mutate = useCallback(
        async (mutation: WorkspaceMutation) => {
          mutations.push(mutation);
          const next = reduceCofficeWorkspace(workspace, mutation, NOW);
          setWorkspace(next);
          return { ok: true as const, workspace: next };
        },
        [workspace],
      );
      return (
        <WorkPlannerPanel
          project={{ id: "project-a", name: "Project A" }}
          controller={{
            workspace,
            ready: true,
            persistent: true,
            recovery: { kind: "none" },
            recoveryAcknowledged: true,
            error: null,
            refresh: async () => undefined,
            acknowledgeRecovery: vi.fn(),
            mutate,
            replaceAttentionReview: vi.fn(),
            updateAttentionEvent: vi.fn(),
          }}
          onClose={vi.fn()}
        />
      );
    }

    await act(async () => root.render(<Harness />));
    expect(container.textContent).toContain("No quality bars selected.");
    expect(container.textContent).toContain(
      "Saving the first selection also creates this project's local Coffice plan.",
    );
    await click(buttonNamed(container, "Set quality bars"));
    expect(document.activeElement).toBe(
      controlLabelled<HTMLInputElement>(container, "Tests"),
    );
    expect(buttonNamed(container, "Set objective").disabled).toBe(true);
    await click(controlLabelled<HTMLInputElement>(container, "Tests"));
    await click(controlLabelled<HTMLInputElement>(container, "Lint"));
    expect(mutations).toHaveLength(0);
    await click(buttonNamed(container, "Save quality bars"));
    await act(nextFrame);

    expect(mutations).toEqual([
      expect.objectContaining({
        type: "project.upsert",
        project: expect.objectContaining({
          id: "project-a",
          title: "Project A",
          qualityBars: [
            { profileId: "test", profileVersion: "1" },
            { profileId: "lint", profileVersion: "1" },
          ],
          objectives: [],
        }),
      }),
    ]);
    expect(
      container.querySelector('[data-project-quality-bars-status="true"]')
        ?.textContent,
    ).toContain("Quality bars saved.");
    expect(
      container.querySelector<HTMLDetailsElement>(
        '[data-project-quality-bars="true"] details',
      )?.open,
    ).toBe(true);
    expect(document.activeElement).toBe(
      buttonNamed(container, "Edit quality bars"),
    );
  });

  it("uses the dedicated quality-bar mutation and confirms a clear without losing the draft", async () => {
    const initial = milestoneWorkspace();
    initial.projects[0].qualityBars = [
      { profileId: "test", profileVersion: "1" },
      { profileId: "typecheck", profileVersion: "1" },
    ];

    function Harness() {
      const [workspace, setWorkspace] = useState(initial);
      const mutate = useCallback(
        async (mutation: WorkspaceMutation) => {
          mutations.push(mutation);
          const next = reduceCofficeWorkspace(workspace, mutation, NOW);
          setWorkspace(next);
          return { ok: true as const, workspace: next };
        },
        [workspace],
      );
      return (
        <WorkPlannerPanel
          project={{ id: "project-a", name: "Project A" }}
          controller={{
            workspace,
            ready: true,
            persistent: true,
            recovery: { kind: "none" },
            recoveryAcknowledged: true,
            error: null,
            refresh: async () => undefined,
            acknowledgeRecovery: vi.fn(),
            mutate,
            replaceAttentionReview: vi.fn(),
            updateAttentionEvent: vi.fn(),
          }}
          onClose={vi.fn()}
        />
      );
    }

    await act(async () => root.render(<Harness />));
    const details = container.querySelector<HTMLDetailsElement>(
      '[data-project-quality-bars="true"] details',
    )!;
    await act(async () => {
      details.open = true;
      details.dispatchEvent(new Event("toggle"));
    });
    await click(buttonNamed(container, "Edit quality bars"));
    await click(controlLabelled<HTMLInputElement>(container, "Type check"));
    await click(
      controlLabelled<HTMLInputElement>(container, "Production build"),
    );
    await click(buttonNamed(container, "Save quality bars"));
    await act(nextFrame);
    expect(mutations.at(-1)).toEqual({
      type: "project.qualityBars.set",
      projectId: "project-a",
      qualityBars: [
        { profileId: "test", profileVersion: "1" },
        { profileId: "build", profileVersion: "1" },
      ],
    });

    await click(buttonNamed(container, "Edit quality bars"));
    await click(buttonNamed(container, "Clear quality bars"));
    expect(document.activeElement).toBe(buttonNamed(container, "Back"));
    await click(buttonNamed(container, "Back"));
    await act(nextFrame);
    expect(controlLabelled<HTMLInputElement>(container, "Tests").checked).toBe(
      true,
    );
    expect(
      controlLabelled<HTMLInputElement>(container, "Production build").checked,
    ).toBe(true);
    await click(buttonNamed(container, "Clear quality bars"));
    await click(buttonNamed(container, "Clear quality bars"));
    await act(nextFrame);
    expect(mutations.at(-1)).toEqual({
      type: "project.qualityBars.set",
      projectId: "project-a",
      qualityBars: [],
    });
    expect(container.textContent).toContain("No quality bars selected.");
    expect(document.activeElement).toBe(
      buttonNamed(container, "Set quality bars"),
    );
  });

  it("preserves a conflicted quality-bar selection and never recreates a removed plan", async () => {
    const initial = milestoneWorkspace();
    initial.projects[0].qualityBars = [
      { profileId: "test", profileVersion: "1" },
    ];
    let publishBars!: (
      profileIds: Array<"test" | "typecheck" | "lint" | "build">,
    ) => void;
    let removeProject!: () => void;
    let failNext = true;

    function Harness() {
      const [workspace, setWorkspace] = useState(initial);
      publishBars = (profileIds) =>
        setWorkspace((current) => ({
          ...current,
          projects: current.projects.map((candidate) =>
            candidate.id === "project-a"
              ? {
                  ...candidate,
                  qualityBars: profileIds.map((profileId) => ({
                    profileId,
                    profileVersion: "1" as const,
                  })),
                }
              : candidate,
          ),
        }));
      removeProject = () =>
        setWorkspace((current) => ({ ...current, projects: [] }));
      const mutate = useCallback(
        async (mutation: WorkspaceMutation) => {
          mutations.push(mutation);
          if (failNext) {
            failNext = false;
            return { ok: false as const, reason: "conflict" as const };
          }
          const next = reduceCofficeWorkspace(workspace, mutation, NOW);
          setWorkspace(next);
          return { ok: true as const, workspace: next };
        },
        [workspace],
      );
      return (
        <WorkPlannerPanel
          project={{ id: "project-a", name: "Project A" }}
          controller={{
            workspace,
            ready: true,
            persistent: true,
            recovery: { kind: "none" },
            recoveryAcknowledged: true,
            error: null,
            refresh: async () => undefined,
            acknowledgeRecovery: vi.fn(),
            mutate,
            replaceAttentionReview: vi.fn(),
            updateAttentionEvent: vi.fn(),
          }}
          onClose={vi.fn()}
        />
      );
    }

    await act(async () => root.render(<Harness />));
    const details = container.querySelector<HTMLDetailsElement>(
      '[data-project-quality-bars="true"] details',
    )!;
    await act(async () => {
      details.open = true;
      details.dispatchEvent(new Event("toggle"));
    });
    await click(buttonNamed(container, "Edit quality bars"));
    await click(controlLabelled<HTMLInputElement>(container, "Lint"));
    await click(buttonNamed(container, "Save quality bars"));
    await act(nextFrame);
    expect(container.textContent).toContain("Workspace changed elsewhere");
    expect(container.textContent).toContain("Tests");
    expect(container.textContent).toContain("Lint");
    await click(buttonNamed(container, "Use my selection"));
    expect(controlLabelled<HTMLInputElement>(container, "Lint").checked).toBe(
      true,
    );
    expect(container.textContent).toContain(
      "Your preserved selection will replace the latest quality bars if you save.",
    );

    await act(async () => publishBars(["typecheck"]));
    expect(container.textContent).toContain("Quality bars changed elsewhere");
    await act(async () => removeProject());
    expect(container.textContent).toContain("Project plan removed elsewhere");
    expect(container.textContent).toContain("Tests");
    expect(container.textContent).toContain("Lint");
    expect(
      [...container.querySelectorAll("button")].some((button) =>
        ["Use my selection", "Review latest quality bars"].includes(
          normalized(button.textContent),
        ),
      ),
    ).toBe(false);
    const attemptsBeforeCancel = mutations.length;
    await click(buttonNamed(container, "Cancel"));
    await act(nextFrame);
    expect(mutations).toHaveLength(attemptsBeforeCancel);
    expect(document.activeElement).toBe(
      buttonNamed(container, "Set quality bars"),
    );
  });

  it("validates, removes, reorders, clears, and restores focus for project rules", async () => {
    const initial = milestoneWorkspace();
    initial.projects[0].rules = ["Keep first", "Keep second"];
    const mutations: WorkspaceMutation[] = [];

    function Harness() {
      const [workspace, setWorkspace] = useState(initial);
      const mutate = useCallback(
        async (mutation: WorkspaceMutation) => {
          mutations.push(mutation);
          const next = reduceCofficeWorkspace(workspace, mutation, NOW);
          setWorkspace(next);
          return { ok: true as const, workspace: next };
        },
        [workspace],
      );
      return (
        <WorkPlannerPanel
          project={{ id: "project-a", name: "Project A" }}
          controller={{
            workspace,
            ready: true,
            persistent: true,
            recovery: { kind: "none" },
            recoveryAcknowledged: true,
            error: null,
            refresh: async () => undefined,
            acknowledgeRecovery: vi.fn(),
            mutate,
            replaceAttentionReview: vi.fn(),
            updateAttentionEvent: vi.fn(),
          }}
          onClose={vi.fn()}
        />
      );
    }

    await act(async () => root.render(<Harness />));
    const details = container.querySelector<HTMLDetailsElement>(
      "[data-project-rules] details",
    )!;
    await act(async () => {
      details.open = true;
      details.dispatchEvent(new Event("toggle"));
    });
    await click(buttonNamed(container, "Edit rules"));
    await click(buttonNamed(container, "Add rule"));
    await click(buttonNamed(container, "Save rules"));
    expect(
      container.querySelector('[data-project-rules-status="true"]')
        ?.textContent,
    ).toContain("Enter rule text or remove the empty row.");
    expect(document.activeElement).toBe(
      controlLabelled<HTMLTextAreaElement>(container, "Project rule 3"),
    );
    await click(buttonNamed(container, "Remove project rule 3"));
    await act(nextFrame);
    expect(document.activeElement).toBe(
      controlLabelled<HTMLTextAreaElement>(container, "Project rule 2"),
    );

    await click(buttonNamed(container, "Clear rules"));
    expect(document.activeElement).toBe(buttonNamed(container, "Back"));
    await click(buttonNamed(container, "Back"));
    await act(nextFrame);
    expect(
      controlLabelled<HTMLTextAreaElement>(container, "Project rule 1").value,
    ).toBe("Keep first");
    await click(buttonNamed(container, "Clear rules"));
    await act(async () => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
      await nextFrame();
    });
    expect(
      controlLabelled<HTMLTextAreaElement>(container, "Project rule 2").value,
    ).toBe("Keep second");

    await click(buttonNamed(container, "Clear rules"));
    await click(buttonNamed(container, "Clear rules"));
    await act(nextFrame);
    expect(mutations.at(-1)).toEqual({
      type: "project.rules.set",
      projectId: "project-a",
      rules: [],
    });
    expect(container.textContent).toContain("No project rules recorded.");
    expect(document.activeElement).toBe(
      buttonNamed(container, "Add project rules"),
    );
  });

  it("preserves a conflicted rules draft, distinguishes unrelated conflicts, and loads latest explicitly", async () => {
    const initial = milestoneWorkspace();
    initial.projects[0].rules = ["Original rule"];
    let publishRules!: (rules: string[]) => void;
    let failNext = true;

    function Harness() {
      const [workspace, setWorkspace] = useState(initial);
      publishRules = (rules) =>
        setWorkspace((current) => ({
          ...current,
          projects: current.projects.map((candidate) =>
            candidate.id === "project-a" ? { ...candidate, rules } : candidate,
          ),
        }));
      const mutate = useCallback(
        async (mutation: WorkspaceMutation) => {
          mutations.push(mutation);
          if (failNext) {
            failNext = false;
            return { ok: false as const, reason: "conflict" as const };
          }
          const next = reduceCofficeWorkspace(workspace, mutation, NOW);
          setWorkspace(next);
          return { ok: true as const, workspace: next };
        },
        [workspace],
      );
      return (
        <WorkPlannerPanel
          project={{ id: "project-a", name: "Project A" }}
          controller={{
            workspace,
            ready: true,
            persistent: true,
            recovery: { kind: "none" },
            recoveryAcknowledged: true,
            error: null,
            refresh: async () => undefined,
            acknowledgeRecovery: vi.fn(),
            mutate,
            replaceAttentionReview: vi.fn(),
            updateAttentionEvent: vi.fn(),
          }}
          onClose={vi.fn()}
        />
      );
    }

    await act(async () => root.render(<Harness />));
    const details = container.querySelector<HTMLDetailsElement>(
      "[data-project-rules] details",
    )!;
    await act(async () => {
      details.open = true;
      details.dispatchEvent(new Event("toggle"));
    });
    await click(buttonNamed(container, "Edit rules"));
    await enterText(
      controlLabelled<HTMLTextAreaElement>(container, "Project rule 1"),
      "Preserve my rule draft",
    );
    await click(buttonNamed(container, "Save rules"));
    await act(nextFrame);
    expect(container.textContent).toContain("Workspace changed elsewhere");
    expect(container.textContent).toContain(
      "The workspace changed elsewhere. Your project-rules draft was not overwritten.",
    );
    expect(document.activeElement).toBe(
      container.querySelector('[role="alert"]'),
    );
    await click(buttonNamed(container, "Use my draft"));
    expect(
      controlLabelled<HTMLTextAreaElement>(container, "Project rule 1").value,
    ).toBe("Preserve my rule draft");
    expect(container.textContent).toContain(
      "Your preserved draft will replace the latest rules if you save. Review it first.",
    );

    await act(async () => publishRules(["Latest external rule"]));
    expect(container.textContent).toContain("Project rules changed elsewhere");
    await click(buttonNamed(container, "Review latest rules"));
    expect(document.activeElement).toBe(
      buttonNamed(container, "Keep my draft"),
    );
    await click(buttonNamed(container, "Keep my draft"));
    expect(container.textContent).toContain("Project rules changed elsewhere");
    await click(buttonNamed(container, "Review latest rules"));
    await click(buttonNamed(container, "Load latest rules"));
    await act(nextFrame);
    expect(
      controlLabelled<HTMLTextAreaElement>(container, "Project rule 1").value,
    ).toBe("Latest external rule");
  });

  it("freezes clear confirmation navigation while project rules are saving", async () => {
    const initial = milestoneWorkspace();
    initial.projects[0].rules = ["Rule to clear"];
    const confirmation = deferred<void>();
    const captured: WorkspaceMutation[] = [];

    function Harness() {
      const [workspace, setWorkspace] = useState(initial);
      const mutate = useCallback(
        async (mutation: WorkspaceMutation) => {
          captured.push(mutation);
          await confirmation.promise;
          const next = reduceCofficeWorkspace(workspace, mutation, NOW);
          setWorkspace(next);
          return { ok: true as const, workspace: next };
        },
        [workspace],
      );
      return (
        <WorkPlannerPanel
          project={{ id: "project-a", name: "Project A" }}
          controller={{
            workspace,
            ready: true,
            persistent: true,
            recovery: { kind: "none" },
            recoveryAcknowledged: true,
            error: null,
            refresh: async () => undefined,
            acknowledgeRecovery: vi.fn(),
            mutate,
            replaceAttentionReview: vi.fn(),
            updateAttentionEvent: vi.fn(),
          }}
          onClose={vi.fn()}
        />
      );
    }

    await act(async () => root.render(<Harness />));
    const details = container.querySelector<HTMLDetailsElement>(
      "[data-project-rules] details",
    )!;
    await act(async () => {
      details.open = true;
      details.dispatchEvent(new Event("toggle"));
    });
    await click(buttonNamed(container, "Edit rules"));
    await click(buttonNamed(container, "Clear rules"));
    await click(buttonNamed(container, "Clear rules"));

    expect(captured).toEqual([
      {
        type: "project.rules.set",
        projectId: "project-a",
        rules: [],
      },
    ]);
    expect(buttonNamed(container, "Back").disabled).toBe(true);
    expect(buttonNamed(container, "Clear rules").disabled).toBe(true);
    await act(async () => {
      buttonNamed(container, "Back").dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
      await nextFrame();
    });
    expect(container.textContent).toContain("Clear all current project rules?");

    await act(async () => {
      confirmation.resolve();
      await confirmation.promise;
      await nextFrame();
    });
    expect(container.textContent).toContain("No project rules recorded.");
    expect(document.activeElement).toBe(
      buttonNamed(container, "Add project rules"),
    );
  });

  it("keeps an orphaned rules draft copyable and never recreates a removed plan", async () => {
    const initial = milestoneWorkspace();
    initial.projects[0].rules = ["Original rule"];
    let removeProject!: () => void;
    let publishRules!: (rules: string[]) => void;
    const mutate = vi.fn<CofficeWorkspaceController["mutate"]>();

    function Harness() {
      const [workspace, setWorkspace] = useState(initial);
      publishRules = (rules) =>
        setWorkspace((current) => ({
          ...current,
          projects: current.projects.map((candidate) =>
            candidate.id === "project-a" ? { ...candidate, rules } : candidate,
          ),
        }));
      removeProject = () =>
        setWorkspace((current) => ({ ...current, projects: [] }));
      return (
        <WorkPlannerPanel
          project={{ id: "project-a", name: "Project A" }}
          controller={{
            workspace,
            ready: true,
            persistent: true,
            recovery: { kind: "none" },
            recoveryAcknowledged: true,
            error: null,
            refresh: async () => undefined,
            acknowledgeRecovery: vi.fn(),
            mutate,
            replaceAttentionReview: vi.fn(),
            updateAttentionEvent: vi.fn(),
          }}
          onClose={vi.fn()}
        />
      );
    }

    await act(async () => root.render(<Harness />));
    const details = container.querySelector<HTMLDetailsElement>(
      "[data-project-rules] details",
    )!;
    await act(async () => {
      details.open = true;
      details.dispatchEvent(new Event("toggle"));
    });
    await click(buttonNamed(container, "Edit rules"));
    await enterText(
      controlLabelled<HTMLTextAreaElement>(container, "Project rule 1"),
      "Copyable orphan draft",
    );
    await act(async () => publishRules(["Changed elsewhere"]));
    expect(container.textContent).toContain("Project rules changed elsewhere");
    await click(buttonNamed(container, "Review latest rules"));
    expect(document.activeElement).toBe(
      buttonNamed(container, "Keep my draft"),
    );
    await act(async () => removeProject());

    expect(
      container.querySelector('[data-project-rules-orphaned="true"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain("Copyable orphan draft");
    expect(
      [...container.querySelectorAll("button")].some((button) =>
        ["Use my draft", "Review latest rules", "Load latest rules"].includes(
          normalized(button.textContent),
        ),
      ),
    ).toBe(false);
    expect(document.activeElement).toBe(
      container.querySelector('[data-project-rules-orphaned="true"]'),
    );
    await click(buttonNamed(container, "Cancel"));
    await act(nextFrame);
    expect(container.querySelector("[data-project-rules-editor]")).toBeNull();
    expect(document.activeElement).toBe(
      buttonNamed(container, "Add project rules"),
    );
    expect(mutate).not.toHaveBeenCalled();
  });

  it("locks rule mutations when persistence becomes unsafe but keeps Cancel available", async () => {
    const initial = milestoneWorkspace();
    initial.projects[0].rules = ["Existing rule"];
    let setUnsafe!: (recovery: boolean) => void;

    function Harness() {
      const [unsafe, setUnsafeState] = useState(false);
      const [recovery, setRecovery] = useState(false);
      setUnsafe = (nextRecovery) => {
        setUnsafeState(!nextRecovery);
        setRecovery(nextRecovery);
      };
      const controller: CofficeWorkspaceController = {
        workspace: initial,
        ready: true,
        persistent: !unsafe,
        recovery: recovery
          ? { kind: "backup", reason: "primary-corrupt" }
          : { kind: "none" },
        recoveryAcknowledged: !recovery,
        error: null,
        refresh: async () => undefined,
        acknowledgeRecovery: vi.fn(),
        mutate: vi.fn(),
        replaceAttentionReview: vi.fn(),
        updateAttentionEvent: vi.fn(),
      };
      return (
        <WorkPlannerPanel
          project={{ id: "project-a", name: "Project A" }}
          controller={controller}
          onClose={vi.fn()}
        />
      );
    }

    await act(async () => root.render(<Harness />));
    const details = container.querySelector<HTMLDetailsElement>(
      "[data-project-rules] details",
    )!;
    await act(async () => {
      details.open = true;
      details.dispatchEvent(new Event("toggle"));
    });
    await click(buttonNamed(container, "Edit rules"));
    await act(async () => setUnsafe(false));
    expect(container.textContent).toContain(
      "The local Coffice workspace is unavailable. Project rules cannot be changed.",
    );
    for (const name of ["Add rule", "Save rules", "Clear rules"]) {
      expect(buttonNamed(container, name).disabled).toBe(true);
    }
    expect(buttonNamed(container, "Cancel").disabled).toBe(false);

    await act(async () => setUnsafe(true));
    expect(container.textContent).toContain(
      "Review and acknowledge the recovered workspace before changing project rules.",
    );
    expect(buttonNamed(container, "Save rules").disabled).toBe(true);
    expect(buttonNamed(container, "Cancel").disabled).toBe(false);
    await click(buttonNamed(container, "Cancel"));
  });

  it("distinguishes a recovery review lock from an unavailable store", async () => {
    const workspace = createEmptyCofficeWorkspace(NOW);
    const base: CofficeWorkspaceController = {
      workspace,
      ready: true,
      persistent: false,
      recovery: { kind: "backup", reason: "primary-corrupt" },
      recoveryAcknowledged: false,
      error: null,
      refresh: async () => undefined,
      acknowledgeRecovery: vi.fn(),
      mutate: vi.fn(),
      replaceAttentionReview: vi.fn(),
      updateAttentionEvent: vi.fn(),
    };
    const render = async (controller: CofficeWorkspaceController) =>
      await act(async () =>
        root.render(
          <WorkPlannerPanel
            project={{ id: "project-a", name: "Project A" }}
            controller={controller}
            onClose={vi.fn()}
          />,
        ),
      );

    await render(base);
    expect(container.textContent).toContain("recovered this plan");
    expect(container.textContent).not.toContain("store is unavailable");
    expect(
      container
        .querySelector('[data-work-planner="true"]')
        ?.contains(document.activeElement),
    ).toBe(true);
    expect(document.activeElement).not.toBe(
      buttonNamed(container, "Set objective"),
    );

    await render({
      ...base,
      persistent: true,
      recoveryAcknowledged: true,
    });
    expect(container.textContent).not.toContain("recovered this plan");
    expect(container.textContent).not.toContain("store is unavailable");
  });

  it("shows project decisions between the objective and milestones only for a saved project", async () => {
    const workspace = milestoneWorkspace();
    const value: CofficeWorkspaceController = {
      workspace,
      ready: true,
      persistent: true,
      recovery: { kind: "none" },
      recoveryAcknowledged: true,
      error: null,
      refresh: vi.fn(async () => undefined),
      acknowledgeRecovery: vi.fn(),
      mutate: vi.fn(),
      replaceAttentionReview: vi.fn(),
      updateAttentionEvent: vi.fn(),
    };
    const render = async (
      project: Parameters<typeof WorkPlannerPanel>[0]["project"],
      controller: CofficeWorkspaceController = value,
    ) =>
      await act(async () =>
        root.render(
          <WorkPlannerPanel
            project={project}
            controller={controller}
            onClose={vi.fn()}
          />,
        ),
      );

    await render({ id: "project-a", name: "Project A" });
    const objective = [...container.querySelectorAll("section")].find(
      (section) =>
        normalized(section.textContent).startsWith("Current objective"),
    );
    const decisions = container.querySelector(
      '[data-project-decision-log="project-a"]',
    );
    const milestones = [...container.querySelectorAll("section")].find(
      (section) => normalized(section.textContent).startsWith("Milestones"),
    );
    expect(objective).toBeTruthy();
    expect(decisions).toBeTruthy();
    expect(milestones).toBeTruthy();
    expect(
      objective!.compareDocumentPosition(decisions!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      decisions!.compareDocumentPosition(milestones!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    await render({ id: "project-a", name: "Project A", holding: true });
    expect(container.querySelector("[data-project-decision-log]")).toBeNull();

    await render(
      { id: "project-new", name: "New project" },
      { ...value, workspace: createEmptyCofficeWorkspace(NOW) },
    );
    expect(container.querySelector("[data-project-decision-log]")).toBeNull();
  });

  it("uses Escape to close a decision editor before closing Plan", async () => {
    const onClose = vi.fn();
    const workspace = milestoneWorkspace();
    const controller: CofficeWorkspaceController = {
      workspace,
      ready: true,
      persistent: true,
      recovery: { kind: "none" },
      recoveryAcknowledged: true,
      error: null,
      refresh: vi.fn(async () => undefined),
      acknowledgeRecovery: vi.fn(),
      mutate: vi.fn(),
      replaceAttentionReview: vi.fn(),
      updateAttentionEvent: vi.fn(),
    };
    await act(async () =>
      root.render(
        <WorkPlannerPanel
          project={{ id: "project-a", name: "Project A" }}
          controller={controller}
          onClose={onClose}
        />,
      ),
    );

    await click(buttonNamed(container, "Record decision"));
    await act(nextFrame);
    const decision = controlLabelled<HTMLTextAreaElement>(
      container,
      "Decision",
    );
    expect(document.activeElement).toBe(decision);
    await act(async () => {
      decision.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    await act(nextFrame);
    expect(onClose).not.toHaveBeenCalled();
    expect(container.querySelector("form")).toBeNull();
    expect(document.activeElement).toBe(
      buttonNamed(container, "Record decision"),
    );

    await act(async () => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders confirmed work-item order as milestones and persists one-step moves", async () => {
    const initial = milestoneWorkspace();
    const confirmation = deferred<void>();

    function Harness() {
      const [workspace, setWorkspace] = useState(initial);
      const mutate = useCallback(
        async (mutation: WorkspaceMutation) => {
          mutations.push(mutation);
          await confirmation.promise;
          const next = reduceCofficeWorkspace(
            workspace,
            mutation,
            "2026-08-11T14:01:00.000Z",
          );
          setWorkspace(next);
          return { ok: true as const, workspace: next };
        },
        [workspace],
      );
      const controller = useMemo<CofficeWorkspaceController>(
        () => ({
          workspace,
          ready: true,
          persistent: true,
          recovery: { kind: "none" },
          recoveryAcknowledged: true,
          error: null,
          refresh: async () => undefined,
          acknowledgeRecovery: vi.fn(),
          mutate,
          replaceAttentionReview: vi.fn(),
          updateAttentionEvent: vi.fn(),
        }),
        [mutate, workspace],
      );
      return (
        <WorkPlannerPanel
          project={{ id: "project-a", name: "Project A" }}
          controller={controller}
          onClose={vi.fn()}
        />
      );
    }

    await act(async () => root.render(<Harness />));

    expect(container.textContent).toContain("Milestones");
    expect(container.textContent).toContain("Ordered outcomes");
    expect(container.textContent).toContain(
      "Order guides what comes next; it does not block other work.",
    );
    expect(milestoneOrder(container)).toEqual([
      "First milestone",
      "Second milestone",
      "Third milestone",
    ]);
    expect(container.textContent).toContain("Milestone 1 · Planned");

    await click(buttonNamed(container, "Change order"));
    expect(container.textContent).not.toContain("The foundation is ready.");
    const moveLater = buttonNamed(
      container,
      "Move milestone 1, First milestone, later",
    );
    moveLater.focus();
    await click(moveLater);

    expect(mutations[0]).toEqual({
      type: "workItem.reorder",
      projectId: "project-a",
      objectiveId: "objective-a",
      orderedWorkItemIds: ["work-second", "work-first", "work-third"],
    });
    expect(milestoneOrder(container)).toEqual([
      "First milestone",
      "Second milestone",
      "Third milestone",
    ]);
    expect(container.textContent).toContain("Saving milestone order…");
    expect(
      buttonNamed(container, "Move milestone 2, Second milestone, earlier")
        .disabled,
    ).toBe(true);

    await act(async () => {
      confirmation.resolve();
      await confirmation.promise;
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(nextFrame);

    expect(milestoneOrder(container)).toEqual([
      "Second milestone",
      "First milestone",
      "Third milestone",
    ]);
    expect(container.textContent).toContain(
      "Moved First milestone to milestone 2 of 3.",
    );
    expect(document.activeElement).toBe(
      buttonNamed(container, "Move milestone 2, First milestone, later"),
    );

    await click(
      buttonNamed(container, "Move milestone 2, First milestone, later"),
    );
    await act(nextFrame);
    expect(milestoneOrder(container)).toEqual([
      "Second milestone",
      "Third milestone",
      "First milestone",
    ]);
    expect(mutations[1]).toEqual({
      type: "workItem.reorder",
      projectId: "project-a",
      objectiveId: "objective-a",
      orderedWorkItemIds: ["work-second", "work-third", "work-first"],
    });
    expect(document.activeElement).toBe(
      buttonNamed(container, "Move milestone 3, First milestone, earlier"),
    );

    await click(buttonNamed(container, "Done"));
    await act(nextFrame);
    expect(container.textContent).toContain("The foundation is ready.");
    expect(container.textContent).not.toContain(
      "Moved First milestone to milestone 3 of 3.",
    );
    expect(document.activeElement).toBe(buttonNamed(container, "Change order"));

    const addWorkTrigger = buttonNamed(container, "Add work");
    await click(addWorkTrigger);
    await enterText(
      controlLabelled<HTMLInputElement>(container, "Work item"),
      "Fourth milestone",
    );
    await enterText(
      controlLabelled<HTMLTextAreaElement>(container, "Expected outcome"),
      "The next outcome remains last in the sequence.",
    );
    await click(buttonNamed(container, "Add work item"));
    await act(nextFrame);
    expect(mutations[2]).toMatchObject({
      type: "workItem.upsert",
      projectId: "project-a",
      objectiveId: "objective-a",
      workItem: { title: "Fourth milestone" },
    });
    expect(milestoneOrder(container)).toEqual([
      "Second milestone",
      "Third milestone",
      "First milestone",
      "Fourth milestone",
    ]);
    expect(document.activeElement).toBe(addWorkTrigger);
  });

  it("keeps Done available when a failed save locks or shrinks the confirmed plan", async () => {
    const initial = milestoneWorkspace();
    let shrinkConfirmedPlan!: () => void;

    function Harness() {
      const [workspace, setWorkspace] = useState(initial);
      const [persistent, setPersistent] = useState(true);
      shrinkConfirmedPlan = () =>
        setWorkspace((current) => ({
          ...current,
          projects: current.projects.map((candidateProject) =>
            candidateProject.id !== "project-a"
              ? candidateProject
              : {
                  ...candidateProject,
                  objectives: candidateProject.objectives.map(
                    (candidateObjective) =>
                      candidateObjective.id !== "objective-a"
                        ? candidateObjective
                        : {
                            ...candidateObjective,
                            workItems: candidateObjective.workItems.slice(0, 1),
                          },
                  ),
                },
          ),
        }));
      const mutate = useCallback(async () => {
        setPersistent(false);
        return {
          ok: false as const,
          reason: "unavailable" as const,
        };
      }, []);
      const controller = useMemo<CofficeWorkspaceController>(
        () => ({
          workspace,
          ready: true,
          persistent,
          recovery: { kind: "none" },
          recoveryAcknowledged: true,
          error: null,
          refresh: async () => undefined,
          acknowledgeRecovery: vi.fn(),
          mutate,
          replaceAttentionReview: vi.fn(),
          updateAttentionEvent: vi.fn(),
        }),
        [mutate, persistent, workspace],
      );
      return (
        <WorkPlannerPanel
          project={{ id: "project-a", name: "Project A" }}
          controller={controller}
          onClose={vi.fn()}
        />
      );
    }

    await act(async () => root.render(<Harness />));
    await click(buttonNamed(container, "Change order"));
    const trigger = buttonNamed(
      container,
      "Move milestone 1, First milestone, later",
    );
    trigger.focus();
    await click(trigger);
    await act(nextFrame);

    expect(milestoneOrder(container)).toEqual([
      "First milestone",
      "Second milestone",
      "Third milestone",
    ]);
    expect(container.textContent).toContain(
      "The milestone order was not saved. Review the latest plan and try again.",
    );
    const done = buttonNamed(container, "Done");
    expect(done.disabled).toBe(false);
    expect(document.activeElement).toBe(done);

    await act(async () => shrinkConfirmedPlan());
    expect(milestoneOrder(container)).toEqual(["First milestone"]);
    expect(buttonNamed(container, "Done").disabled).toBe(false);

    await click(buttonNamed(container, "Done"));
    await act(nextFrame);
    expect(container.textContent).not.toContain(
      "The milestone order was not saved.",
    );
    expect(
      [...container.querySelectorAll("button")].some((button) =>
        normalized(button.getAttribute("aria-label")).startsWith(
          "Move milestone ",
        ),
      ),
    ).toBe(false);
    expect(document.activeElement).toBe(
      buttonNamed(container, "Close project plan"),
    );
  });

  it("uses milestone positions to disambiguate duplicate titles and preserve move focus", async () => {
    const initial = milestoneWorkspace();
    initial.projects[0].objectives[0].workItems[0].title = "Repeated milestone";
    initial.projects[0].objectives[0].workItems[2].title = "Repeated milestone";
    const mutations: WorkspaceMutation[] = [];

    function Harness() {
      const [workspace, setWorkspace] = useState(initial);
      const mutate = useCallback(
        async (mutation: WorkspaceMutation) => {
          mutations.push(mutation);
          const next = reduceCofficeWorkspace(
            workspace,
            mutation,
            "2026-08-11T14:02:00.000Z",
          );
          setWorkspace(next);
          return { ok: true as const, workspace: next };
        },
        [workspace],
      );
      const controller = useMemo<CofficeWorkspaceController>(
        () => ({
          workspace,
          ready: true,
          persistent: true,
          recovery: { kind: "none" },
          recoveryAcknowledged: true,
          error: null,
          refresh: async () => undefined,
          acknowledgeRecovery: vi.fn(),
          mutate,
          replaceAttentionReview: vi.fn(),
          updateAttentionEvent: vi.fn(),
        }),
        [mutate, workspace],
      );
      return (
        <WorkPlannerPanel
          project={{ id: "project-a", name: "Project A" }}
          controller={controller}
          onClose={vi.fn()}
        />
      );
    }

    await act(async () => root.render(<Harness />));
    await click(buttonNamed(container, "Change order"));

    expect(
      container.querySelectorAll(
        '[role="group"][aria-label="Change order for milestone 1, Repeated milestone"]',
      ),
    ).toHaveLength(1);
    expect(
      container.querySelectorAll(
        '[role="group"][aria-label="Change order for milestone 3, Repeated milestone"]',
      ),
    ).toHaveLength(1);
    expect(
      container.querySelectorAll(
        'button[aria-label="Move milestone 1, Repeated milestone, later"]',
      ),
    ).toHaveLength(1);
    expect(
      container.querySelectorAll(
        'button[aria-label="Move milestone 3, Repeated milestone, earlier"]',
      ),
    ).toHaveLength(1);

    const firstMoveLater = buttonNamed(
      container,
      "Move milestone 1, Repeated milestone, later",
    );
    firstMoveLater.focus();
    await click(firstMoveLater);
    await act(nextFrame);

    expect(mutations[0]).toEqual({
      type: "workItem.reorder",
      projectId: "project-a",
      objectiveId: "objective-a",
      orderedWorkItemIds: ["work-second", "work-first", "work-third"],
    });
    expect(document.activeElement).toBe(
      buttonNamed(container, "Move milestone 2, Repeated milestone, later"),
    );
  });

  it("keeps an unsaved milestone draft and submit focus after append failure", async () => {
    const workspace = milestoneWorkspace();
    const controller: CofficeWorkspaceController = {
      workspace,
      ready: true,
      persistent: true,
      recovery: { kind: "none" },
      recoveryAcknowledged: true,
      error: null,
      refresh: async () => undefined,
      acknowledgeRecovery: vi.fn(),
      mutate: vi.fn(async () => ({
        ok: false as const,
        reason: "conflict" as const,
      })),
      replaceAttentionReview: vi.fn(),
      updateAttentionEvent: vi.fn(),
    };

    await act(async () =>
      root.render(
        <WorkPlannerPanel
          project={{ id: "project-a", name: "Project A" }}
          controller={controller}
          onClose={vi.fn()}
        />,
      ),
    );
    await click(buttonNamed(container, "Add work"));
    const title = controlLabelled<HTMLInputElement>(container, "Work item");
    const outcome = controlLabelled<HTMLTextAreaElement>(
      container,
      "Expected outcome",
    );
    await enterText(title, "Keep this milestone draft");
    await enterText(outcome, "The draft remains available to retry.");
    const submit = buttonNamed(container, "Add work item");
    submit.focus();
    await click(submit);

    expect(title.value).toBe("Keep this milestone draft");
    expect(outcome.value).toBe("The draft remains available to retry.");
    expect(container.textContent).toContain(
      "The work item was not saved. Review the latest plan and try again.",
    );
    expect(document.activeElement).toBe(submit);
  });

  it("authors optional done criteria while creating work and sends their exact order", async () => {
    const workspace = milestoneWorkspace();
    const mutate = vi.fn(async () => ({
      ok: true as const,
      workspace,
    }));
    const controller: CofficeWorkspaceController = {
      workspace,
      ready: true,
      persistent: true,
      recovery: { kind: "none" },
      recoveryAcknowledged: true,
      error: null,
      refresh: async () => undefined,
      acknowledgeRecovery: vi.fn(),
      mutate,
      replaceAttentionReview: vi.fn(),
      updateAttentionEvent: vi.fn(),
    };

    await act(async () =>
      root.render(
        <WorkPlannerPanel
          project={{ id: "project-a", name: "Project A" }}
          controller={controller}
          onClose={vi.fn()}
        />,
      ),
    );
    await click(buttonNamed(container, "Add work"));
    await enterText(
      controlLabelled<HTMLInputElement>(container, "Work item"),
      "Definition-aware milestone",
    );
    await enterText(
      controlLabelled<HTMLTextAreaElement>(container, "Expected outcome"),
      "Reviewers can use explicit completion criteria.",
    );

    await click(buttonNamed(container, "Add criterion"));
    await act(nextFrame);
    let first = controlLabelled<HTMLTextAreaElement>(
      container,
      "Done criterion 1",
    );
    expect(document.activeElement).toBe(first);
    await click(buttonNamed(container, "Add work item"));
    expect(container.textContent).toContain(
      "Enter criterion text or remove the empty row.",
    );
    expect(document.activeElement).toBe(first);
    expect(mutate).not.toHaveBeenCalled();

    await click(buttonNamed(container, "Remove criterion 1"));
    await act(nextFrame);
    expect(document.activeElement).toBe(
      buttonNamed(container, "Add criterion"),
    );
    await click(buttonNamed(container, "Add criterion"));
    await act(nextFrame);
    first = controlLabelled<HTMLTextAreaElement>(container, "Done criterion 1");

    await enterText(first, "  Review passes  ");
    await click(buttonNamed(container, "Add criterion"));
    await act(nextFrame);
    const second = controlLabelled<HTMLTextAreaElement>(
      container,
      "Done criterion 2",
    );
    expect(document.activeElement).toBe(second);
    await enterText(second, "Documentation is current");
    await click(buttonNamed(container, "Move criterion 2 earlier"));
    await act(nextFrame);
    expect(document.activeElement).toBe(
      controlLabelled<HTMLTextAreaElement>(container, "Done criterion 1"),
    );
    await click(buttonNamed(container, "Add criterion"));
    await act(nextFrame);
    await enterText(
      controlLabelled<HTMLTextAreaElement>(container, "Done criterion 3"),
      "Remove this draft",
    );
    await click(buttonNamed(container, "Remove criterion 3"));
    await act(nextFrame);
    expect(document.activeElement).toBe(
      controlLabelled<HTMLTextAreaElement>(container, "Done criterion 2"),
    );

    await click(buttonNamed(container, "Add work item"));
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith({
      type: "workItem.upsert",
      projectId: "project-a",
      objectiveId: "objective-a",
      workItem: expect.objectContaining({
        title: "Definition-aware milestone",
        expectedOutcome: "Reviewers can use explicit completion criteria.",
        definitionOfDone: ["Documentation is current", "Review passes"],
        status: "planned",
        attempts: [],
      }),
    });
  });

  it("adds, reorders, removes, and saves existing criteria with the dedicated mutation", async () => {
    const workspace = milestoneWorkspace();
    workspace.projects[0].objectives[0].workItems[0].definitionOfDone = [
      "Keep first",
      "Remove second",
    ];
    const mutate = vi.fn(async () => ({
      ok: true as const,
      workspace,
    }));
    const controller: CofficeWorkspaceController = {
      workspace,
      ready: true,
      persistent: true,
      recovery: { kind: "none" },
      recoveryAcknowledged: true,
      error: null,
      refresh: async () => undefined,
      acknowledgeRecovery: vi.fn(),
      mutate,
      replaceAttentionReview: vi.fn(),
      updateAttentionEvent: vi.fn(),
    };

    await act(async () =>
      root.render(
        <WorkPlannerPanel
          project={{ id: "project-a", name: "Project A" }}
          controller={controller}
          onClose={vi.fn()}
        />,
      ),
    );
    const firstCard = container.querySelector<HTMLElement>(
      '[data-milestone-position="1"]',
    )!;
    expect(firstCard.querySelector<HTMLDetailsElement>("details")?.open).toBe(
      false,
    );
    await openDefinitionDisclosure(firstCard);
    await click(buttonNamed(container, "Edit criteria"));
    await click(buttonNamed(container, "Add criterion"));
    await act(nextFrame);
    await enterText(
      controlLabelled<HTMLTextAreaElement>(container, "Done criterion 3"),
      "Added third",
    );
    await click(buttonNamed(container, "Move criterion 3 earlier"));
    await act(nextFrame);
    expect(document.activeElement).toBe(
      buttonNamed(container, "Move criterion 2 earlier"),
    );
    await click(buttonNamed(container, "Remove criterion 3"));
    await act(nextFrame);
    expect(document.activeElement).toBe(
      controlLabelled<HTMLTextAreaElement>(container, "Done criterion 2"),
    );
    await click(buttonNamed(container, "Save changes"));
    await act(nextFrame);

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith({
      type: "workItem.definitionOfDone.set",
      projectId: "project-a",
      objectiveId: "objective-a",
      workItemId: "work-first",
      definitionOfDone: ["Keep first", "Added third"],
    });
    expectOpenDefinitionTriggerFocused(firstCard);
    expect(
      container.querySelector('[data-definition-of-done-status="true"]')
        ?.textContent,
    ).toContain("Definition of Done saved.");
  });

  it("keeps a nonempty Definition of Done disclosure open across Cancel and Escape", async () => {
    const workspace = milestoneWorkspace();
    workspace.projects[0].objectives[0].workItems[0].definitionOfDone = [
      "Visible criterion",
    ];
    const controller: CofficeWorkspaceController = {
      workspace,
      ready: true,
      persistent: true,
      recovery: { kind: "none" },
      recoveryAcknowledged: true,
      error: null,
      refresh: async () => undefined,
      acknowledgeRecovery: vi.fn(),
      mutate: vi.fn(),
      replaceAttentionReview: vi.fn(),
      updateAttentionEvent: vi.fn(),
    };

    await act(async () =>
      root.render(
        <WorkPlannerPanel
          project={{ id: "project-a", name: "Project A" }}
          controller={controller}
          onClose={vi.fn()}
        />,
      ),
    );
    const firstCard = container.querySelector<HTMLElement>(
      '[data-milestone-position="1"]',
    )!;
    await openDefinitionDisclosure(firstCard);
    await click(buttonNamed(firstCard, "Edit criteria"));
    await click(buttonNamed(firstCard, "Cancel"));
    await act(nextFrame);
    expectOpenDefinitionTriggerFocused(firstCard);

    await click(buttonNamed(firstCard, "Edit criteria"));
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    await act(nextFrame);
    expectOpenDefinitionTriggerFocused(firstCard);
  });

  it("keeps an empty clear draft when Back or Escape leaves confirmation", async () => {
    const workspace = milestoneWorkspace();
    workspace.projects[0].objectives[0].workItems[0].definitionOfDone = [
      "Only criterion",
    ];
    const mutate = vi.fn(async () => ({ ok: true as const, workspace }));
    const controller: CofficeWorkspaceController = {
      workspace,
      ready: true,
      persistent: true,
      recovery: { kind: "none" },
      recoveryAcknowledged: true,
      error: null,
      refresh: async () => undefined,
      acknowledgeRecovery: vi.fn(),
      mutate,
      replaceAttentionReview: vi.fn(),
      updateAttentionEvent: vi.fn(),
    };

    await act(async () =>
      root.render(
        <WorkPlannerPanel
          project={{ id: "project-a", name: "Project A" }}
          controller={controller}
          onClose={vi.fn()}
        />,
      ),
    );
    const firstCard = container.querySelector<HTMLElement>(
      '[data-milestone-position="1"]',
    )!;
    await openDefinitionDisclosure(firstCard);
    await click(buttonNamed(firstCard, "Edit criteria"));
    await click(buttonNamed(container, "Remove criterion 1"));
    await act(nextFrame);
    const addCriterion = buttonNamed(container, "Add criterion");
    expect(document.activeElement).toBe(addCriterion);

    await click(buttonNamed(container, "Save changes"));
    expect(document.activeElement).toBe(buttonNamed(container, "Back"));
    await click(buttonNamed(container, "Back"));
    await act(nextFrame);
    expect(document.activeElement).toBe(
      buttonNamed(container, "Add criterion"),
    );
    expect(
      container.querySelectorAll("[data-definition-row-key]"),
    ).toHaveLength(0);

    await click(buttonNamed(container, "Save changes"));
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    await act(nextFrame);
    expect(
      container.querySelectorAll("[data-definition-row-key]"),
    ).toHaveLength(0);
    expect(document.activeElement).toBe(
      buttonNamed(container, "Add criterion"),
    );
    expect(mutate).not.toHaveBeenCalled();

    await click(buttonNamed(container, "Save changes"));
    await click(buttonNamed(container, "Remove criteria"));
    await act(nextFrame);
    expect(mutate).toHaveBeenCalledWith({
      type: "workItem.definitionOfDone.set",
      projectId: "project-a",
      objectiveId: "objective-a",
      workItemId: "work-first",
      definitionOfDone: [],
    });
    expect(document.activeElement).toBe(
      buttonNamed(container, "Edit criteria"),
    );
  });

  it("preserves a conflicted criteria draft and sends it unchanged on retry", async () => {
    const workspace = milestoneWorkspace();
    workspace.projects[0].objectives[0].workItems[0].definitionOfDone = [
      "Original criterion",
    ];
    const mutate = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false as const,
        reason: "conflict" as const,
      })
      .mockResolvedValueOnce({ ok: true as const, workspace });
    const controller: CofficeWorkspaceController = {
      workspace,
      ready: true,
      persistent: true,
      recovery: { kind: "none" },
      recoveryAcknowledged: true,
      error: null,
      refresh: async () => undefined,
      acknowledgeRecovery: vi.fn(),
      mutate,
      replaceAttentionReview: vi.fn(),
      updateAttentionEvent: vi.fn(),
    };

    await act(async () =>
      root.render(
        <WorkPlannerPanel
          project={{ id: "project-a", name: "Project A" }}
          controller={controller}
          onClose={vi.fn()}
        />,
      ),
    );
    const firstCard = container.querySelector<HTMLElement>(
      '[data-milestone-position="1"]',
    )!;
    await openDefinitionDisclosure(firstCard);
    await click(buttonNamed(firstCard, "Edit criteria"));
    const criterion = controlLabelled<HTMLTextAreaElement>(
      container,
      "Done criterion 1",
    );
    await enterText(criterion, "Preserve this retry draft");
    await click(buttonNamed(container, "Save changes"));

    expect(criterion.value).toBe("Preserve this retry draft");
    expect(container.textContent).toContain(
      "The workspace changed elsewhere. Your draft was not overwritten.",
    );
    await click(buttonNamed(container, "Save changes"));
    const expected = {
      type: "workItem.definitionOfDone.set",
      projectId: "project-a",
      objectiveId: "objective-a",
      workItemId: "work-first",
      definitionOfDone: ["Preserve this retry draft"],
    };
    expect(mutate).toHaveBeenNthCalledWith(1, expected);
    expect(mutate).toHaveBeenNthCalledWith(2, expected);
    expect(container.textContent).toContain("Definition of Done saved.");
    await act(nextFrame);
    expectOpenDefinitionTriggerFocused(firstCard);
  });

  it("does not overwrite a draft changed elsewhere and can explicitly load the latest criteria", async () => {
    const initial = milestoneWorkspace();
    initial.projects[0].objectives[0].workItems[0].definitionOfDone = [
      "Original criterion",
    ];
    let publishExternalChange!: (criterion: string) => void;

    function Harness() {
      const [workspace, setWorkspace] = useState(initial);
      publishExternalChange = (criterion) =>
        setWorkspace((current) => ({
          ...current,
          projects: current.projects.map((project) => ({
            ...project,
            objectives: project.objectives.map((objective) => ({
              ...objective,
              workItems: objective.workItems.map((item) =>
                item.id === "work-first"
                  ? { ...item, definitionOfDone: [criterion] }
                  : item,
              ),
            })),
          })),
        }));
      const controller = useMemo<CofficeWorkspaceController>(
        () => ({
          workspace,
          ready: true,
          persistent: true,
          recovery: { kind: "none" },
          recoveryAcknowledged: true,
          error: null,
          refresh: async () => undefined,
          acknowledgeRecovery: vi.fn(),
          mutate: vi.fn(),
          replaceAttentionReview: vi.fn(),
          updateAttentionEvent: vi.fn(),
        }),
        [workspace],
      );
      return (
        <WorkPlannerPanel
          project={{ id: "project-a", name: "Project A" }}
          controller={controller}
          onClose={vi.fn()}
        />
      );
    }

    await act(async () => root.render(<Harness />));
    const firstCard = container.querySelector<HTMLElement>(
      '[data-milestone-position="1"]',
    )!;
    await openDefinitionDisclosure(firstCard);
    await click(buttonNamed(firstCard, "Edit criteria"));
    await enterText(
      controlLabelled<HTMLTextAreaElement>(container, "Done criterion 1"),
      "Keep my unsaved draft",
    );
    await act(async () => publishExternalChange("Latest external criterion"));

    expect(container.textContent).toContain(
      "Definition of Done changed elsewhere. Your draft was not overwritten.",
    );
    expect(
      [...container.querySelectorAll("button")].some(
        (button) => normalized(button.textContent) === "Save changes",
      ),
    ).toBe(false);
    await click(buttonNamed(container, "Use my draft"));
    await act(nextFrame);
    expect(
      controlLabelled<HTMLTextAreaElement>(container, "Done criterion 1").value,
    ).toBe("Keep my unsaved draft");
    expect(container.textContent).toContain(
      "Your preserved draft will replace the latest criteria if you save. Review it first.",
    );

    await act(async () => publishExternalChange("Second external criterion"));
    await click(buttonNamed(container, "Load latest criteria"));
    expect(document.activeElement).toBe(
      buttonNamed(container, "Keep my draft"),
    );
    await click(buttonNamed(container, "Keep my draft"));
    expect(container.textContent).toContain(
      "Definition of Done changed elsewhere. Your draft was not overwritten.",
    );
    await click(buttonNamed(container, "Use my draft"));
    expect(
      controlLabelled<HTMLTextAreaElement>(container, "Done criterion 1").value,
    ).toBe("Keep my unsaved draft");
    await act(async () => publishExternalChange("Third external criterion"));
    await click(buttonNamed(container, "Load latest criteria"));
    await click(buttonNamed(container, "Discard draft and load latest"));
    await act(nextFrame);
    const latest = controlLabelled<HTMLTextAreaElement>(
      container,
      "Done criterion 1",
    );
    expect(latest.value).toBe("Third external criterion");
    expect(document.activeElement).toBe(latest);

    await click(buttonNamed(container, "Remove criterion 1"));
    await click(buttonNamed(container, "Save changes"));
    expect(document.activeElement).toBe(buttonNamed(container, "Back"));
    await act(async () =>
      publishExternalChange("Changed while confirming clear"),
    );
    expect(container.textContent).toContain(
      "Definition of Done changed elsewhere. Your draft was not overwritten.",
    );
    expect(
      [...container.querySelectorAll("button")].some(
        (button) => normalized(button.textContent) === "Remove criteria",
      ),
    ).toBe(false);
    expect(
      container.querySelectorAll("[data-definition-row-key]"),
    ).toHaveLength(0);
    await click(buttonNamed(container, "Cancel"));
    await act(nextFrame);
    expectOpenDefinitionTriggerFocused(firstCard);
  });

  it("disables Definition of Done editing when saving is unsafe and uses qualitative limit errors", async () => {
    const workspace = milestoneWorkspace();
    workspace.projects[0].objectives[0].workItems[0].definitionOfDone = [
      "Existing criterion",
    ];
    const controller = (
      persistent: boolean,
      recovery: CofficeWorkspaceController["recovery"] = { kind: "none" },
      recoveryAcknowledged = true,
    ): CofficeWorkspaceController => ({
      workspace,
      ready: true,
      persistent,
      recovery,
      recoveryAcknowledged,
      error: null,
      refresh: async () => undefined,
      acknowledgeRecovery: vi.fn(),
      mutate: vi.fn(),
      replaceAttentionReview: vi.fn(),
      updateAttentionEvent: vi.fn(),
    });

    await act(async () =>
      root.render(
        <WorkPlannerPanel
          project={{ id: "project-a", name: "Project A" }}
          controller={controller(false)}
          onClose={vi.fn()}
        />,
      ),
    );
    const expectDefinitionTriggersDisabled = () => {
      expect(buttonNamed(container, "Edit criteria").disabled).toBe(true);
      expect(buttonNamed(container, "Define done").disabled).toBe(true);
    };
    expectDefinitionTriggersDisabled();

    await act(async () =>
      root.render(
        <WorkPlannerPanel
          project={{ id: "project-a", name: "Project A" }}
          controller={controller(
            true,
            { kind: "backup", reason: "primary-corrupt" },
            false,
          )}
          onClose={vi.fn()}
        />,
      ),
    );
    expectDefinitionTriggersDisabled();

    const holdingController = controller(true);
    await act(async () =>
      root.render(
        <WorkPlannerPanel
          project={{ id: "project-a", name: "Project A", holding: true }}
          controller={holdingController}
          onClose={vi.fn()}
        />,
      ),
    );
    expectDefinitionTriggersDisabled();

    const enabled = controller(true);
    await act(async () =>
      root.render(
        <WorkPlannerPanel
          project={{ id: "project-a", name: "Project A" }}
          controller={enabled}
          onClose={vi.fn()}
        />,
      ),
    );
    await click(buttonNamed(container, "Edit criteria"));
    await enterText(
      controlLabelled<HTMLTextAreaElement>(container, "Done criterion 1"),
      "x".repeat(10_000),
    );
    await click(buttonNamed(container, "Save changes"));
    const announcement = container.querySelector<HTMLElement>(
      '[data-definition-of-done-status="true"]',
    );
    expect(announcement?.textContent).toContain(
      "One criterion is too long to save safely.",
    );
    expect(announcement?.textContent).not.toMatch(/\d/u);
    expect(enabled.mutate).not.toHaveBeenCalled();
  });

  it("keeps a removed work item's draft visible and moves focus to a safe exit", async () => {
    const initial = milestoneWorkspace();
    initial.projects[0].objectives[0].workItems[0].definitionOfDone = [
      "Original criterion",
    ];
    let removeEditedItem!: () => void;
    let removeEditedObjective!: () => void;

    function Harness() {
      const [workspace, setWorkspace] = useState(initial);
      removeEditedItem = () =>
        setWorkspace((current) => ({
          ...current,
          projects: current.projects.map((project) => ({
            ...project,
            objectives: project.objectives.map((objective) => ({
              ...objective,
              workItems: objective.workItems.filter(
                (item) => item.id !== "work-first",
              ),
            })),
          })),
        }));
      removeEditedObjective = () =>
        setWorkspace((current) => ({
          ...current,
          projects: current.projects.map((project) => ({
            ...project,
            objectives: [],
          })),
        }));
      const controller = useMemo<CofficeWorkspaceController>(
        () => ({
          workspace,
          ready: true,
          persistent: true,
          recovery: { kind: "none" },
          recoveryAcknowledged: true,
          error: null,
          refresh: async () => undefined,
          acknowledgeRecovery: vi.fn(),
          mutate: vi.fn(),
          replaceAttentionReview: vi.fn(),
          updateAttentionEvent: vi.fn(),
        }),
        [workspace],
      );
      return (
        <WorkPlannerPanel
          project={{ id: "project-a", name: "Project A" }}
          controller={controller}
          onClose={vi.fn()}
        />
      );
    }

    await act(async () => root.render(<Harness />));
    await click(buttonNamed(container, "Edit criteria"));
    await enterText(
      controlLabelled<HTMLTextAreaElement>(container, "Done criterion 1"),
      "Preserved after removal",
    );
    await act(async () => removeEditedItem());

    expect(
      container.querySelector('[data-definition-of-done-orphaned="true"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain(
      "This work item was removed elsewhere. Your Definition of Done draft was not overwritten and cannot be saved.",
    );
    expect(container.textContent).toContain("Preserved after removal");
    expect(document.activeElement).toBe(buttonNamed(container, "Cancel"));
    await click(buttonNamed(container, "Cancel"));
    await act(nextFrame);
    expect(
      container.querySelector('[data-definition-of-done-orphaned="true"]'),
    ).toBeNull();
    expect(document.activeElement).toBe(
      container.querySelector('[aria-label="Close project plan"]'),
    );

    await act(async () => root.render(<Harness key="objective-removal" />));
    await click(buttonNamed(container, "Edit criteria"));
    await enterText(
      controlLabelled<HTMLTextAreaElement>(container, "Done criterion 1"),
      "Preserved after objective removal",
    );
    await act(async () => removeEditedObjective());
    expect(
      container.querySelector('[data-definition-of-done-orphaned="true"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain(
      "Preserved after objective removal",
    );
    expect(document.activeElement).toBe(buttonNamed(container, "Cancel"));
  });

  it("schedules a recurring project review and completes it only after confirmation", async () => {
    const scheduledWorkspace = reduceCofficeWorkspace(
      milestoneWorkspace(),
      {
        type: "project.reviewSchedule.set",
        projectId: "project-a",
        nextReviewAt: "2026-08-25T09:00:00.000Z",
        repeatEveryDays: 7,
      },
      NOW,
    );
    const mutate = vi.fn(async () => ({
      ok: true as const,
      workspace: scheduledWorkspace,
    }));
    const controller: CofficeWorkspaceController = {
      workspace: scheduledWorkspace,
      ready: true,
      persistent: true,
      recovery: { kind: "none" },
      recoveryAcknowledged: true,
      error: null,
      refresh: async () => undefined,
      acknowledgeRecovery: vi.fn(),
      mutate,
      replaceAttentionReview: vi.fn(),
      updateAttentionEvent: vi.fn(),
    };
    await act(async () =>
      root.render(
        <WorkPlannerPanel
          project={{ id: "project-a", name: "Project A" }}
          controller={controller}
          onClose={vi.fn()}
        />,
      ),
    );

    expect(container.textContent).toContain("Repeats every 7 days");
    await click(buttonNamed(container, "Edit schedule"));
    const due = controlLabelled<HTMLInputElement>(container, "Next review");
    await enterText(due, "2026-08-30T09:30");
    await enterText(
      controlLabelled<HTMLInputElement>(container, "Repeat every"),
      "14",
    );
    await click(buttonNamed(container, "Save schedule"));
    expect(mutate).toHaveBeenLastCalledWith({
      type: "project.reviewSchedule.set",
      projectId: "project-a",
      nextReviewAt: new Date("2026-08-30T09:30").toISOString(),
      repeatEveryDays: 14,
    });

    await act(async () =>
      root.render(
        <WorkPlannerPanel
          project={{ id: "project-a", name: "Project A" }}
          controller={controller}
          onClose={vi.fn()}
        />,
      ),
    );
    await click(buttonNamed(container, "Edit schedule"));
    await click(buttonNamed(container, "Mark reviewed"));
    expect(container.textContent).toContain(
      "No quality check runs automatically.",
    );
    expect(document.activeElement).toBe(buttonNamed(container, "Back"));
    await click(buttonNamed(container, "Mark project reviewed"));
    expect(mutate).toHaveBeenLastCalledWith({
      type: "project.reviewSchedule.complete",
      projectId: "project-a",
    });
  });

  it("creates the first local project shell when scheduling a review without a saved plan", async () => {
    const workspace = createEmptyCofficeWorkspace(NOW);
    const mutate = vi.fn(async () => ({
      ok: true as const,
      workspace,
    }));
    const controller: CofficeWorkspaceController = {
      workspace,
      ready: true,
      persistent: true,
      recovery: { kind: "none" },
      recoveryAcknowledged: true,
      error: null,
      refresh: async () => undefined,
      acknowledgeRecovery: vi.fn(),
      mutate,
      replaceAttentionReview: vi.fn(),
      updateAttentionEvent: vi.fn(),
    };
    await act(async () =>
      root.render(
        <WorkPlannerPanel
          project={{ id: "project-new", name: "New Project" }}
          controller={controller}
          onClose={vi.fn()}
        />,
      ),
    );
    await click(buttonNamed(container, "Schedule review"));
    await enterText(
      controlLabelled<HTMLInputElement>(container, "Next review"),
      "2026-09-01T10:00",
    );
    await click(buttonNamed(container, "Save schedule"));
    expect(mutate).toHaveBeenCalledWith({
      type: "project.upsert",
      project: expect.objectContaining({
        id: "project-new",
        title: "New Project",
        objectives: [],
        reviewSchedule: expect.objectContaining({
          nextReviewAt: new Date("2026-09-01T10:00").toISOString(),
          authorship: "user",
        }),
      }),
    });
  });

  it("uses Escape to leave order mode before closing the Plan dialog", async () => {
    const workspace = milestoneWorkspace();
    const onClose = vi.fn();
    const controller: CofficeWorkspaceController = {
      workspace,
      ready: true,
      persistent: true,
      recovery: { kind: "none" },
      recoveryAcknowledged: true,
      error: null,
      refresh: async () => undefined,
      acknowledgeRecovery: vi.fn(),
      mutate: vi.fn(),
      replaceAttentionReview: vi.fn(),
      updateAttentionEvent: vi.fn(),
    };
    await act(async () =>
      root.render(
        <WorkPlannerPanel
          project={{ id: "project-a", name: "Project A" }}
          controller={controller}
          onClose={onClose}
        />,
      ),
    );
    await click(buttonNamed(container, "Change order"));

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
      await nextFrame();
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(buttonNamed(container, "Change order"));
    expect(
      [...container.querySelectorAll("button")].some((button) =>
        normalized(button.getAttribute("aria-label")).startsWith(
          "Move milestone ",
        ),
      ),
    ).toBe(false);

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("locks ordering when persistence or recovered-plan review is unavailable", async () => {
    const workspace = milestoneWorkspace();
    const render = async (controller: CofficeWorkspaceController) =>
      await act(async () =>
        root.render(
          <WorkPlannerPanel
            project={{ id: "project-a", name: "Project A" }}
            controller={controller}
            onClose={vi.fn()}
          />,
        ),
      );
    const base: CofficeWorkspaceController = {
      workspace,
      ready: true,
      persistent: true,
      recovery: { kind: "backup", reason: "primary-corrupt" },
      recoveryAcknowledged: false,
      error: null,
      refresh: async () => undefined,
      acknowledgeRecovery: vi.fn(),
      mutate: vi.fn(),
      replaceAttentionReview: vi.fn(),
      updateAttentionEvent: vi.fn(),
    };

    await render(base);
    expect(buttonNamed(container, "Change order").disabled).toBe(true);

    await render({
      ...base,
      persistent: false,
      recovery: { kind: "none" },
      recoveryAcknowledged: true,
    });
    expect(buttonNamed(container, "Change order").disabled).toBe(true);
  });

  it("opens an exact archived result and offers a live-task path only when it exists", async () => {
    const target = {
      projectId: "project-a",
      objectiveId: "objective-a",
      workItemId: "work-a",
      attemptId: "attempt-archived",
      resultKey: { kind: "revision" as const, id: "result-a" },
    };
    const workspace = {
      ...reduceCofficeWorkspace(
        createEmptyCofficeWorkspace(NOW),
        {
          type: "project.upsert" as const,
          project: {
            id: "project-a",
            title: "Project A",
            createdAt: NOW,
            updatedAt: NOW,
            objectives: [
              {
                id: "objective-a",
                title: "Ship reliable review",
                status: "active" as const,
                createdAt: NOW,
                updatedAt: NOW,
                workItems: [
                  {
                    id: "work-a",
                    title: "Verify the durable result",
                    expectedOutcome:
                      "The exact saved result passes its checks.",
                    status: "ready_for_review" as const,
                    createdAt: NOW,
                    updatedAt: NOW,
                    attempts: [
                      {
                        id: "attempt-archived",
                        codexTaskId: "archived-task",
                        relationship: "primary" as const,
                        linkedAt: NOW,
                        resultCycles: [
                          {
                            key: target.resultKey,
                            observedAt: "2026-08-11T13:58:00.000Z",
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        },
        NOW,
      ),
      verificationReceipts: [
        {
          id: "receipt-failed",
          idempotencyKey: "verification-one",
          requestHash: "hash-one",
          target,
          profile: { id: "test", version: "1" },
          checks: [
            {
              id: "test",
              version: "1",
              state: "failed" as const,
              queuedAt: "2026-08-11T13:58:10.000Z",
              startedAt: "2026-08-11T13:58:11.000Z",
              completedAt: "2026-08-11T13:58:12.000Z",
              failureKind: "exit" as const,
              exitCode: 1,
            },
          ],
          state: "failed" as const,
          queuedAt: "2026-08-11T13:58:10.000Z",
          startedAt: "2026-08-11T13:58:11.000Z",
          completedAt: "2026-08-11T13:58:12.000Z",
        },
      ],
    };
    const controller: CofficeWorkspaceController = {
      workspace,
      ready: true,
      persistent: true,
      recovery: { kind: "none" },
      recoveryAcknowledged: true,
      error: null,
      refresh: async () => undefined,
      acknowledgeRecovery: vi.fn(),
      mutate: vi.fn(async () => ({
        ok: true as const,
        workspace,
      })),
      replaceAttentionReview: vi.fn(),
      updateAttentionEvent: vi.fn(),
    };

    await act(async () => {
      root.render(
        <WorkPlannerPanel
          project={{ id: "project-a", name: "Project A" }}
          controller={controller}
          focusTarget={target}
          onClose={vi.fn()}
        />,
      );
      await new Promise<void>((resolve) =>
        window.requestAnimationFrame(() => resolve()),
      );
    });

    const storedContext = container.querySelector<HTMLElement>(
      '[data-stored-result-context="true"]',
    );
    expect(storedContext).not.toBeNull();
    expect(storedContext?.textContent).toContain("Verify the durable result");
    expect(storedContext?.textContent).toContain("Ship reliable review");
    expect(storedContext?.textContent).toContain("Result 1 of 1");
    expect(storedContext?.textContent).toContain("Tests · Failed · exit 1");
    expect(storedContext?.textContent).toContain("2026-08-11 13:58 UTC");
    expect(
      storedContext?.querySelector('[data-stored-verification-state="failed"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-stored-result-work-item="true"]'),
    ).not.toBeNull();
    expect(document.activeElement).toBe(storedContext);
    expect(
      [...container.querySelectorAll("button")].some(
        (button) => normalized(button.textContent) === "Review live task",
      ),
    ).toBe(false);

    const exactAssessment = storedContext?.querySelector<HTMLElement>(
      '[data-review-assessment="result"]',
    );
    expect(exactAssessment?.textContent).toContain("Nothing recorded");
    await click(buttonNamed(exactAssessment!, "Record notes"));
    await enterText(
      controlLabelled<HTMLTextAreaElement>(exactAssessment!, "Your assessment"),
      "Historical result note",
    );
    await click(buttonNamed(exactAssessment!, "Save notes"));
    expect(controller.mutate).toHaveBeenCalledWith({
      type: "assessment.set",
      assessment: expect.objectContaining({
        target,
        reviewSummary: "Historical result note",
      }),
    });

    const onOpenLiveTask = vi.fn();
    await act(async () =>
      root.render(
        <WorkPlannerPanel
          project={{
            id: "project-a",
            name: "Project A",
            liveTaskLocations: new Map([["archived-task", "project-b"]]),
          }}
          controller={controller}
          focusTarget={target}
          onOpenLiveTask={onOpenLiveTask}
          onClose={vi.fn()}
        />,
      ),
    );
    await click(buttonNamed(container, "Review live task"));
    expect(onOpenLiveTask).toHaveBeenCalledWith("project-b", "archived-task");
  });
});
