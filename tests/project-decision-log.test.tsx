// @vitest-environment happy-dom

import { act, useCallback, useMemo, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectDecisionLog } from "../src/components/project-decision-log";
import type {
  CofficeWorkspaceController,
  WorkspaceMutationResult,
} from "../src/components/use-coffice-workspace";
import {
  createEmptyCofficeWorkspace,
  reduceCofficeWorkspace,
  type CofficeWorkspace,
  type WorkspaceMutation,
} from "../src/lib/coffice-workspace";

const NOW = "2026-08-12T10:00:00.000Z";
const LATER = "2026-08-12T10:01:00.000Z";

function workspace(): CofficeWorkspace {
  return reduceCofficeWorkspace(
    createEmptyCofficeWorkspace(NOW),
    {
      type: "project.upsert",
      project: {
        id: "project-a",
        title: "Project A",
        createdAt: NOW,
        updatedAt: NOW,
        objectives: [],
      },
    },
    NOW,
  );
}

function withSecondProject(current: CofficeWorkspace) {
  return reduceCofficeWorkspace(
    current,
    {
      type: "project.upsert",
      project: {
        id: "project-b",
        title: "Project B",
        createdAt: NOW,
        updatedAt: NOW,
        objectives: [],
      },
    },
    NOW,
  );
}

function controller(
  current: CofficeWorkspace,
  mutate: CofficeWorkspaceController["mutate"],
  overrides: Partial<CofficeWorkspaceController> = {},
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
    ...overrides,
  };
}

function normalized(value: string | null | undefined) {
  return value?.replace(/\s+/gu, " ").trim() ?? "";
}

function button(container: HTMLElement, name: string) {
  const found = [...container.querySelectorAll("button")].find(
    (candidate) =>
      normalized(
        candidate.getAttribute("aria-label") ?? candidate.textContent,
      ) === name,
  );
  if (!(found instanceof HTMLButtonElement)) throw new Error(`Missing ${name}`);
  return found;
}

