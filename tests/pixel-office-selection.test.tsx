// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PixelOffice } from "../src/components/pixel-office";
import type { AttentionReviewController } from "../src/components/use-attention-review-state";
import type { CofficeWorkspaceController } from "../src/components/use-coffice-workspace";
import type { AttentionItem } from "../src/lib/attention-inbox";
import {
  createEmptyCofficeWorkspace,
  type CofficeWorkspace,
  type VerificationTarget,
} from "../src/lib/coffice-workspace";

const project = {
  id: "project-a",
  name: "Project A",
  tasks: [
    {
      id: "task-a",
      title: "Implement the useful office",
      kind: "temporary" as const,
      status: {
        value: "active" as const,
        evidence: "observed" as const,
        source: "test",
        timestamp: "2026-08-11T08:00:00.000Z",
        stale: false,
      },
    },
  ],
};

const archivedVerificationTarget = {
  projectId: "project-a",
  objectiveId: "objective-a",
  workItemId: "work-a",
  attemptId: "attempt-archived",
  resultKey: { kind: "revision" as const, id: "result-archived" },
};

const STORED_RESULT_TIME = "2026-08-11T08:01:00.000Z";

interface ArchivedWorkspaceEntry {
  target: VerificationTarget;
  projectTitle: string;
  objectiveTitle: string;
  workItemTitle: string;
  receiptId: string;
  exitCode: number;
}

function archivedWorkspaceProject(
  target: VerificationTarget,
  options: {
    projectTitle: string;
    objectiveTitle: string;
    workItemTitle: string;
  },
): CofficeWorkspace["projects"][number] {
  const result = {
    key: target.resultKey,
    observedAt: STORED_RESULT_TIME,
  };
  const matchingAttempt = {
    id: target.attemptId,
    codexTaskId: `archived-${target.projectId}`,
    relationship: "primary" as const,
    linkedAt: STORED_RESULT_TIME,
    resultCycles: [
      {
        key: { kind: "revision" as const, id: "near-result" },
        observedAt: "2026-08-11T08:00:00.000Z",
      },
      result,
    ],
  };
  const nearAttempt = {
    ...matchingAttempt,
    id: "near-attempt",
    resultCycles: [result],
  };
  const matchingWorkItem = {
    id: target.workItemId,
    title: options.workItemTitle,
    expectedOutcome: "The exact archived result remains reviewable.",
    status: "ready_for_review" as const,
    createdAt: STORED_RESULT_TIME,
    updatedAt: STORED_RESULT_TIME,
    attempts: [nearAttempt, matchingAttempt],
  };
  const nearWorkItem = {
    ...matchingWorkItem,
    id: "near-work-item",
    title: "Near work item must not open",
    attempts: [matchingAttempt],
  };
  const matchingObjective = {
    id: target.objectiveId,
    title: options.objectiveTitle,
    status: "active" as const,
    createdAt: STORED_RESULT_TIME,
    updatedAt: STORED_RESULT_TIME,
    workItems: [nearWorkItem, matchingWorkItem],
  };
  const nearObjective = {
    ...matchingObjective,
    id: "near-objective",
    title: "Near objective must not open",
    workItems: [matchingWorkItem],
  };
  return {
    id: target.projectId,
    title: options.projectTitle,
    createdAt: STORED_RESULT_TIME,
    updatedAt: STORED_RESULT_TIME,
    objectives: [nearObjective, matchingObjective],
  };
}

function failedVerificationReceipt(
  target: VerificationTarget,
  receiptId: string,
  exitCode: number,
): CofficeWorkspace["verificationReceipts"][number] {
  return {
    id: receiptId,
    idempotencyKey: `${receiptId}-idempotency`,
    requestHash: `${receiptId}-hash`,
    target,
    profile: { id: "test", version: "1" },
    checks: [
      {
        id: "test",
        version: "1",
        state: "failed",
        queuedAt: STORED_RESULT_TIME,
        startedAt: STORED_RESULT_TIME,
        completedAt: STORED_RESULT_TIME,
        failureKind: "exit",
        exitCode,
      },
    ],
    state: "failed",
    queuedAt: STORED_RESULT_TIME,
    startedAt: STORED_RESULT_TIME,
    completedAt: STORED_RESULT_TIME,
  };
}

function archivedWorkspaceController(
  entries: readonly ArchivedWorkspaceEntry[],
): CofficeWorkspaceController {
  const workspace: CofficeWorkspace = {
    ...createEmptyCofficeWorkspace(STORED_RESULT_TIME),
    projects: entries.map(
      ({ target, projectTitle, objectiveTitle, workItemTitle }) =>
        archivedWorkspaceProject(target, {
          projectTitle,
          objectiveTitle,
          workItemTitle,
        }),
    ),
    verificationReceipts: entries.flatMap(({ target, receiptId, exitCode }) => [
      failedVerificationReceipt(target, receiptId, exitCode),
      failedVerificationReceipt(
        {
          ...target,
          resultKey: { kind: "revision", id: "near-result" },
        },
        `${receiptId}-near-result`,
        88,
      ),
    ]),
  };
  return {
    workspace,
    ready: true,
    persistent: true,
    recovery: { kind: "none" },
    recoveryAcknowledged: true,
    error: null,
    refresh: async () => undefined,
    acknowledgeRecovery: vi.fn(),
    mutate: vi.fn(async () => ({ ok: true as const, workspace })),
    replaceAttentionReview: vi.fn(),
    updateAttentionEvent: vi.fn(),
  };
}

const review: AttentionReviewController = {
  ready: true,
  persistent: true,
  initializedAt: "2026-08-11T08:00:00.000Z",
  items: [],
  dispositionFor: () => undefined,
  snoozedUntilFor: () => undefined,
  isBaselined: () => false,
  markSeen: vi.fn(async () => true),
  markReviewed: vi.fn(),
  dismiss: vi.fn(),
  snooze: vi.fn(),
  restore: vi.fn(),
};