function field(container: HTMLElement, label: string) {
  const found = [...container.querySelectorAll("label")].find((candidate) =>
    normalized(candidate.textContent).startsWith(label),
  )?.control;
  if (!(found instanceof HTMLTextAreaElement)) {
    throw new Error(`Missing ${label}`);
  }
  return found;
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.click();
    await Promise.resolve();
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

async function flushFocus() {
  await act(
    async () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  );
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("ProjectDecisionLog", () => {
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
    vi.restoreAllMocks();
  });

  it("records only confirmed user text and restores focus to its status", async () => {
    const initial = workspace();
    const mutations: WorkspaceMutation[] = [];

    function Harness() {
      const [current, setCurrent] = useState(initial);
      const mutate = useCallback(
        async (mutation: WorkspaceMutation) => {
          mutations.push(mutation);
          const next = reduceCofficeWorkspace(current, mutation, LATER);
          setCurrent(next);
          return { ok: true as const, workspace: next };
        },
        [current],
      );
      const value = useMemo(
        () => controller(current, mutate),
        [current, mutate],
      );
      return (
        <ProjectDecisionLog
          projectId="project-a"
          projectName="Project A"
          controller={value}
        />
      );
    }

    await act(async () => root.render(<Harness />));
    expect(container.textContent).toContain("Nothing recorded yet");
    expect(container.textContent).toContain("do not change tasks, results");

    const record = button(container, "Record decision");
    record.focus();
    await click(record);
    await flushFocus();
    expect(document.activeElement).toBe(field(container, "Decision"));

    await enter(
      field(container, "Decision"),
      '  Keep <img src=x onerror="alert(1)"> private  ',
    );
    await enter(field(container, "Context"), "  Approved by the user.  ");
    await click(button(container, "Save decision"));
    await flushFocus();

    expect(mutations).toHaveLength(1);
    expect(mutations[0]).toMatchObject({
      type: "projectDecision.record",
      id: expect.stringMatching(/^project-decision-/u),
      projectId: "project-a",
      statement: 'Keep <img src=x onerror="alert(1)"> private',
      context: "Approved by the user.",
    });
    expect(container.textContent).toContain("1 current");
    expect(container.textContent).toContain(
      'Keep <img src=x onerror="alert(1)"> private',
    );
    expect(container.querySelector("img")).toBeNull();
    const status = container.querySelector('[role="status"]');
    expect(status?.textContent).toContain("Decision recorded");
    expect(document.activeElement).toBe(status);
  });

  it("corrects and replaces an active head while keeping newest-first history", async () => {
    let initial = workspace();
    initial = reduceCofficeWorkspace(
      initial,
      {
        type: "projectDecision.record",
        id: "decision-old",
        projectId: "project-a",
        statement: "Choose the old wording",
        context: "Original context",
      },
      "2026-08-12T10:01:00.000Z",
    );
    initial = reduceCofficeWorkspace(
      initial,
      {
        type: "projectDecision.record",
        id: "decision-newer",
        projectId: "project-a",
        statement: "Keep the independent choice",
      },
      "2026-08-12T10:02:00.000Z",
    );
    const mutations: WorkspaceMutation[] = [];
    let sequence = 2;

    function Harness() {
      const [current, setCurrent] = useState(initial);
      const mutate = useCallback(
        async (mutation: WorkspaceMutation) => {
          mutations.push(mutation);
          sequence += 1;
          const next = reduceCofficeWorkspace(
            current,
            mutation,
            `2026-08-12T10:0${sequence}:00.000Z`,
          );
          setCurrent(next);
          return { ok: true as const, workspace: next };
        },
        [current],
      );
      return (
        <ProjectDecisionLog
          projectId="project-a"
          projectName="Project A"
          controller={controller(current, mutate)}
        />
      );
    }

    await act(async () => root.render(<Harness />));
    const currentStatements = () =>
      [
        ...container.querySelectorAll<HTMLElement>(
          '[data-project-decision-current="true"] > h4',
        ),
      ].map((item) => normalized(item.textContent));
    expect(currentStatements()).toEqual([
      "Keep the independent choice",
      "Choose the old wording",
    ]);

    await click(
      button(
        container,
        "Correct wording for current decision 2: Choose the old wording",
      ),
    );
    await flushFocus();
    expect(field(container, "Decision").value).toBe("Choose the old wording");
    expect(field(container, "Context").value).toBe("Original context");
    await enter(field(container, "Decision"), "Choose the precise wording");
    await click(button(container, "Save correction"));

    expect(mutations.at(-1)).toMatchObject({
      type: "projectDecision.supersede",
      projectId: "project-a",
      supersedesId: "decision-old",
      supersessionKind: "correction",
      statement: "Choose the precise wording",
    });
    expect(currentStatements()).toEqual([
      "Choose the precise wording",
      "Keep the independent choice",
    ]);

    await click(
      button(
        container,
        "Replace current decision 1: Choose the precise wording",
      ),
    );
    await flushFocus();
    expect(field(container, "Decision").value).toBe("");
    await enter(field(container, "Decision"), "Choose the replacement");
    await click(button(container, "Replace decision"));

    expect(mutations.at(-1)).toMatchObject({
      type: "projectDecision.supersede",
      projectId: "project-a",
      supersessionKind: "replacement",
      statement: "Choose the replacement",
    });
    const replacement = container.querySelector<HTMLElement>(
      '[data-project-decision-current="true"]',
    );
    expect(replacement?.querySelector("h4")?.textContent).toBe(
      "Choose the replacement",
    );
    const history = replacement?.querySelector("details");
    expect(history?.querySelector("summary")?.textContent).toContain(
      "3 events",
    );
    await click(history!.querySelector("summary")!);
    expect(
      [...history!.querySelectorAll("li strong")].map((item) =>
        normalized(item.textContent),
      ),
    ).toEqual([
      "Replaced previous decision",
      "Corrected previous wording",
      "Decision recorded",
    ]);
  });

  it("withdraws with an explicit confirmation and keeps the chain in history", async () => {
    const initial = reduceCofficeWorkspace(
      workspace(),
      {
        type: "projectDecision.record",
        id: "decision-a",
        projectId: "project-a",
        statement: "Use the compact route",
      },
      LATER,
    );

    function Harness() {
      const [current, setCurrent] = useState(initial);
      const mutate = useCallback(
        async (mutation: WorkspaceMutation) => {
          const next = reduceCofficeWorkspace(
            current,
            mutation,
            "2026-08-12T10:02:00.000Z",
          );
          setCurrent(next);
          return { ok: true as const, workspace: next };
        },
        [current],
      );
      return (
        <ProjectDecisionLog
          projectId="project-a"
          projectName="Project A"
          controller={controller(current, mutate)}
        />
      );
    }

    await act(async () => root.render(<Harness />));
    await click(
      button(container, "Withdraw current decision 1: Use the compact route"),
    );
    await flushFocus();
    expect(container.textContent).toContain(
      "without a replacement. Its history is kept until this project is removed",
    );
    expect(document.activeElement).toBe(field(container, "Reason"));
    await enter(field(container, "Reason"), "No longer applies");
    await click(button(container, "Confirm withdrawal"));
    await flushFocus();

    expect(container.textContent).toContain(
      "No decision is currently in effect",
    );
    expect(document.activeElement?.textContent).toContain("Decision withdrawn");
    const past = [...container.querySelectorAll("details")].find((details) =>
      normalized(
        details.querySelector(":scope > summary")?.textContent,
      ).startsWith("Past decisions"),
    );
    expect(past).toBeTruthy();
    await click(past!.querySelector("summary")!);
    expect(past!.textContent).toContain("Use the compact route");
    expect(past!.textContent).toContain("Reason: No longer applies");
    const chain = past!.querySelector("details");
    await click(chain!.querySelector("summary")!);
    expect(
      [...chain!.querySelectorAll("li strong")].map((item) =>
        normalized(item.textContent),
      ),
    ).toEqual(["Withdrawn without replacement", "Decision recorded"]);
  });

  it("keeps failed and unconfirmed drafts, locks writes, and exposes recovery truthfully", async () => {
    const current = workspace();
    const pending = deferred<WorkspaceMutationResult>();
    const mutate = vi.fn(async () => pending.promise);
    await act(async () =>
      root.render(
        <ProjectDecisionLog
          projectId="project-a"
          projectName="Project A"
          controller={controller(current, mutate)}
        />,
      ),
    );
    await click(button(container, "Record decision"));
    await enter(field(container, "Decision"), "Keep this draft");
    await click(button(container, "Save decision"));
    expect(button(container, "Saving…").disabled).toBe(true);
    expect(button(container, "Cancel").disabled).toBe(true);
    const pendingDraft = field(container, "Decision");
    await act(async () => {
      pendingDraft.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    await flushFocus();
    expect(field(container, "Decision").value).toBe("Keep this draft");
    expect(button(container, "Saving…").disabled).toBe(true);
    expect(container.querySelector("form")).toBeTruthy();

    await act(async () => {
      pending.resolve({ ok: false, reason: "conflict" });
      await pending.promise;
      await Promise.resolve();
    });
    await flushFocus();
    expect(field(container, "Decision").value).toBe("Keep this draft");
    expect(container.textContent).toContain("workspace changed elsewhere");
    expect(document.activeElement).toBe(
      container.querySelector('[role="status"]'),
    );
    expect(button(container, "Save decision").disabled).toBe(true);
    await click(button(container, "Load latest decisions"));
    await flushFocus();
    expect(container.textContent).toContain("Latest decisions loaded");
    expect(field(container, "Decision").value).toBe("Keep this draft");
    expect(button(container, "Save decision").disabled).toBe(false);

    await act(async () =>
      root.render(
        <ProjectDecisionLog
          projectId="project-a"
          projectName="Project A"
          controller={controller(
            current,
            vi.fn(async () => ({ ok: true as const, workspace: current })),
          )}
        />,
      ),
    );
    await click(button(container, "Save decision"));
    await flushFocus();
    expect(field(container, "Decision").value).toBe("Keep this draft");
    expect(container.textContent).toContain("did not confirm this decision");

    await act(async () =>
      root.render(
        <ProjectDecisionLog
          projectId="project-a"
          projectName="Project A"
          controller={controller(current, vi.fn(), {
            persistent: true,
            recovery: { kind: "backup", reason: "primary-corrupt" },
            recoveryAcknowledged: false,
          })}
        />,
      ),
    );
    expect(button(container, "Save decision").disabled).toBe(true);
    expect(button(container, "Cancel").disabled).toBe(false);
    expect(container.textContent).toContain(
      "acknowledge the recovered workspace",
    );

    await act(async () =>
      root.render(
        <ProjectDecisionLog
          projectId="project-a"
          projectName="Project A"
          controller={controller(current, vi.fn(), {
            persistent: false,
            recovery: { kind: "none" },
            recoveryAcknowledged: true,
          })}
        />,
      ),
    );
    expect(button(container, "Save decision").disabled).toBe(true);
    expect(button(container, "Cancel").disabled).toBe(false);
    expect(container.textContent).toContain("workspace is unavailable");
  });

  it("freezes a changed target and ignores a late result after the project changes", async () => {
    const initial = withSecondProject(
      reduceCofficeWorkspace(
        workspace(),
        {
          type: "projectDecision.record",
          id: "decision-a",
          projectId: "project-a",
          statement: "Keep Project A local",
        },
        LATER,
      ),
    );
    const pending = deferred<WorkspaceMutationResult>();
    const mutate = vi.fn(async () => pending.promise);
    const render = async (projectId: string, projectName: string) =>
      await act(async () =>
        root.render(
          <ProjectDecisionLog
            projectId={projectId}
            projectName={projectName}
            controller={controller(initial, mutate)}
          />,
        ),
      );

    await render("project-a", "Project A");
    await click(button(container, "Record decision"));
    await enter(field(container, "Decision"), "Project A draft");
    await click(button(container, "Save decision"));
    await render("project-b", "Project B");
    expect(container.textContent).toContain("This draft belongs to Project A");
    expect(field(container, "Decision").value).toBe("Project A draft");

    const confirmed = reduceCofficeWorkspace(
      initial,
      {
        type: "projectDecision.record",
        id: "late-event",
        projectId: "project-a",
        statement: "Project A draft",
      },
      "2026-08-12T10:03:00.000Z",
    );
    await act(async () => {
      pending.resolve({ ok: true, workspace: confirmed });
      await pending.promise;
      await Promise.resolve();
    });
    expect(container.textContent).not.toContain("Decision recorded.");
    await click(button(container, "Discard draft"));
    await flushFocus();
    expect(document.activeElement).toBe(button(container, "Record decision"));
    expect(container.textContent).not.toContain("Project A draft");
  });

  it("keeps a correction draft frozen when another writer supersedes its target", async () => {
    const initial = reduceCofficeWorkspace(
      workspace(),
      {
        type: "projectDecision.record",
        id: "decision-active",
        projectId: "project-a",
        statement: "Keep the original choice",
      },
      LATER,
    );
    const mutate = vi.fn();
    const render = async (current: CofficeWorkspace) =>
      await act(async () =>
        root.render(
          <ProjectDecisionLog
            projectId="project-a"
            projectName="Project A"
            controller={controller(current, mutate)}
          />,
        ),
      );

    await render(initial);
    await click(
      button(
        container,
        "Correct wording for current decision 1: Keep the original choice",
      ),
    );
    await enter(field(container, "Decision"), "Keep my corrected draft");

    const superseded = reduceCofficeWorkspace(
      initial,
      {
        type: "projectDecision.supersede",
        id: "decision-external",
        projectId: "project-a",
        supersedesId: "decision-active",
        supersessionKind: "replacement",
        statement: "An external replacement",
      },
      "2026-08-12T10:04:00.000Z",
    );
    await render(superseded);

    expect(container.textContent).toContain("Decision changed");
    expect(field(container, "Decision").value).toBe("Keep my corrected draft");
    expect(button(container, "Save correction").disabled).toBe(true);
    await click(button(container, "Load latest decisions"));
    expect(container.textContent).toContain(
      "This draft still targets an earlier decision",
    );
    expect(button(container, "Save correction").disabled).toBe(true);
    await click(button(container, "Discard draft"));
    await flushFocus();
    expect(document.activeElement).toBe(button(container, "Record decision"));
    expect(container.textContent).toContain("An external replacement");
    expect(container.textContent).not.toContain("Keep my corrected draft");
    expect(mutate).not.toHaveBeenCalled();
  });
});