describe("top-down product selection", () => {
  let appShell: HTMLElement;
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    appShell = document.createElement("main");
    appShell.className = "app-shell";
    host = document.createElement("div");
    appShell.append(host);
    document.body.append(appShell);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    appShell.remove();
    vi.restoreAllMocks();
  });

  it("keeps replies needed distinct from unread results on the office trigger", async () => {
    const items: AttentionItem[] = [
      {
        eventKey: "reply:task-a",
        kind: "needs_input",
        priority: 0,
        projectId: project.id,
        projectName: project.name,
        taskId: "task-a",
        openTaskId: "task-a",
        taskTitle: "Implement the useful office",
        occurredAt: "2026-08-11T08:00:00.000Z",
        status: "waiting_for_user",
        evidence: "observed",
        stale: false,
        reason: "Codex needs a reply.",
        recommendedAction: "Reply in Codex",
      },
      {
        eventKey: "result:task-a",
        kind: "ready_for_review",
        priority: 3,
        projectId: project.id,
        projectName: project.name,
        taskId: "task-a",
        openTaskId: "task-a",
        taskTitle: "Implement the useful office",
        occurredAt: "2026-08-11T08:01:00.000Z",
        status: "completed",
        evidence: "observed",
        stale: false,
        reason: "A completed result is ready to review.",
        recommendedAction: "Review the result",
      },
      {
        eventKey: "decision-request:work-a",
        kind: "decision_needed",
        priority: 0,
        projectId: project.id,
        projectName: project.name,
        taskId: "work-a",
        planProjectId: project.id,
        taskTitle: "Release target",
        occurredAt: "2026-08-11T08:02:00.000Z",
        status: "waiting_for_user",
        evidence: "observed",
        stale: false,
        reason: "A decision you recorded is still open.",
        recommendedAction: "Review the work item decision",
      },
    ];
    const renderOffice = async (seen: boolean) => {
      const controller: AttentionReviewController = {
        ...review,
        items,
        dispositionFor: seen
          ? () => ({
              kind: "needs_review",
              at: "2026-08-11T08:02:00.000Z",
            })
          : () => undefined,
      };
      await act(async () => {
        root.render(
          <PixelOffice
            project={project}
            projects={[project]}
            onExit={vi.fn()}
            onEnterProject={vi.fn()}
            referenceTime={Date.parse("2026-08-11T08:03:00.000Z")}
            reviewWorkspace={{
              controller,
              visibleAttentionItems: items,
              requestedTask: null,
              onOpenTask: vi.fn(),
              onRequestHandled: vi.fn(),
            }}
          />,
        );
      });
    };

    await renderOffice(false);
    let trigger = host.querySelector<HTMLButtonElement>(
      '[aria-label="Attention for Project A, 3 actions, 1 reply needed, 1 decision needed, 1 unread result"]',
    )!;
    expect(trigger.dataset.attentionCount).toBe("3");
    expect(trigger.dataset.needsReplyCount).toBe("1");
    expect(trigger.dataset.needsDecisionCount).toBe("1");
    expect(trigger.dataset.unreadResultCount).toBe("1");
    expect(trigger.textContent).toContain("1 reply needed");
    expect(trigger.textContent).toContain("1 decision needed");
    expect(trigger.textContent).toContain("1 unread");

    await renderOffice(true);
    trigger = host.querySelector<HTMLButtonElement>(
      '[aria-label="Attention for Project A, 3 actions, 1 reply needed, 1 decision needed, 0 unread results"]',
    )!;
    expect(trigger.dataset.attentionCount).toBe("3");
    expect(trigger.dataset.needsReplyCount).toBe("1");
    expect(trigger.dataset.needsDecisionCount).toBe("1");
    expect(trigger.dataset.unreadResultCount).toBe("0");
    expect(trigger.textContent).toContain("1 reply needed");
    expect(trigger.textContent).not.toContain("unread");
  });

  it("moves directly after selecting a world actor without opening the inspector", async () => {
    await act(async () => {
      root.render(
        <PixelOffice
          project={project}
          projects={[project]}
          onExit={vi.fn()}
          onEnterProject={vi.fn()}
          referenceTime={Date.parse("2026-08-11T08:01:00.000Z")}
          reviewWorkspace={{
            controller: review,
            visibleAttentionItems: [],
            requestedTask: null,
            onOpenTask: vi.fn(),
            onRequestHandled: vi.fn(),
          }}
        />,
      );
    });

    const actor = host.querySelector<HTMLElement>("[data-assigned-desk='0']")!;
    await act(async () => actor.click());

    expect(
      document.body.querySelector('[data-review-act-inspector="true"]'),
    ).toBeNull();
    expect(actor.getAttribute("aria-pressed")).toBe("true");
    expect(appShell.inert).toBe(false);
    expect(appShell.hasAttribute("aria-hidden")).toBe(false);

    const room = host.querySelector<HTMLElement>("[data-topdown-room='true']")!;
    Object.defineProperty(room, "getBoundingClientRect", {
      value: () => ({ left: 0, top: 0, width: 1200, height: 650 }),
    });
    await act(async () => {
      room.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          clientX: 600,
          clientY: 490,
        }),
      );
    });

    expect(actor.dataset.motionPhase).toBe("walking");
  });

  it("opens Review & Act from the roster and preserves selection after close", async () => {
    await act(async () => {
      root.render(
        <PixelOffice
          project={project}
          projects={[project]}
          onExit={vi.fn()}
          onEnterProject={vi.fn()}
          referenceTime={Date.parse("2026-08-11T08:01:00.000Z")}
          reviewWorkspace={{
            controller: review,
            visibleAttentionItems: [],
            requestedTask: null,
            onOpenTask: vi.fn(),
            onRequestHandled: vi.fn(),
          }}
        />,
      );
    });

    const rosterButton = host.querySelector<HTMLButtonElement>(
      '[data-staff-dock="true"] button',
    )!;
    await act(async () => rosterButton.click());

    expect(
      document.body.querySelector('[data-review-act-inspector="true"]'),
    ).not.toBeNull();
    expect(appShell.inert).toBe(true);

    const closeButton = document.body.querySelector<HTMLButtonElement>(
      '[data-review-act-inspector="true"] [aria-label="Close review inspector"]',
    )!;
    await act(async () => closeButton.click());

    expect(rosterButton.getAttribute("aria-pressed")).toBe("true");
    expect(appShell.inert).toBe(false);
  });

  it("restores focus safely when an inspected task leaves the live roster", async () => {
    const reviewWorkspace = {
      controller: review,
      visibleAttentionItems: [],
      requestedTask: null,
      onOpenTask: vi.fn(),
      onRequestHandled: vi.fn(),
    };
    await act(async () => {
      root.render(
        <PixelOffice
          project={project}
          projects={[project]}
          onExit={vi.fn()}
          onEnterProject={vi.fn()}
          referenceTime={Date.parse("2026-08-11T08:01:00.000Z")}
          reviewWorkspace={reviewWorkspace}
        />,
      );
    });

    const rosterButton = host.querySelector<HTMLButtonElement>(
      '[data-staff-dock="true"] button',
    )!;
    await act(async () => rosterButton.click());

    const emptyProject = { ...project, tasks: [] };
    await act(async () => {
      root.render(
        <PixelOffice
          project={emptyProject}
          projects={[emptyProject]}
          onExit={vi.fn()}
          onEnterProject={vi.fn()}
          referenceTime={Date.parse("2026-08-11T08:02:00.000Z")}
          reviewWorkspace={reviewWorkspace}
        />,
      );
      await new Promise<void>((resolve) =>
        window.requestAnimationFrame(() => resolve()),
      );
    });

    expect(
      document.body.querySelector('[data-review-act-inspector="true"]'),
    ).toBeNull();
    expect(appShell.inert).toBe(false);
    expect(document.activeElement).toBe(
      host.querySelector('[aria-label^="Attention for"]'),
    );
  });

  it("opens stored Plan context for a failed receipt whose live task is archived", async () => {
    const markSeen = vi.fn(() => new Promise<boolean>(() => undefined));
    const workspace = archivedWorkspaceController([
      {
        target: archivedVerificationTarget,
        projectTitle: project.name,
        objectiveTitle: "Archived objective A",
        workItemTitle: "Stored result after archival",
        receiptId: "receipt-archived",
        exitCode: 7,
      },
    ]);
    const archivedReceiptReview: AttentionReviewController = {
      ...review,
      markSeen,
      items: [
        {
          eventKey: "verification:receipt-archived",
          kind: "verification_failed",
          priority: 1,
          projectId: project.id,
          projectName: project.name,
          taskId: "attempt-archived",
          taskTitle: "Stored result after archival",
          occurredAt: "2026-08-11T08:01:00.000Z",
          status: "failed",
          evidence: "observed",
          stale: false,
          reason: "A quality check failed for this exact result.",
          recommendedAction: "Review the stored work result",
          verificationTarget: archivedVerificationTarget,
        },
      ],
    };
    await act(async () => {
      root.render(
        <PixelOffice
          project={project}
          projects={[project]}
          onExit={vi.fn()}
          onEnterProject={vi.fn()}
          referenceTime={Date.parse("2026-08-11T08:02:00.000Z")}
          workspace={workspace}
          reviewWorkspace={{
            controller: archivedReceiptReview,
            visibleAttentionItems: archivedReceiptReview.items,
            requestedTask: null,
            onOpenTask: vi.fn(),
            onRequestHandled: vi.fn(),
          }}
        />,
      );
    });

    await act(async () =>
      host
        .querySelector<HTMLButtonElement>('[aria-label^="Attention for"]')!
        .click(),
    );
    const storedResult = [
      ...document.body.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) =>
      button.textContent?.includes("Stored result after archival"),
    );
    expect(storedResult).toBeDefined();
    await act(async () => storedResult!.click());

    expect(
      document.body.querySelector('[data-review-act-inspector="true"]'),
    ).toBeNull();
    expect(
      document.body.querySelector('[data-work-planner="true"]'),
    ).not.toBeNull();
    const storedContext = document.body.querySelector<HTMLElement>(
      '[data-stored-result-context="true"]',
    );
    expect(storedContext?.textContent).toContain(
      "Stored result after archival",
    );
    expect(storedContext?.textContent).toContain("Archived objective A");
    expect(storedContext?.textContent).toContain("Result 2 of 2");
    expect(storedContext?.textContent).toContain("Tests · Failed · exit 7");
    expect(storedContext?.textContent).not.toContain("exit 88");
    expect(storedContext?.textContent).not.toContain(
      "Near work item must not open",
    );
    expect(storedContext?.textContent).not.toContain(
      "Near objective must not open",
    );
    expect(storedContext?.textContent).not.toContain(
      "Stored result unavailable",
    );
    expect(markSeen).toHaveBeenCalledOnce();
    expect(markSeen).toHaveBeenCalledWith("verification:receipt-archived");
  });

  it("keeps cross-project actions out and opens an archived result only in its original project", async () => {
    const projectB = { id: "project-b", name: "Project B", tasks: [] };
    const targetB = {
      ...archivedVerificationTarget,
      projectId: projectB.id,
      objectiveId: "objective-b",
      workItemId: "work-b",
      resultKey: { kind: "revision" as const, id: "result-b" },
    };
    const onOpenTask = vi.fn();
    const onPlanRequestHandled = vi.fn();
    const markSeen = vi.fn(async () => true);
    const workspace = archivedWorkspaceController([
      {
        target: targetB,
        projectTitle: projectB.name,
        objectiveTitle: "Archived objective B",
        workItemTitle: "Archived Project B result",
        receiptId: "receipt-project-b",
        exitCode: 9,
      },
    ]);
    const crossProjectReview: AttentionReviewController = {
      ...review,
      markSeen,
      items: [
        {
          eventKey: "verification:receipt-project-b",
          kind: "verification_failed",
          priority: 1,
          projectId: projectB.id,
          projectName: projectB.name,
          taskId: "attempt-archived",
          taskTitle: "Archived Project B result",
          occurredAt: "2026-08-11T08:01:00.000Z",
          status: "failed",
          evidence: "observed",
          stale: false,
          reason: "A quality check failed for this exact result.",
          recommendedAction: "Review the stored work result",
          verificationTarget: targetB,
        },
      ],
    };

    await act(async () => {
      root.render(
        <PixelOffice
          project={project}
          projects={[project, projectB]}
          onExit={vi.fn()}
          onEnterProject={vi.fn()}
          referenceTime={Date.parse("2026-08-11T08:02:00.000Z")}
          workspace={workspace}
          reviewWorkspace={{
            controller: crossProjectReview,
            visibleAttentionItems: crossProjectReview.items,
            requestedTask: null,
            onOpenTask,
            onRequestHandled: vi.fn(),
            onPlanRequestHandled,
          }}
        />,
      );
    });
    const projectATrigger = host.querySelector<HTMLButtonElement>(
      '[aria-label="Attention for Project A, 0 actions, 0 replies needed, 0 decisions needed, 0 unread results"]',
    );
    expect(projectATrigger?.dataset.attentionCount).toBe("0");
    expect(projectATrigger?.dataset.needsReplyCount).toBe("0");
    expect(projectATrigger?.dataset.unreadResultCount).toBe("0");
    await act(async () => projectATrigger!.click());
    const projectAPanel = document.body.querySelector<HTMLElement>(
      '[data-attention-scope-project-id="project-a"]',
    );
    expect(projectAPanel?.textContent).toContain("No current actions");
    expect(projectAPanel?.textContent).not.toContain(
      "Archived Project B result",
    );
    expect(onOpenTask).not.toHaveBeenCalled();
    expect(onPlanRequestHandled).not.toHaveBeenCalled();
    expect(markSeen).not.toHaveBeenCalled();
    await act(async () =>
      projectAPanel
        ?.querySelector<HTMLButtonElement>(
          '[aria-label="Close attention inbox"]',
        )
        ?.click(),
    );

    await act(async () => {
      root.render(
        <PixelOffice
          key={projectB.id}
          project={projectB}
          projects={[project, projectB]}
          onExit={vi.fn()}
          onEnterProject={vi.fn()}
          referenceTime={Date.parse("2026-08-11T08:03:00.000Z")}
          workspace={workspace}
          reviewWorkspace={{
            controller: crossProjectReview,
            visibleAttentionItems: crossProjectReview.items,
            requestedTask: null,
            onOpenTask: vi.fn(),
            onRequestHandled: vi.fn(),
            onPlanRequestHandled,
          }}
        />,
      );
    });

    const projectBTrigger = host.querySelector<HTMLButtonElement>(
      '[aria-label="Attention for Project B, 1 action, 0 replies needed, 0 decisions needed, 0 unread results"]',
    );
    expect(projectBTrigger?.dataset.attentionCount).toBe("1");
    expect(projectBTrigger?.dataset.needsReplyCount).toBe("0");
    expect(projectBTrigger?.dataset.unreadResultCount).toBe("0");
    await act(async () => projectBTrigger!.click());
    const archivedResult = [
      ...document.body.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) =>
      button.textContent?.includes("Archived Project B result"),
    );
    await act(async () => archivedResult!.click());

    expect(
      document.body.querySelector('[data-work-planner="true"]'),
    ).not.toBeNull();
    const storedContext = document.body.querySelector<HTMLElement>(
      '[data-stored-result-context="true"]',
    );
    expect(storedContext?.textContent).toContain("Archived Project B result");
    expect(storedContext?.textContent).toContain("Archived objective B");
    expect(storedContext?.textContent).toContain("Result 2 of 2");
    expect(storedContext?.textContent).toContain("Tests · Failed · exit 9");
    expect(storedContext?.textContent).not.toContain("exit 88");
    expect(storedContext?.textContent).not.toContain(
      "Near work item must not open",
    );
    expect(storedContext?.textContent).not.toContain(
      "Near objective must not open",
    );
    expect(storedContext?.textContent).not.toContain(
      "Stored result unavailable",
    );
    expect(
      document.body.querySelector('[data-attention-inbox="true"]'),
    ).toBeNull();
    expect(onPlanRequestHandled).toHaveBeenCalledWith(projectB.id);
    expect(markSeen).toHaveBeenCalledOnce();
    expect(markSeen).toHaveBeenCalledWith("verification:receipt-project-b");
  });
});
