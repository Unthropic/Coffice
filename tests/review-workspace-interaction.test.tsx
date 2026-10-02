// @vitest-environment happy-dom

import { act, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AttentionInboxPanel,
  ReviewActInspector,
  type ReviewProject,
  type ReviewTask,
} from "../src/components/review-workspace";
import {
  createAttentionItem,
  createVerificationAttentionItem,
  type AttentionItem,
} from "../src/lib/attention-inbox";
import type { AttentionReviewController } from "../src/components/use-attention-review-state";
import type { CodexActionsController } from "../src/components/use-codex-actions";
import type { CofficeWorkspaceController } from "../src/components/use-coffice-workspace";
import type {
  VerificationReceiptView,
  VerificationsController,
} from "../src/components/use-verifications";
import type { CodexOperation } from "../src/lib/codex-app-server";
import {
  createEmptyCofficeWorkspace,
  createVerificationReceipt,
  reduceCofficeWorkspace,
  type CofficeWorkspace,
  type WorkspaceMutation,
} from "../src/lib/coffice-workspace";

const NOW = "2026-08-10T10:06:00.000Z";

const task: ReviewTask = {
  id: "task-a",
  title: "Review the completed utility slice",
  kind: "temporary",
  status: {
    value: "completed",
    evidence: "observed",
    source: "session-jsonl:event_msg.turn_complete",
    timestamp: "2026-08-10T10:05:00.000Z",
    stale: false,
  },
};

const project: ReviewProject = {
  id: "project-a",
  name: "Project A",
  tasks: [task],
};

const item = createAttentionItem(project, task)!;
const review: AttentionReviewController = {
  ready: true,
  persistent: true,
  initializedAt: "2026-08-10T10:00:00.000Z",
  items: [item],
  dispositionFor: () => undefined,
  snoozedUntilFor: () => undefined,
  isBaselined: () => false,
  markSeen: vi.fn(async () => true),
  markReviewed: vi.fn(async () => true),
  dismiss: vi.fn(),
  snooze: vi.fn(),
  restore: vi.fn(),
};

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

function controlLabelled<
  T extends HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
>(container: HTMLElement, name: string): T {
  const label = [...container.querySelectorAll<HTMLLabelElement>("label")].find(
    (candidate) => normalized(candidate.textContent).startsWith(name),
  );
  const control = label?.control;
  if (!(
    control instanceof HTMLInputElement ||
    control instanceof HTMLTextAreaElement ||
    control instanceof HTMLSelectElement
  )) {
    throw new Error(`Missing form control labelled "${name}".`);
  }
  return control as T;
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.click();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function nextAnimationFrame() {
  await act(
    async () =>
      await new Promise<void>((resolve) =>
        window.requestAnimationFrame(() => resolve()),
      ),
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((onResolve) => {
    resolve = onResolve;
  });
  return { promise, resolve };
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

async function selectOption(element: HTMLSelectElement, value: string) {
  const ownSetter = Object.getOwnPropertyDescriptor(element, "value")?.set;
  const prototypeSetter = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(element) as object,
    "value",
  )?.set;
  await act(async () => {
    if (prototypeSetter && ownSetter !== prototypeSetter) {
      prototypeSetter.call(element, value);
    } else if (ownSetter) {
      ownSetter.call(element, value);
    } else {
      element.value = value;
    }
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    await Promise.resolve();
  });
}

function createReviewController(
  markReviewed: AttentionReviewController["markReviewed"] = vi.fn(
    async () => true,
  ),
): AttentionReviewController {
  return {
    ...review,
    markReviewed,
    dismiss: vi.fn(),
    snooze: vi.fn(),
    restore: vi.fn(),
  };
}

const verificationTarget = {
  projectId: "project-a",
  objectiveId: "objective-a",
  workItemId: "work-a",
  attemptId: "attempt-a",
  resultKey: { kind: "revision" as const, id: item.eventKey },
};

function verificationController(
  options: {
    receipts?: VerificationReceiptView[];
    ready?: boolean;
    available?: boolean;
    degraded?: boolean;
    profileEligible?: boolean;
    run?: VerificationsController["run"];
    cancel?: VerificationsController["cancel"];
  } = {},
): VerificationsController {
  const receipts = options.receipts ?? [];
  return {
    ready: options.ready ?? true,
    available: options.available ?? true,
    degraded: options.degraded ?? false,
    profiles: [
      {
        id: "test",
        version: "1",
        label: "Tests",
        description: "Run the project test suite.",
        eligible: options.profileEligible ?? true,
      },
    ],
    receipts,
    operations: receipts.some(
      (receipt) => receipt.state === "queued" || receipt.state === "running",
    )
      ? [{ receiptId: receipts.at(-1)!.id, state: "running" }]
      : [],
    busyReceiptId: null,
    receiptForTarget: () => receipts.at(-1) ?? null,
    run:
      options.run ??
      vi.fn(async () => ({
        ok: false as const,
        reason: "unavailable" as const,
      })),
    cancel:
      options.cancel ??
      vi.fn(async () => ({
        ok: false as const,
        reason: "unavailable" as const,
      })),
    refresh: vi.fn(async () => undefined),
  };
}

function verificationReceipt(
  state: VerificationReceiptView["state"],
): VerificationReceiptView {
  const terminal = state !== "queued" && state !== "running";
  return {
    id: `receipt-${state}`,
    target: verificationTarget,
    profile: { id: "test", version: "1" },
    checks: [
      {
        id: "test",
        version: "1",
        state,
        queuedAt: NOW,
        ...(state === "running" || terminal ? { startedAt: NOW } : {}),
        ...(terminal ? { completedAt: NOW } : {}),
        ...(state === "failed" ? { failureKind: "exit", exitCode: 1 } : {}),
      },
    ],
    state,
    queuedAt: NOW,
    ...(state === "running" || terminal ? { startedAt: NOW } : {}),
    ...(terminal ? { completedAt: NOW } : {}),
  };
}

function workspaceWithVerificationReceipt(
  receipt: VerificationReceiptView,
  source = workspaceFixture(true),
): CofficeWorkspace {
  return {
    ...source,
    verificationReceipts: [
      {
        ...receipt,
        idempotencyKey: `${receipt.id}-key`,
        requestHash: "a".repeat(64),
      },
    ],
  };
}

const assignedRepairTask: ReviewTask = {
  ...task,
  assignmentEvidence: "explicit_project",
  assignmentSourceFresh: true,
};

function repairActions(submitFollowUp = vi.fn()): CodexActionsController {
  return {
    operations: [],
    available: true,
    error: null,
    submitFollowUp,
    requestReview: vi.fn(),
    latestOperationFor: () => undefined,
  };
}

function receiptWithTarget(
  target: VerificationReceiptView["target"],
  options: { id?: string; exitCode?: number } = {},
): VerificationReceiptView {
  return {
    ...verificationReceipt("failed"),
    id: options.id ?? "receipt-failed-retargeted",
    target,
    checks: [
      {
        ...verificationReceipt("failed").checks[0]!,
        ...(options.exitCode === undefined
          ? {}
          : { exitCode: options.exitCode }),
      },
    ],
  };
}

function workspaceFixture(linked: boolean): CofficeWorkspace {
  return reduceCofficeWorkspace(
    createEmptyCofficeWorkspace(NOW),
    {
      type: "project.upsert",
      project: {
        id: project.id,
        title: project.name,
        createdAt: NOW,
        updatedAt: NOW,
        objectives: [
          {
            id: "objective-a",
            title: "Ship the useful review workflow",
            expectedOutcome: "The project can be reviewed and acted on safely.",
            status: "active",
            createdAt: NOW,
            updatedAt: NOW,
            workItems: [
              {
                id: "work-a",
                title: "Review the completed slice",
                expectedOutcome:
                  "The completed slice meets its checks and is ready to keep.",
                status: "ready_for_review",
                createdAt: NOW,
                updatedAt: NOW,
                attempts: linked
                  ? [
                      {
                        id: "attempt-a",
                        codexTaskId: task.id,
                        relationship: "primary",
                        linkedAt: NOW,
                        resultCycles: [
                          {
                            key: { kind: "revision", id: item.eventKey },
                            observedAt: task.status.timestamp!,
                          },
                        ],
                      },
                    ]
                  : [],
              },
            ],
          },
        ],
      },
    },
    NOW,
  );
}

function workspaceWithSavedComparison(
  includeSecondAlternative = false,
): CofficeWorkspace {
  const base = workspaceFixture(true);
  const alternativeResultId = "private-alternative-result";
  const alternativeAttemptId = "private-alternative-attempt";
  return {
    ...base,
    projects: base.projects.map((savedProject) => ({
      ...savedProject,
      objectives: savedProject.objectives.map((objective) => ({
        ...objective,
        workItems: objective.workItems.map((workItem) => ({
          ...workItem,
          attempts: [
            ...workItem.attempts,
            {
              id: alternativeAttemptId,
              codexTaskId: "private-alternative-task",
              relationship: "alternative" as const,
              linkedAt: "2026-08-10T09:00:00.000Z",
              resultCycles: [
                {
                  key: {
                    kind: "revision" as const,
                    id: alternativeResultId,
                  },
                  observedAt: "2026-08-10T09:55:00.000Z",
                  review: {
                    reviewedAt: "2026-08-10T09:56:00.000Z",
                    decision: {
                      kind: "redirected" as const,
                      decidedAt: "2026-08-10T09:57:00.000Z",
                    },
                  },
                },
              ],
            },
            ...(includeSecondAlternative
              ? [
                  {
                    id: "private-second-alternative-attempt",
                    codexTaskId: "private-second-alternative-task",
                    relationship: "alternative" as const,
                    linkedAt: "2026-08-10T09:10:00.000Z",
                    resultCycles: [
                      {
                        key: {
                          kind: "revision" as const,
                          id: "private-second-alternative-result",
                        },
                        observedAt: "2026-08-10T09:45:00.000Z",
                        review: {
                          reviewedAt: "2026-08-10T09:46:00.000Z",
                        },
                      },
                    ],
                  },
                ]
              : []),
          ],
        })),
      })),
    })),
    reviewAssessments: [
      {
        target: {
          projectId: "project-a",
          objectiveId: "objective-a",
          workItemId: "work-a",
          attemptId: alternativeAttemptId,
          resultKey: { kind: "revision", id: alternativeResultId },
        },
        authorship: "user",
        reviewSummary: "PRIVATE SUMMARY MUST NOT RENDER",
        risks: ["PRIVATE RISK MUST NOT RENDER"],
        uncertainties: [],
        blockedDecisions: ["PRIVATE DECISION MUST NOT RENDER"],
        nextAction: { kind: "run_quality_check" },
        updatedAt: "2026-08-10T09:58:00.000Z",
      },
    ],
    verificationReceipts: [
      {
        id: "private-receipt",
        idempotencyKey: "private-idempotency",
        requestHash: "a".repeat(64),
        target: {
          projectId: "project-a",
          objectiveId: "objective-a",
          workItemId: "work-a",
          attemptId: alternativeAttemptId,
          resultKey: { kind: "revision", id: alternativeResultId },
        },
        profile: { id: "typecheck", version: "private-profile-version" },
        checks: [
          {
            id: "private-check-one",
            version: "private-check-version",
            state: "passed",
            queuedAt: "2026-08-10T09:58:00.000Z",
            startedAt: "2026-08-10T09:58:10.000Z",
            completedAt: "2026-08-10T09:58:20.000Z",
          },
          {
            id: "private-check-two",
            version: "private-check-version",
            state: "failed",
            failureKind: "timeout",
            queuedAt: "2026-08-10T09:58:00.000Z",
            startedAt: "2026-08-10T09:58:10.000Z",
            completedAt: "2026-08-10T09:58:20.000Z",
          },
        ],
        state: "failed",
        queuedAt: "2026-08-10T09:58:00.000Z",
        startedAt: "2026-08-10T09:58:10.000Z",
        completedAt: "2026-08-10T09:58:20.000Z",
      },
    ],
  };
}

function workspaceWithTimestampOnlyAlternative(): CofficeWorkspace {
  const base = workspaceFixture(true);
  return {
    ...base,
    projects: base.projects.map((savedProject) => ({
      ...savedProject,
      objectives: savedProject.objectives.map((objective) => ({
        ...objective,
        workItems: objective.workItems.map((workItem) => ({
          ...workItem,
          attempts: [
            ...workItem.attempts,
            {
              id: "timestamp-only-attempt",
              codexTaskId: "timestamp-only-task",
              relationship: "alternative" as const,
              linkedAt: NOW,
              resultCycles: [
                {
                  key: { kind: "revision" as const, id: "timestamp-only" },
                  observedAt: NOW,
                },
              ],
            },
          ],
        })),
      })),
    })),
  };
}

function resumableWorkspace(): CofficeWorkspace {
  const withDestination = reduceCofficeWorkspace(
    workspaceFixture(true),
    {
      type: "workItem.upsert",
      projectId: "project-a",
      objectiveId: "objective-a",
      workItem: {
        id: "work-b",
        title: "Continue future revisions",
        expectedOutcome: "A later result is reviewed here.",
        status: "in_progress",
        createdAt: NOW,
        updatedAt: NOW,
        attempts: [],
      },
    },
    NOW,
  );
  return reduceCofficeWorkspace(
    withDestination,
    {
      type: "taskLink.unlink",
      codexTaskId: task.id,
      from: {
        projectId: "project-a",
        objectiveId: "objective-a",
        workItemId: "work-a",
        attemptId: "attempt-a",
      },
      unlinkedAt: "2026-08-10T10:07:00.000Z",
    },
    "2026-08-10T10:07:00.000Z",
  );
}

function workspaceWithHistoricalAndCurrentLinks(): CofficeWorkspace {
  const historical = resumableWorkspace();
  return {
    ...historical,
    projects: historical.projects.map((savedProject) => ({
      ...savedProject,
      objectives: savedProject.objectives.map((objective) => ({
        ...objective,
        workItems: objective.workItems.map((workItem) =>
          workItem.id === "work-b"
            ? {
                ...workItem,
                attempts: [
                  {
                    id: "attempt-b",
                    codexTaskId: task.id,
                    relationship: "continuation" as const,
                    linkedAt: "2026-08-10T10:08:00.000Z",
                    resultCycles: [],
                  },
                ],
              }
            : workItem,
        ),
      })),
    })),
  };
}

function WorkspaceInspectorHarness({
  initial,
  replacement,
  reviewController,
  mutations,
  actions,
  verifications,
  onWorkspace,
  mutateFailureReason,
  onRefresh,
  taskValue = task,
  projectValue = project,
  workspacePersistent = true,
  recoveryLocked = false,
  onClose = vi.fn(),
}: {
  initial: CofficeWorkspace;
  replacement?: CofficeWorkspace;
  reviewController: AttentionReviewController;
  mutations: WorkspaceMutation[];
  actions?: CodexActionsController;
  verifications?: VerificationsController;
  onWorkspace?: (workspace: CofficeWorkspace) => void;
  mutateFailureReason?: "conflict" | "unavailable" | "invalid";
  onRefresh?: () => void;
  taskValue?: ReviewTask;
  projectValue?: ReviewProject;
  workspacePersistent?: boolean;
  recoveryLocked?: boolean;
  onClose?: () => void;
}) {
  const [workspaceState, setWorkspaceState] =
    useState<CofficeWorkspace>(initial);
  const presentedWorkspace = replacement ?? workspaceState;
  const workspaceRef = useRef(presentedWorkspace);
  useEffect(() => {
    workspaceRef.current = presentedWorkspace;
  }, [presentedWorkspace]);
  useEffect(() => {
    onWorkspace?.(presentedWorkspace);
  }, [onWorkspace, presentedWorkspace]);
  const mutate = useCallback(
    async (mutation: WorkspaceMutation) => {
      mutations.push(mutation);
      if (mutateFailureReason) {
        return { ok: false as const, reason: mutateFailureReason };
      }
      const next = reduceCofficeWorkspace(
        workspaceRef.current,
        mutation,
        new Date().toISOString(),
      );
      workspaceRef.current = next;
      setWorkspaceState(next);
      return { ok: true as const, workspace: next };
    },
    [mutateFailureReason, mutations],
  );
  const workspace = useMemo<CofficeWorkspaceController>(
    () => ({
      workspace: presentedWorkspace,
      ready: true,
      persistent: workspacePersistent,
      recovery: recoveryLocked
        ? { kind: "backup", reason: "primary-corrupt" }
        : { kind: "none" },
      recoveryAcknowledged: !recoveryLocked,
      error: null,
      refresh: async () => onRefresh?.(),
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
    [
      mutate,
      onRefresh,
      presentedWorkspace,
      recoveryLocked,
      workspacePersistent,
    ],
  );
  return (
    <ReviewActInspector
      task={taskValue}
      project={projectValue}
      displayName={taskValue.title}
      referenceTime={Date.parse(NOW)}
      review={reviewController}
      workspace={workspace}
      actions={actions}
      verifications={verifications}
      onClose={onClose}
    />
  );
}

function SuccessfulReviewInboxHarness({ item }: { item: AttentionItem }) {
  const [items, setItems] = useState([item]);
  return (
    <AttentionInboxPanel
      items={items}
      initializedAt="2026-08-10T10:00:00.000Z"
      persistent
      referenceTime={Date.parse(NOW)}
      onOpenItem={() => undefined}
      onReviewItem={async () => {
        setItems([]);
        return true;
      }}
      onClose={() => undefined}
    />
  );
}

describe("Review & Act dialog interaction", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
      }
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

  it("compares saved structural evidence without exposing content or identifiers", async () => {
    const mutations: WorkspaceMutation[] = [];
    await act(async () =>
      root.render(
        <WorkspaceInspectorHarness
          initial={workspaceWithSavedComparison()}
          reviewController={createReviewController()}
          mutations={mutations}
        />,
      ),
    );

    const trigger = buttonNamed(container, "Compare saved evidence");
    await click(trigger);
    await nextAnimationFrame();

    const picker = controlLabelled<HTMLSelectElement>(
      container,
      "Saved alternative",
    );
    expect(document.activeElement).toBe(picker);
    const comparison = container.querySelector<HTMLElement>(
      '[aria-labelledby="saved-comparison-heading"]',
    )!;
    expect(normalized(comparison.textContent)).toContain(
      "Review Coffice’s saved records for two exact results. This does not compare the work itself.",
    );
    expect(normalized(comparison.textContent)).toContain("Selected result");
    expect(normalized(comparison.textContent)).toContain("Alternative result");
    expect(normalized(comparison.textContent)).toContain("Observed by Coffice");
    expect(normalized(comparison.textContent)).toContain(
      "Attempt 1 · Result 1",
    );
    expect(normalized(comparison.textContent)).toContain(
      "Attempt 2 · Result 1",
    );
    expect(normalized(comparison.textContent)).toContain("Not marked reviewed");
    expect(normalized(comparison.textContent)).toContain("Your saved notes");
    expect(normalized(comparison.textContent)).toContain("Not recorded");
    expect(normalized(comparison.textContent)).toContain(
      "Summary: Recorded · Risks 1 · Uncertainties 0 · Decision notes 1 · Advisory action: Run a quality check",
    );
    expect(normalized(comparison.textContent)).toContain(
      "Updated 2026-08-10 09:58 UTC",
    );
    expect(
      [...comparison.querySelectorAll("dt")].map((node) =>
        normalized(node.textContent),
      ),
    ).toContain("Newest retained quality check");
    expect(normalized(comparison.textContent)).toContain(
      "Saved quality check · Failed",
    );
    expect(normalized(comparison.textContent)).toContain(
      "Recorded 2026-08-10 09:58 UTC",
    );
    expect(normalized(comparison.textContent)).toContain(
      "Checks: passed: 1 · failed: 1",
    );
    expect(normalized(comparison.textContent)).toContain(
      "Failures: timed out: 1",
    );
    expect(normalized(comparison.textContent)).toContain(
      "No retained check receipt",
    );
    expect(normalized(comparison.textContent)).toContain(
      "No result content, changes, or task messages were inspected. Coffice does not score, rank, or recommend either result.",
    );
    expect(comparison.innerHTML).not.toMatch(
      /private-alternative|private-receipt|private-check|private-profile|PRIVATE|task-a|project-a|objective-a|work-a/u,
    );
    expect([...picker.options].map((option) => option.value)).toEqual([
      "alternative-1",
    ]);
    expect(mutations).toEqual([]);
    await click(buttonNamed(container, "Close comparison"));
    await nextAnimationFrame();
    expect(document.activeElement).toBe(trigger);
    expect(container.textContent).not.toContain("Selected result");
    expect(container.textContent).not.toContain("Showing saved alternative");
  });

  it("announces alternative selection with content-free position text", async () => {
    await act(async () =>
      root.render(
        <WorkspaceInspectorHarness
          initial={workspaceWithSavedComparison(true)}
          reviewController={createReviewController()}
          mutations={[]}
        />,
      ),
    );
    await click(buttonNamed(container, "Compare saved evidence"));
    await nextAnimationFrame();
    await selectOption(
      controlLabelled<HTMLSelectElement>(container, "Saved alternative"),
      "alternative-2",
    );

    const status = [
      ...container.querySelectorAll<HTMLElement>('[role="status"]'),
    ].find(
      (candidate) =>
        normalized(candidate.textContent) ===
        "Showing saved alternative 2 of 2.",
    );
    expect(status).toBeTruthy();
    expect(status?.textContent).not.toContain("private");
    await click(buttonNamed(container, "Close comparison"));
    await nextAnimationFrame();
    expect(container.textContent).not.toContain("Showing saved alternative");
  });

  it("does not offer comparison for timestamp-only candidates or call controllers", async () => {
    const mutate = vi.fn<CofficeWorkspaceController["mutate"]>();
    const submitFollowUp = vi.fn();
    const run = vi.fn<VerificationsController["run"]>();
    await act(async () =>
      root.render(
        <ReviewActInspector
          task={task}
          project={project}
          displayName={task.title}
          referenceTime={Date.parse(NOW)}
          review={createReviewController()}
          workspace={{
            workspace: workspaceWithTimestampOnlyAlternative(),
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
          }}
          actions={repairActions(submitFollowUp)}
          verifications={verificationController({ run })}
          onClose={vi.fn()}
        />,
      ),
    );

    expect(
      [...container.querySelectorAll("button")].some(
        (button) => normalized(button.textContent) === "Compare saved evidence",
      ),
    ).toBe(false);
    expect(mutate).not.toHaveBeenCalled();
    expect(submitFollowUp).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "unavailable persistence",
      workspacePersistent: false,
      recoveryLocked: false,
    },
    {
      name: "recovery read lock",
      workspacePersistent: true,
      recoveryLocked: true,
    },
  ])(
    "keeps saved comparison readable during $name",
    async ({ workspacePersistent, recoveryLocked }) => {
      const mutations: WorkspaceMutation[] = [];
      await act(async () =>
        root.render(
          <WorkspaceInspectorHarness
            initial={workspaceWithSavedComparison()}
            reviewController={createReviewController()}
            mutations={mutations}
            workspacePersistent={workspacePersistent}
            recoveryLocked={recoveryLocked}
          />,
        ),
      );

      await click(buttonNamed(container, "Compare saved evidence"));
      await nextAnimationFrame();
      expect(container.textContent).toContain("Selected result");
      expect(container.textContent).toContain("Alternative result");
      expect(mutations).toEqual([]);
    },
  );

  it("closes comparison before the inspector on Escape and restores trigger focus", async () => {
    const onClose = vi.fn();
    await act(async () =>
      root.render(
        <WorkspaceInspectorHarness
          initial={workspaceWithSavedComparison()}
          reviewController={createReviewController()}
          mutations={[]}
          onClose={onClose}
        />,
      ),
    );
    const trigger = buttonNamed(container, "Compare saved evidence");
    await click(trigger);
    await nextAnimationFrame();

    await act(async () =>
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })),
    );
    await nextAnimationFrame();
    expect(onClose).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);
    expect(container.textContent).not.toContain("Selected result");

    await act(async () =>
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })),
    );
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes and announces when the exact saved alternative disappears", async () => {
    const initial = workspaceWithSavedComparison();
    const replacement = workspaceFixture(true);
    await act(async () =>
      root.render(
        <WorkspaceInspectorHarness
          initial={initial}
          reviewController={createReviewController()}
          mutations={[]}
        />,
      ),
    );
    await click(buttonNamed(container, "Compare saved evidence"));
    await nextAnimationFrame();

    await act(async () =>
      root.render(
        <WorkspaceInspectorHarness
          initial={initial}
          replacement={replacement}
          reviewController={createReviewController()}
          mutations={[]}
        />,
      ),
    );
    await nextAnimationFrame();

    const status = [
      ...container.querySelectorAll<HTMLElement>('[role="status"]'),
    ].find(
      (candidate) =>
        normalized(candidate.textContent) ===
        "Saved comparison is no longer available.",
    );
    expect(status).toBeTruthy();
    expect(document.activeElement).toBe(status);
    expect(container.textContent).not.toContain("Selected result");
    expect(container.textContent).not.toContain("Alternative result");
  });

  it("reports a failed verification-alert review write and keeps focus in the inbox", async () => {
    const verificationItem = createVerificationAttentionItem(
      { id: "project-a", name: "Project A", tasks: [] },
      {
        id: "receipt-failed",
        state: "failed",
        completedAt: "2026-08-10T10:05:30.000Z",
        target: verificationTarget,
        workItemTitle: "Review the completed utility slice",
        resultObservedAt: "2026-08-10T10:05:00.000Z",
      },
    )!;
    const markReviewed = vi.fn(async () => false);

    await act(async () =>
      root.render(
        <AttentionInboxPanel
          items={[verificationItem]}
          initializedAt="2026-08-10T10:00:00.000Z"
          persistent
          referenceTime={Date.parse(NOW)}
          onOpenItem={vi.fn()}
          onReviewItem={markReviewed}
          onClose={vi.fn()}
        />,
      ),
    );

    await click(buttonNamed(container, "Mark reviewed"));
    await nextAnimationFrame();

    expect(markReviewed).toHaveBeenCalledWith(verificationItem.eventKey);
    const status = container.querySelector<HTMLElement>('[role="status"]');
    expect(status?.textContent).toContain(
      "was not marked reviewed because its Attention receipt was not saved",
    );
    expect(document.activeElement).toBe(status);
    expect(buttonNamed(container, "Mark reviewed")).not.toBeNull();
  });

  it("moves focus to confirmed status when reviewing removes a verification alert", async () => {
    const verificationItem = createVerificationAttentionItem(
      { id: "project-a", name: "Project A", tasks: [] },
      {
        id: "receipt-reviewed",
        state: "failed",
        completedAt: "2026-08-10T10:05:30.000Z",
        target: verificationTarget,
        workItemTitle: "Review the completed utility slice",
        resultObservedAt: "2026-08-10T10:05:00.000Z",
      },
    )!;

    await act(async () =>
      root.render(<SuccessfulReviewInboxHarness item={verificationItem} />),
    );
    await click(buttonNamed(container, "Mark reviewed"));
    await nextAnimationFrame();

    expect(container.textContent).toContain("All caught up");
    const status = container.querySelector<HTMLElement>('[role="status"]');
    expect(status?.textContent).toContain(
      "Quality-check alert marked reviewed.",
    );
    expect(document.activeElement).toBe(status);
  });

  it("does not steal focus again when live data rerenders with a new close callback", async () => {
    const firstClose = vi.fn();
    const latestClose = vi.fn();
    const renderInspector = (onClose: () => void) => (
      <ReviewActInspector
        task={task}
        project={project}
        displayName={task.title}
        referenceTime={Date.parse("2026-08-10T10:06:00.000Z")}
        review={review}
        onClose={onClose}
      />
    );

    await act(async () => root.render(renderInspector(firstClose)));
    const openInCodex = container.querySelector<HTMLAnchorElement>(
      '[data-dialog-initial-focus="true"]',
    )!;
    expect(document.activeElement).toBe(openInCodex);

    const markReviewed = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Mark reviewed",
    )!;
    markReviewed.focus();
    await act(async () => root.render(renderInspector(latestClose)));

    expect(document.activeElement).toBe(markReviewed);
    await act(async () =>
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })),
    );
    expect(latestClose).toHaveBeenCalledOnce();
    expect(firstClose).not.toHaveBeenCalled();
  });

  it("records a linked result review before clearing its Attention item", async () => {
    const mutations: WorkspaceMutation[] = [];
    const reviewController = createReviewController();

    await act(async () =>
      root.render(
        <WorkspaceInspectorHarness
          initial={workspaceFixture(true)}
          reviewController={reviewController}
          mutations={mutations}
        />,
      ),
    );

    await click(buttonNamed(container, "Mark reviewed"));

    expect(mutations).toMatchObject([
      {
        type: "result.review",
        attemptId: "attempt-a",
        resultKey: { kind: "revision", id: item.eventKey },
      },
    ]);
    expect(reviewController.markReviewed).toHaveBeenCalledWith(item.eventKey);
    expect(container.textContent).toContain(
      "Accept, redirect, or reject it when ready.",
    );
  });

  it("keeps a linked review authoritative when its Attention receipt is not saved", async () => {
    const mutations: WorkspaceMutation[] = [];
    const markReviewed = vi.fn(async () => false);
    const reviewController = createReviewController(markReviewed);

    await act(async () =>
      root.render(
        <WorkspaceInspectorHarness
          initial={workspaceFixture(true)}
          reviewController={reviewController}
          mutations={mutations}
        />,
      ),
    );

    await click(buttonNamed(container, "Mark reviewed"));
    await nextAnimationFrame();

    expect(mutations).toMatchObject([{ type: "result.review" }]);
    expect(markReviewed).toHaveBeenCalledWith(item.eventKey);
    expect(container.textContent).toContain("Result marked reviewed in Plan");
    expect(container.textContent).toContain(
      "Its separate Attention receipt was not saved",
    );
    expect(container.textContent).toContain(
      "the durable result review still resolves this completion",
    );
    expect(container.textContent).not.toContain(
      "Accept, redirect, or reject it when ready.",
    );
    expect(container.textContent).toContain(
      "Reviewed in Plan. This completion no longer needs Attention.",
    );
    expect(container.textContent).toContain(
      "This result is reviewed. Accept it or choose another pass below.",
    );
    expect(() => buttonNamed(container, "Mark reviewed")).toThrow(
      'Missing button named "Mark reviewed".',
    );
    expect(
      normalized(
        container.querySelector(
          '[data-review-act-inspector="true"] header span',
        )?.textContent,
      ),
    ).toBe("Reviewed");
    expect(document.activeElement).toBe(
      container.querySelector('[role="status"][tabindex="-1"]'),
    );
  });

  it("keeps an unlinked Attention item truthful when marking reviewed fails", async () => {
    const markReviewed = vi.fn(async () => false);
    const reviewController = createReviewController(markReviewed);

    await act(async () =>
      root.render(
        <WorkspaceInspectorHarness
          initial={workspaceFixture(false)}
          reviewController={reviewController}
          mutations={[]}
        />,
      ),
    );

    await click(buttonNamed(container, "Mark reviewed"));

    expect(markReviewed).toHaveBeenCalledWith(item.eventKey);
    expect(container.textContent).toContain(
      "This result was not marked reviewed because its Attention receipt was not saved.",
    );
    expect(buttonNamed(container, "Mark reviewed")).not.toBeNull();
  });

  it("links a completed task to planned work and uses the planned expected outcome", async () => {
    const mutations: WorkspaceMutation[] = [];
    const reviewController = createReviewController();

    await act(async () =>
      root.render(
        <WorkspaceInspectorHarness
          initial={workspaceFixture(false)}
          reviewController={reviewController}
          mutations={mutations}
        />,
      ),
    );

    await click(buttonNamed(container, "Track this work"));
    await selectOption(
      controlLabelled<HTMLSelectElement>(container, "Link to"),
      "work-a",
    );
    expect(container.textContent).toContain(
      "This will be the primary attempt for the selected work item.",
    );
    await click(buttonNamed(container, "Link task"));

    expect(mutations).toHaveLength(1);
    expect(mutations[0]).toMatchObject({
      type: "attempt.upsert",
      projectId: "project-a",
      objectiveId: "objective-a",
      workItemId: "work-a",
      attempt: {
        codexTaskId: "task-a",
        relationship: "primary",
        resultCycles: [
          {
            key: { kind: "revision", id: item.eventKey },
            observedAt: task.status.timestamp,
          },
        ],
      },
    });
    expect(container.textContent).toContain("Ship the useful review workflow");
    expect(container.textContent).toContain("Review the completed slice");
    expect(container.textContent).toContain(
      "The completed slice meets its checks and is ready to keep.",
    );
    expect(container.textContent).toContain("Coffice work item");
  });

  it("records review before accepting a linked result", async () => {
    const mutations: WorkspaceMutation[] = [];
    const reviewController = createReviewController();
    let latestWorkspace = reduceCofficeWorkspace(
      reduceCofficeWorkspace(
        workspaceFixture(true),
        {
          type: "assessment.set",
          assessment: {
            target: verificationTarget,
            risks: ["Result risk"],
            uncertainties: [],
            blockedDecisions: [],
            nextAction: { kind: "send_follow_up", note: "Clarify first" },
          },
        },
        NOW,
      ),
      {
        type: "assessment.set",
        assessment: {
          target: {
            projectId: "project-a",
            objectiveId: "objective-a",
            workItemId: "work-a",
          },
          risks: [],
          uncertainties: ["Work uncertainty"],
          blockedDecisions: [],
        },
      },
      NOW,
    );
    latestWorkspace = reduceCofficeWorkspace(
      latestWorkspace,
      {
        type: "workItem.definitionOfDone.set",
        projectId: "project-a",
        objectiveId: "objective-a",
        workItemId: "work-a",
        definitionOfDone: [
          "The review surface stays contained.",
          "A human decides whether the outcome is acceptable.",
        ],
      },
      NOW,
    );
    latestWorkspace = reduceCofficeWorkspace(
      latestWorkspace,
      {
        type: "project.rules.set",
        projectId: "project-a",
        rules: ["Keep acceptance a deliberate human decision."],
      },
      NOW,
    );
    latestWorkspace = reduceCofficeWorkspace(
      latestWorkspace,
      {
        type: "project.qualityBars.set",
        projectId: "project-a",
        qualityBars: [{ profileId: "test", profileVersion: "1" }],
      },
      NOW,
    );
    latestWorkspace = {
      ...latestWorkspace,
      verificationReceipts: [
        {
          ...verificationReceipt("failed"),
          idempotencyKey: "quality-bar-failed-key",
          requestHash: "a".repeat(64),
        },
      ],
    };

    await act(async () =>
      root.render(
        <WorkspaceInspectorHarness
          initial={latestWorkspace}
          reviewController={reviewController}
          mutations={mutations}
          onWorkspace={(workspace) => {
            latestWorkspace = workspace;
          }}
        />,
      ),
    );

    await click(buttonNamed(container, "Accept result"));
    expect(mutations).toHaveLength(0);
    const currentRules = container.querySelector(
      '[data-current-project-rules="true"]',
    );
    expect(currentRules?.textContent).toContain(
      "Keep acceptance a deliberate human decision.",
    );
    expect(currentRules?.textContent).toContain(
      "Coffice does not enforce these rules or treat them as evidence.",
    );
    expect(
      container.textContent?.match(/Agent self-critique: not reported\./gu),
    ).toHaveLength(1);
    expect(container.textContent).toContain(
      "2 unresolved review notes remain across the exact result and work item.",
    );
    expect(container.textContent).toContain(
      "1 saved advisory next action does not recommend acceptance.",
    );
    expect(container.textContent).toContain(
      "Accepting keeps these annotations and does not perform or clear any advisory action.",
    );
    expect(container.textContent).toContain(
      "Definition of Done has 2 current criteria. Coffice does not verify them automatically; acceptance is your decision.",
    );
    expect(
      container.querySelector(
        '[data-current-project-quality-bars="true"] [data-quality-bar-readiness="not_ready"]',
      )?.textContent,
    ).toBe("Not ready");
    expect(container.textContent).toContain(
      "Current project quality bars: Not ready. Coffice does not run checks automatically or block acceptance.",
    );
    expect(buttonNamed(container, "Confirm decision").disabled).toBe(false);
    expect(
      buttonNamed(container, "Confirm decision").getAttribute(
        "aria-describedby",
      ),
    ).toBe(
      "accept-quality-bars-advisory accept-definition-of-done-advisory accept-work-links-advisory accept-assessment-warning",
    );
    expect(document.activeElement).toBe(
      buttonNamed(container, "Confirm decision"),
    );
    await click(buttonNamed(container, "Confirm decision"));
    await nextAnimationFrame();

    expect(mutations.slice(0, 2).map((mutation) => mutation.type)).toEqual([
      "result.review",
      "result.decide",
    ]);
    expect(mutations[0]).toMatchObject({
      type: "result.review",
      attemptId: "attempt-a",
      resultKey: { kind: "revision", id: item.eventKey },
    });
    expect(mutations[1]).toMatchObject({
      type: "result.decide",
      attemptId: "attempt-a",
      resultKey: { kind: "revision", id: item.eventKey },
      decision: { kind: "accepted" },
      evidence: {
        kind: "decision",
        decisionKind: "accepted",
        summary: "User accepted this result.",
        attemptId: "attempt-a",
        resultKey: { kind: "revision", id: item.eventKey },
      },
    });
    expect(reviewController.markReviewed).toHaveBeenCalledWith(item.eventKey);
    expect(latestWorkspace.projects[0].objectives[0].workItems[0].status).toBe(
      "accepted",
    );
    expect(latestWorkspace.reviewAssessments).toHaveLength(2);
    expect(
      container.querySelector('[data-result-decision="accepted"]'),
    ).not.toBeNull();
    expect(document.activeElement).toBe(
      container.querySelector('[data-result-decision="accepted"]'),
    );
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Tab",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(
      container
        .querySelector('[data-review-act-inspector="true"]')
        ?.contains(document.activeElement),
    ).toBe(true);
  });

  it("keeps current project decisions read-only and neutral during exact-result acceptance", async () => {
    const mutations: WorkspaceMutation[] = [];
    const reviewController = createReviewController();
    let latestWorkspace = reduceCofficeWorkspace(
      workspaceFixture(true),
      {
        type: "projectDecision.record",
        id: "decision-current",
        projectId: project.id,
        statement: "Keep the exact result association intact.",
      },
      NOW,
    );
    const decisionsBefore = structuredClone(
      latestWorkspace.projectDecisionEvents,
    );

    await act(async () =>
      root.render(
        <WorkspaceInspectorHarness
          initial={latestWorkspace}
          reviewController={reviewController}
          mutations={mutations}
          onWorkspace={(workspace) => {
            latestWorkspace = workspace;
          }}
        />,
      ),
    );

    expect(
      container.querySelector('[data-project-decision-id="decision-current"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-current-definition-of-done="true"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain("Current definition of done");
    expect(container.textContent).toContain("No definition of done recorded.");
    expect(buttonNamed(container, "Accept result").disabled).toBe(false);
    await click(buttonNamed(container, "Accept result"));
    expect(buttonNamed(container, "Confirm decision").disabled).toBe(false);
    expect(container.querySelector("#accept-assessment-warning")).toBeNull();
    expect(container.textContent).toContain(
      "No Definition of Done is recorded for this work item. Acceptance is your decision.",
    );
    await click(buttonNamed(container, "Confirm decision"));
    await nextAnimationFrame();

    expect(mutations.slice(0, 2)).toMatchObject([
      {
        type: "result.review",
        projectId: "project-a",
        objectiveId: "objective-a",
        workItemId: "work-a",
        attemptId: "attempt-a",
        resultKey: { kind: "revision", id: item.eventKey },
      },
      {
        type: "result.decide",
        projectId: "project-a",
        objectiveId: "objective-a",
        workItemId: "work-a",
        attemptId: "attempt-a",
        resultKey: { kind: "revision", id: item.eventKey },
        decision: { kind: "accepted" },
      },
    ]);
    expect(latestWorkspace.projectDecisionEvents).toEqual(decisionsBefore);
  });

  it("keeps an accepted decision authoritative when its Attention receipt is not saved", async () => {
    const mutations: WorkspaceMutation[] = [];
    const markReviewed = vi.fn(async () => false);
    const reviewController = createReviewController(markReviewed);
    let latestWorkspace = workspaceFixture(true);

    await act(async () =>
      root.render(
        <WorkspaceInspectorHarness
          initial={latestWorkspace}
          reviewController={reviewController}
          mutations={mutations}
          onWorkspace={(workspace) => {
            latestWorkspace = workspace;
          }}
        />,
      ),
    );

    await click(buttonNamed(container, "Accept result"));
    await click(buttonNamed(container, "Confirm decision"));
    await nextAnimationFrame();

    expect(mutations.slice(0, 2).map((mutation) => mutation.type)).toEqual([
      "result.review",
      "result.decide",
    ]);
    expect(markReviewed).toHaveBeenCalledWith(item.eventKey);
    expect(latestWorkspace.projects[0].objectives[0].workItems[0].status).toBe(
      "accepted",
    );
    const status = container.querySelector('[data-result-decision="accepted"]');
    expect(status).not.toBeNull();
    expect(document.activeElement).toBe(status);
    expect(container.textContent).toContain(
      "The separate Attention receipt was not saved, but the durable result review still resolves this completion.",
    );
  });

  it("cancels a pending decision when a newer result arrives", async () => {
    const mutations: WorkspaceMutation[] = [];
    const reviewController = createReviewController();
    const render = async (taskValue: ReviewTask, projectValue: ReviewProject) =>
      await act(async () =>
        root.render(
          <WorkspaceInspectorHarness
            initial={workspaceFixture(true)}
            reviewController={reviewController}
            mutations={mutations}
            taskValue={taskValue}
            projectValue={projectValue}
          />,
        ),
      );

    await render(task, project);
    await click(buttonNamed(container, "Accept result"));
    expect(buttonNamed(container, "Confirm decision")).not.toBeNull();

    const laterTask: ReviewTask = {
      ...task,
      updatedAt: "2026-08-10T10:08:00.000Z",
      lastActivityAt: "2026-08-10T10:08:00.000Z",
      status: {
        ...task.status,
        timestamp: "2026-08-10T10:08:00.000Z",
      },
    };
    await render(laterTask, { ...project, tasks: [laterTask] });
    await act(async () => {
      await Promise.resolve();
    });

    expect(
      [...container.querySelectorAll("button")].some(
        (button) => button.textContent?.trim() === "Confirm decision",
      ),
    ).toBe(false);
    expect(mutations).toHaveLength(0);
    expect(container.textContent).toContain(
      "A newer result arrived. Review it before deciding.",
    );
    expect(document.activeElement).toBe(
      buttonNamed(container, "Accept result"),
    );
  });

  it("returns focus to the result choice when decision confirmation is cancelled", async () => {
    await act(async () =>
      root.render(
        <WorkspaceInspectorHarness
          initial={workspaceFixture(true)}
          reviewController={createReviewController()}
          mutations={[]}
        />,
      ),
    );

    await click(buttonNamed(container, "Reject result"));
    expect(document.activeElement).toBe(
      buttonNamed(container, "Confirm decision"),
    );
    await click(buttonNamed(container, "Back"));
    await nextAnimationFrame();
    expect(document.activeElement).toBe(
      buttonNamed(container, "Reject result"),
    );
  });

  it("records review before redirecting a linked result for another pass", async () => {
    const mutations: WorkspaceMutation[] = [];
    const reviewController = createReviewController();
    let latestWorkspace = workspaceFixture(true);

    await act(async () =>
      root.render(
        <WorkspaceInspectorHarness
          initial={latestWorkspace}
          reviewController={reviewController}
          mutations={mutations}
          onWorkspace={(workspace) => {
            latestWorkspace = workspace;
          }}
        />,
      ),
    );

    await click(buttonNamed(container, "Needs another pass"));
    expect(mutations).toHaveLength(0);
    await click(buttonNamed(container, "Confirm decision"));

    expect(mutations.slice(0, 2).map((mutation) => mutation.type)).toEqual([
      "result.review",
      "result.decide",
    ]);
    expect(mutations[1]).toMatchObject({
      type: "result.decide",
      attemptId: "attempt-a",
      resultKey: { kind: "revision", id: item.eventKey },
      decision: { kind: "redirected" },
      evidence: {
        kind: "decision",
        decisionKind: "redirected",
        summary: "User requested another pass.",
        attemptId: "attempt-a",
        resultKey: { kind: "revision", id: item.eventKey },
      },
    });
    expect(reviewController.markReviewed).toHaveBeenCalledWith(item.eventKey);
    expect(latestWorkspace.projects[0].objectives[0].workItems[0].status).toBe(
      "in_progress",
    );
    expect(
      container.querySelector('[data-result-decision="redirected"]'),
    ).not.toBeNull();
  });

  it("records rejection as distinct from requesting another pass", async () => {
    const mutations: WorkspaceMutation[] = [];
    const reviewController = createReviewController();
    let latestWorkspace = workspaceFixture(true);

    await act(async () =>
      root.render(
        <WorkspaceInspectorHarness
          initial={latestWorkspace}
          reviewController={reviewController}
          mutations={mutations}
          onWorkspace={(workspace) => {
            latestWorkspace = workspace;
          }}
        />,
      ),
    );

    await click(buttonNamed(container, "Reject result"));
    expect(mutations).toHaveLength(0);
    await click(buttonNamed(container, "Confirm decision"));

    expect(mutations.slice(0, 2).map((mutation) => mutation.type)).toEqual([
      "result.review",
      "result.decide",
    ]);
    expect(mutations[1]).toMatchObject({
      type: "result.decide",
      attemptId: "attempt-a",
      resultKey: { kind: "revision", id: item.eventKey },
      decision: { kind: "rejected" },
      evidence: {
        kind: "decision",
        decisionKind: "rejected",
        summary: "User rejected this result.",
        attemptId: "attempt-a",
        resultKey: { kind: "revision", id: item.eventKey },
      },
    });
    expect(reviewController.markReviewed).toHaveBeenCalledWith(item.eventKey);
    expect(latestWorkspace.projects[0].objectives[0].workItems[0].status).toBe(
      "in_progress",
    );
    expect(
      container.querySelector('[data-result-decision="rejected"]'),
    ).not.toBeNull();
  });

  it("redirects one completion and accepts a later revision on the same task link", async () => {
    const mutations: WorkspaceMutation[] = [];
    const reviewController = createReviewController();
    let latestWorkspace = workspaceFixture(true);
    const onWorkspace = (workspace: CofficeWorkspace) => {
      latestWorkspace = workspace;
    };
    const renderInspector = async (
      taskValue: ReviewTask,
      projectValue: ReviewProject,
    ) => {
      await act(async () =>
        root.render(
          <WorkspaceInspectorHarness
            initial={workspaceFixture(true)}
            reviewController={reviewController}
            mutations={mutations}
            onWorkspace={onWorkspace}
            taskValue={taskValue}
            projectValue={projectValue}
          />,
        ),
      );
    };

    await renderInspector(task, project);
    await click(buttonNamed(container, "Needs another pass"));
    await click(buttonNamed(container, "Confirm decision"));

    const laterTask: ReviewTask = {
      ...task,
      updatedAt: "2026-08-10T10:08:00.000Z",
      lastActivityAt: "2026-08-10T10:08:00.000Z",
      status: {
        ...task.status,
        timestamp: "2026-08-10T10:08:00.000Z",
      },
    };
    const laterProject: ReviewProject = {
      ...project,
      tasks: [laterTask],
    };
    const laterItem = createAttentionItem(laterProject, laterTask)!;

    await renderInspector(laterTask, laterProject);
    await click(buttonNamed(container, "Accept result"));
    await click(buttonNamed(container, "Confirm decision"));

    expect(mutations.map((mutation) => mutation.type)).toEqual([
      "result.review",
      "result.decide",
      "result.upsert",
      "result.review",
      "result.decide",
    ]);
    expect(mutations[2]).toMatchObject({
      type: "result.upsert",
      attemptId: "attempt-a",
      result: {
        key: { kind: "revision", id: laterItem.eventKey },
        observedAt: "2026-08-10T10:08:00.000Z",
      },
    });
    expect(mutations[4]).toMatchObject({
      type: "result.decide",
      resultKey: { kind: "revision", id: laterItem.eventKey },
      decision: { kind: "accepted" },
      evidence: {
        decisionKind: "accepted",
        resultKey: { kind: "revision", id: laterItem.eventKey },
      },
    });

    const itemState = latestWorkspace.projects[0].objectives[0].workItems[0];
    expect(itemState.status).toBe("accepted");
    expect(itemState.attempts).toHaveLength(1);
    expect(itemState.attempts[0].resultCycles).toMatchObject([
      { review: { decision: { kind: "redirected" } } },
      {
        key: { id: laterItem.eventKey },
        review: { decision: { kind: "accepted" } },
      },
    ]);
    expect(reviewController.markReviewed).toHaveBeenNthCalledWith(
      1,
      item.eventKey,
    );
    expect(reviewController.markReviewed).toHaveBeenNthCalledWith(
      2,
      laterItem.eventKey,
    );
  });

  it("requires separate confirmation for follow-up, review, and archive actions", async () => {
    const mutations: WorkspaceMutation[] = [];
    const submitFollowUp = vi.fn(async (): Promise<CodexOperation> => ({
      id: "operation-follow-up",
      kind: "send_follow_up",
      taskId: task.id,
      state: "queued",
      createdAt: NOW,
      updatedAt: NOW,
    }));
    const requestReview = vi.fn(async (): Promise<CodexOperation> => ({
      id: "operation-review",
      kind: "request_review",
      taskId: task.id,
      state: "queued",
      createdAt: NOW,
      updatedAt: NOW,
    }));
    const archiveTask = vi.fn(async (): Promise<CodexOperation> => ({
      id: "operation-archive",
      kind: "archive_task",
      taskId: task.id,
      state: "completed",
      createdAt: NOW,
      updatedAt: NOW,
    }));
    const actions: CodexActionsController = {
      operations: [],
      available: true,
      error: null,
      submitFollowUp,
      requestReview,
      archiveTask,
      latestOperationFor: () => undefined,
    };

    await act(async () =>
      root.render(
        <WorkspaceInspectorHarness
          initial={workspaceFixture(true)}
          reviewController={createReviewController()}
          mutations={mutations}
          actions={actions}
        />,
      ),
    );

    await click(buttonNamed(container, "Send follow-up"));
    const instruction =
      "Run the focused checks and report only structural evidence.";
    await enterText(
      controlLabelled<HTMLTextAreaElement>(container, "Follow-up instruction"),
      instruction,
    );
    await click(buttonNamed(container, "Review before sending"));

    expect(submitFollowUp).not.toHaveBeenCalled();
    const confirmation = container.querySelector<HTMLElement>(
      '[role="group"][aria-label="Confirm Codex action"]',
    );
    expect(confirmation).not.toBeNull();
    expect(confirmation?.textContent).toContain(task.title);
    expect(confirmation?.textContent).toContain(instruction);

    expect(document.activeElement).toBe(buttonNamed(container, "Back"));
    await click(buttonNamed(container, "Confirm & send"));
    await nextAnimationFrame();
    expect(submitFollowUp).toHaveBeenCalledOnce();
    expect(submitFollowUp).toHaveBeenCalledWith(task.id, instruction);
    expect(container.textContent).not.toContain(instruction);
    expect(document.activeElement).toBe(
      container.querySelector('[data-dialog-initial-focus="true"]'),
    );

    await click(buttonNamed(container, "Send follow-up"));
    expect(
      controlLabelled<HTMLTextAreaElement>(container, "Follow-up instruction")
        .value,
    ).toBe("");
    await click(buttonNamed(container, "Cancel"));
    await nextAnimationFrame();
    expect(document.activeElement).toBe(
      buttonNamed(container, "Send follow-up"),
    );

    await click(buttonNamed(container, "Request review"));
    expect(requestReview).not.toHaveBeenCalled();
    const reviewConfirmation = container.querySelector(
      '[role="group"][aria-label="Confirm Codex action"]',
    );
    expect(reviewConfirmation?.textContent).toContain(
      "review uncommitted changes for Project A",
    );
    expect(
      reviewConfirmation?.querySelector('[data-follow-up-preview="true"]'),
    ).toBeNull();
    const reviewCopy = reviewConfirmation?.querySelector(
      '[aria-label="Review request to send"]',
    );
    expect(reviewCopy?.getAttribute("tabindex")).toBeNull();
    await click(buttonNamed(container, "Back"));
    await nextAnimationFrame();
    expect(document.activeElement).toBe(
      buttonNamed(container, "Request review"),
    );
    await click(buttonNamed(container, "Request review"));
    await click(buttonNamed(container, "Confirm review"));
    expect(requestReview).toHaveBeenCalledOnce();
    expect(requestReview).toHaveBeenCalledWith(task.id);

    await click(buttonNamed(container, "Archive task"));
    expect(archiveTask).not.toHaveBeenCalled();
    const archiveConfirmation = container.querySelector(
      '[role="group"][aria-label="Confirm Codex action"]',
    );
    expect(archiveConfirmation?.textContent).toContain(
      "Saved Coffice plans, results, decisions, and receipts remain",
    );
    expect(archiveConfirmation?.textContent).toContain(
      "This does not delete the task",
    );
    expect(document.activeElement).toBe(buttonNamed(container, "Back"));
    await click(buttonNamed(container, "Back"));
    await nextAnimationFrame();
    expect(document.activeElement).toBe(buttonNamed(container, "Archive task"));
    await click(buttonNamed(container, "Archive task"));
    await click(buttonNamed(container, "Archive task"));
    expect(archiveTask).toHaveBeenCalledOnce();
    expect(archiveTask).toHaveBeenCalledWith(task.id);
    expect(mutations).toEqual([]);
  });

  it("reviews and confirms one transient Codex callback without workspace writes", async () => {
    const respondToApproval = vi.fn(async (): Promise<CodexOperation> => ({
      id: "operation-waiting",
      kind: "send_follow_up",
      taskId: task.id,
      state: "running",
      turnId: "turn-waiting",
      createdAt: NOW,
      updatedAt: NOW,
    }));
    const mutations: WorkspaceMutation[] = [];
    const waiting: CodexOperation = {
      id: "operation-waiting",
      kind: "send_follow_up",
      taskId: task.id,
      state: "waiting",
      turnId: "turn-waiting",
      createdAt: NOW,
      updatedAt: NOW,
    };
    const actions: CodexActionsController = {
      operations: [waiting],
      pendingRequests: [
        {
          id: "request-command",
          operationId: waiting.id,
          taskId: task.id,
          receivedAt: NOW,
          kind: "command_approval",
          command: "npm run test:focused",
          cwd: "C:\\trusted-project",
          environmentId: "local-sandbox",
          reason: "Run the focused checks",
          allowOnce: true,
          canDecline: true,
          canCancel: true,
          requiresCodexReview: false,
        },
      ],
      available: true,
      error: null,
      submitFollowUp: vi.fn(),
      requestReview: vi.fn(),
      respondToApproval,
      latestOperationFor: () => waiting,
    };

    await act(async () =>
      root.render(
        <WorkspaceInspectorHarness
          initial={workspaceFixture(true)}
          reviewController={createReviewController()}
          mutations={mutations}
          actions={actions}
        />,
      ),
    );
    await nextAnimationFrame();

    expect(container.textContent).toContain("npm run test:focused");
    expect(container.textContent).toContain("C:\\trusted-project");
    expect(container.textContent).toContain("local-sandbox");
    expect(container.textContent).not.toContain("acceptForSession");
    expect(document.activeElement).toBe(
      buttonNamed(container, "Review allow once"),
    );
    await click(buttonNamed(container, "Review allow once"));
    expect(respondToApproval).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(buttonNamed(container, "Back"));
    await click(buttonNamed(container, "Confirm response"));
    expect(respondToApproval).toHaveBeenCalledWith(
      "request-command",
      task.id,
      "accept",
    );
    expect(mutations).toEqual([]);
  });

  it("hides secret clarification text during confirmation", async () => {
    const respondToClarification = vi.fn(async (): Promise<CodexOperation> => ({
      id: "operation-question",
      kind: "send_follow_up",
      taskId: task.id,
      state: "running",
      turnId: "turn-question",
      createdAt: NOW,
      updatedAt: NOW,
    }));
    const waiting: CodexOperation = {
      id: "operation-question",
      kind: "send_follow_up",
      taskId: task.id,
      state: "waiting",
      turnId: "turn-question",
      createdAt: NOW,
      updatedAt: NOW,
    };
    const actions: CodexActionsController = {
      operations: [waiting],
      pendingRequests: [
        {
          id: "request-question",
          operationId: waiting.id,
          taskId: task.id,
          receivedAt: NOW,
          kind: "clarification",
          questions: [
            {
              id: "local-secret",
              header: "Access phrase",
              question: "Enter the one-time phrase.",
              isSecret: true,
              allowOther: false,
              options: [],
            },
          ],
        },
      ],
      available: true,
      error: null,
      submitFollowUp: vi.fn(),
      requestReview: vi.fn(),
      respondToClarification,
      latestOperationFor: () => waiting,
    };
    await act(async () =>
      root.render(
        <WorkspaceInspectorHarness
          initial={workspaceFixture(true)}
          reviewController={createReviewController()}
          mutations={[]}
          actions={actions}
        />,
      ),
    );
    const secret = controlLabelled<HTMLInputElement>(container, "Your answer");
    expect(secret.type).toBe("password");
    await enterText(secret, "private-once-only");
    await click(buttonNamed(container, "Review answers"));
    expect(container.textContent).toContain("Secret answer entered");
    expect(container.textContent).not.toContain("private-once-only");
    expect(respondToClarification).not.toHaveBeenCalled();
    await click(buttonNamed(container, "Confirm response"));
    expect(respondToClarification).toHaveBeenCalledWith(
      "request-question",
      task.id,
      { "local-secret": ["private-once-only"] },
    );
  });

  it("keeps plan-link changes and Codex actions mutually exclusive", async () => {
    const actions: CodexActionsController = {
      operations: [],
      available: true,
      error: null,
      submitFollowUp: vi.fn(),
      requestReview: vi.fn(),
      latestOperationFor: () => undefined,
    };
    const assignedTask: ReviewTask = {
      ...task,
      assignmentEvidence: "explicit_project",
    };
    await act(async () =>
      root.render(
        <WorkspaceInspectorHarness
          initial={workspaceFixture(true)}
          reviewController={createReviewController()}
          mutations={[]}
          actions={actions}
          taskValue={assignedTask}
          projectValue={{ ...project, tasks: [assignedTask] }}
        />,
      ),
    );

    await click(buttonNamed(container, "Change plan link"));
    expect(buttonNamed(container, "Send follow-up").disabled).toBe(true);
    expect(buttonNamed(container, "Request review").disabled).toBe(true);
    await click(buttonNamed(container, "Send follow-up"));
    expect(container.textContent).not.toContain("Follow-up instruction");

    await act(async () =>
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })),
    );
    expect(buttonNamed(container, "Send follow-up").disabled).toBe(false);
  });

  it("confirms cancellation of one tracked Codex action without touching workspace state", async () => {
    const running: CodexOperation = {
      id: "operation-running-cancel",
      kind: "send_follow_up",
      taskId: task.id,
      state: "running",
      turnId: "turn-running-cancel",
      createdAt: NOW,
      updatedAt: NOW,
    };
    const cancelling: CodexOperation = {
      ...running,
      cancelRequestedAt: "2026-08-10T10:06:30.000Z",
    };
    const cancelOperation = vi.fn(async () => cancelling);
    const mutations: WorkspaceMutation[] = [];
    const actions: CodexActionsController = {
      operations: [running],
      available: true,
      error: null,
      submitFollowUp: vi.fn(),
      requestReview: vi.fn(),
      cancelOperation,
      latestOperationFor: () => running,
    };

    await act(async () =>
      root.render(
        <WorkspaceInspectorHarness
          initial={workspaceFixture(true)}
          reviewController={createReviewController()}
          mutations={mutations}
          actions={actions}
        />,
      ),
    );

    await click(buttonNamed(container, "Stop action"));
    expect(cancelOperation).not.toHaveBeenCalled();
    const confirmation = container.querySelector(
      '[role="group"][aria-label="Confirm Codex cancellation"]',
    );
    expect(confirmation?.textContent).toContain(
      "Work already completed may remain",
    );
    expect(confirmation?.textContent).toContain(
      "outcome stays unknown and Coffice does not retry",
    );
    expect(document.activeElement).toBe(buttonNamed(container, "Back"));

    await act(async () =>
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })),
    );
    await nextAnimationFrame();
    expect(document.activeElement).toBe(buttonNamed(container, "Stop action"));

    await click(buttonNamed(container, "Stop action"));
    await click(buttonNamed(container, "Stop action"));
    expect(cancelOperation).toHaveBeenCalledOnce();
    expect(cancelOperation).toHaveBeenCalledWith(running.id, task.id);
    expect(mutations).toEqual([]);

    await act(async () =>
      root.render(
        <WorkspaceInspectorHarness
          initial={workspaceFixture(true)}
          reviewController={createReviewController()}
          mutations={mutations}
          actions={{
            ...actions,
            operations: [cancelling],
            latestOperationFor: () => cancelling,
          }}
        />,
      ),
    );
    expect(container.textContent).toContain(
      "Stop requested. Waiting for Codex to report the final task state.",
    );
    expect(
      [...container.querySelectorAll("button")].some(
        (button) => normalized(button.textContent) === "Stop action",
      ),
    ).toBe(false);
  });

  it("inserts editable current plan context without persisting it and sends the reviewed snapshot exactly", async () => {
    const mutations: WorkspaceMutation[] = [];
    const submitFollowUp = vi.fn(async (): Promise<CodexOperation> => ({
      id: "operation-context-follow-up",
      kind: "send_follow_up",
      taskId: task.id,
      state: "queued",
      createdAt: NOW,
      updatedAt: NOW,
    }));
    const actions: CodexActionsController = {
      operations: [],
      available: true,
      error: null,
      submitFollowUp,
      requestReview: vi.fn(),
      latestOperationFor: () => undefined,
    };
    const assignedTask: ReviewTask = {
      ...task,
      assignmentEvidence: "explicit_project",
      assignmentSourceFresh: true,
    };
    const sourceWorkspace = {
      ...workspaceFixture(true),
      projectDecisionEvents: [
        {
          id: "active-decision",
          projectId: project.id,
          action: "recorded" as const,
          statement: "Keep the confirmation explicit.",
          context: "This is user-recorded context.",
          authorship: "user" as const,
          recordedAt: NOW,
        },
      ],
    };

    await act(async () =>
      root.render(
        <WorkspaceInspectorHarness
          initial={sourceWorkspace}
          reviewController={createReviewController()}
          mutations={mutations}
          actions={actions}
          taskValue={assignedTask}
          projectValue={{ ...project, tasks: [assignedTask] }}
        />,
      ),
    );

    await click(buttonNamed(container, "Send follow-up"));
    expect(buttonNamed(container, "Change plan link").disabled).toBe(true);
    const insert = buttonNamed(container, "Insert current plan context");
    expect(insert.disabled).toBe(false);
    const helperId = insert.getAttribute("aria-describedby");
    expect(helperId).toBeTruthy();
    expect(document.getElementById(helperId!)?.textContent).toContain(
      "current Coffice objective",
    );
    expect(document.getElementById(helperId!)?.textContent).toContain(
      "Nothing is sent until you review and confirm",
    );

    await click(insert);
    const textarea = controlLabelled<HTMLTextAreaElement>(
      container,
      "Follow-up instruction",
    );
    expect(mutations).toEqual([]);
    expect(
      [...container.querySelectorAll('[role="status"]')].some(
        (status) =>
          status.textContent ===
          "Inserted from the current Coffice plan. Review and edit before sending.",
      ),
    ).toBe(true);
    expect(textarea.value).toContain("Coffice plan context copied for review");
    expect(textarea.value).toContain(
      "Objective definition of success: The project can be reviewed and acted on safely.",
    );
    expect(textarea.value).toContain(
      "Expected outcome: The completed slice meets its checks and is ready to keep.",
    );
    expect(textarea.value).toContain("- Keep the confirmation explicit.");
    expect(textarea.value).toContain(
      "Recorded context: This is user-recorded context.",
    );
    expect(textarea.value).not.toContain("active-decision");
    expect(textarea.value).not.toContain(NOW);
    expect(textarea.selectionStart).toBe(textarea.value.length);
    expect(textarea.selectionEnd).toBe(textarea.value.length);
    expect(insert.disabled).toBe(true);
    expect(document.getElementById(helperId!)?.textContent).toContain(
      "empty instruction",
    );

    const edited = `${textarea.value}\n\nPlease report the focused checks.`;
    await enterText(textarea, `  ${edited}  `);
    expect(container.textContent).not.toContain(
      "Inserted from the current Coffice plan. Review and edit before sending.",
    );
    await click(buttonNamed(container, "Review before sending"));
    const preview = container.querySelector<HTMLElement>(
      '[data-follow-up-preview="true"]',
    );
    expect(preview?.textContent).toBe(edited);
    expect(preview?.tabIndex).toBe(0);
    expect(preview?.getAttribute("aria-label")).toBe(
      "Follow-up instruction to send",
    );
    expect(container.textContent).toContain(
      "Coffice plan context was inserted into this draft",
    );
    expect(document.activeElement).toBe(buttonNamed(container, "Back"));

    await act(async () =>
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })),
    );
    await nextAnimationFrame();
    const restoredTextarea = controlLabelled<HTMLTextAreaElement>(
      container,
      "Follow-up instruction",
    );
    expect(document.activeElement).toBe(restoredTextarea);
    expect(restoredTextarea.value).toBe(`  ${edited}  `);

    const replacement = "Send only this fully replaced instruction.";
    await enterText(restoredTextarea, replacement);
    await click(buttonNamed(container, "Review before sending"));
    expect(
      container.querySelector<HTMLElement>('[data-follow-up-preview="true"]')
        ?.textContent,
    ).toBe(replacement);
    expect(container.textContent).toContain(
      "Coffice plan context was inserted into this draft. Review the exact text above",
    );
    await click(buttonNamed(container, "Confirm & send"));
    expect(submitFollowUp).toHaveBeenCalledWith(task.id, replacement);
    expect(mutations).toEqual([]);
  });

  it("never substitutes a historical plan link and clears the private draft when the task changes", async () => {
    const actions: CodexActionsController = {
      operations: [],
      available: true,
      error: null,
      submitFollowUp: vi.fn(),
      requestReview: vi.fn(),
      latestOperationFor: () => undefined,
    };
    const assignedTask: ReviewTask = {
      ...task,
      assignmentEvidence: "explicit_project",
      assignmentSourceFresh: true,
    };

    await act(async () =>
      root.render(
        <WorkspaceInspectorHarness
          initial={resumableWorkspace()}
          reviewController={createReviewController()}
          mutations={[]}
          actions={actions}
          taskValue={assignedTask}
          projectValue={{ ...project, tasks: [assignedTask] }}
        />,
      ),
    );
    await click(buttonNamed(container, "Send follow-up"));
    const insert = buttonNamed(container, "Insert current plan context");
    expect(insert.disabled).toBe(true);
    expect(
      document.getElementById(insert.getAttribute("aria-describedby")!)
        ?.textContent,
    ).toContain("Historical plan links are not inserted");
    expect(
      controlLabelled<HTMLTextAreaElement>(container, "Follow-up instruction")
        .value,
    ).toBe("");

    await enterText(
      controlLabelled<HTMLTextAreaElement>(container, "Follow-up instruction"),
      "Private draft for task A",
    );
    await click(buttonNamed(container, "Review before sending"));
    expect(container.textContent).toContain("Private draft for task A");
    const nextTask: ReviewTask = {
      ...assignedTask,
      id: "task-b",
      title: "A different task",
    };
    await act(async () =>
      root.render(
        <WorkspaceInspectorHarness
          initial={resumableWorkspace()}
          reviewController={createReviewController()}
          mutations={[]}
          actions={actions}
          taskValue={nextTask}
          projectValue={{ ...project, tasks: [nextTask] }}
        />,
      ),
    );
    expect(container.textContent).not.toContain("Private draft for task A");
    expect(
      container.querySelector('[aria-label="Confirm Codex action"]'),
    ).toBeNull();
    expect(buttonNamed(container, "Send follow-up")).not.toBeNull();
  });

  it("inserts the unique current destination while excluding a task's historical work item", async () => {
    const actions: CodexActionsController = {
      operations: [],
      available: true,
      error: null,
      submitFollowUp: vi.fn(),
      requestReview: vi.fn(),
      latestOperationFor: () => undefined,
    };
    const assignedTask: ReviewTask = {
      ...task,
      assignmentEvidence: "explicit_project",
      assignmentSourceFresh: true,
    };
    await act(async () =>
      root.render(
        <WorkspaceInspectorHarness
          initial={workspaceWithHistoricalAndCurrentLinks()}
          reviewController={createReviewController()}
          mutations={[]}
          actions={actions}
          taskValue={assignedTask}
          projectValue={{ ...project, tasks: [assignedTask] }}
        />,
      ),
    );
    await click(buttonNamed(container, "Send follow-up"));
    await click(buttonNamed(container, "Insert current plan context"));
    const value = controlLabelled<HTMLTextAreaElement>(
      container,
      "Follow-up instruction",
    ).value;
    expect(value).toContain("Work item: Continue future revisions");
    expect(value).not.toContain("Work item: Review the completed slice");
  });

  it("explains an oversized saved context without blocking a shorter manual instruction", async () => {
    const actions: CodexActionsController = {
      operations: [],
      available: true,
      error: null,
      submitFollowUp: vi.fn(),
      requestReview: vi.fn(),
      latestOperationFor: () => undefined,
    };
    const assignedTask: ReviewTask = {
      ...task,
      assignmentEvidence: "explicit_project",
      assignmentSourceFresh: true,
    };
    const oversizedWorkspace: CofficeWorkspace = {
      ...workspaceFixture(true),
      projectDecisionEvents: Array.from({ length: 3 }, (_, index) => ({
        id: `large-decision-${index}`,
        projectId: project.id,
        action: "recorded" as const,
        statement: "s".repeat(1_000),
        context: "c".repeat(2_000),
        authorship: "user" as const,
        recordedAt: NOW,
      })),
    };
    await act(async () =>
      root.render(
        <WorkspaceInspectorHarness
          initial={oversizedWorkspace}
          reviewController={createReviewController()}
          mutations={[]}
          actions={actions}
          taskValue={assignedTask}
          projectValue={{ ...project, tasks: [assignedTask] }}
        />,
      ),
    );
    await click(buttonNamed(container, "Send follow-up"));
    const insert = buttonNamed(container, "Insert current plan context");
    expect(insert.disabled).toBe(true);
    expect(
      document.getElementById(insert.getAttribute("aria-describedby")!)
        ?.textContent,
    ).toContain("cannot fit in one Codex follow-up");
    expect(container.textContent).toContain(
      "You can still write a shorter instruction manually",
    );

    await enterText(
      controlLabelled<HTMLTextAreaElement>(container, "Follow-up instruction"),
      "Use this shorter instruction.",
    );
    expect(buttonNamed(container, "Review before sending").disabled).toBe(
      false,
    );
  });

  it.each([
    {
      name: "project mismatch",
      taskValue: {
        ...task,
        assignmentEvidence: "explicit_project" as const,
        assignmentSourceFresh: true,
      },
      projectValue: {
        ...project,
        id: "project-b",
        name: "Project B",
        tasks: [task],
      },
      initial: workspaceFixture(true),
      recoveryLocked: false,
      helper: "does not match this task's explicit Codex project",
    },
    {
      name: "stale assignment source",
      taskValue: {
        ...task,
        assignmentEvidence: "explicit_project" as const,
        assignmentSourceFresh: false,
      },
      projectValue: project,
      initial: workspaceFixture(true),
      recoveryLocked: false,
      helper: "Refresh Codex project metadata",
    },
    {
      name: "folder-based assignment",
      taskValue: {
        ...task,
        assignmentEvidence: "cwd_fallback" as const,
        assignmentSourceFresh: true,
      },
      projectValue: project,
      initial: workspaceFixture(true),
      recoveryLocked: false,
      helper: "An explicit Codex project assignment is required",
    },
    {
      name: "unacknowledged recovery",
      taskValue: {
        ...task,
        assignmentEvidence: "explicit_project" as const,
        assignmentSourceFresh: true,
      },
      projectValue: project,
      initial: workspaceFixture(true),
      recoveryLocked: true,
      helper: "Review and acknowledge the recovered workspace",
    },
    {
      name: "duplicate current links",
      taskValue: {
        ...task,
        assignmentEvidence: "explicit_project" as const,
        assignmentSourceFresh: true,
      },
      projectValue: project,
      initial: {
        ...workspaceFixture(true),
        projects: workspaceFixture(true).projects.map((savedProject) => ({
          ...savedProject,
          objectives: savedProject.objectives.map((objective) => ({
            ...objective,
            workItems: [
              ...objective.workItems,
              {
                id: "work-duplicate",
                title: "Duplicate current work",
                expectedOutcome: "The duplicate link is resolved.",
                status: "in_progress" as const,
                createdAt: NOW,
                updatedAt: NOW,
                attempts: [
                  {
                    id: "attempt-duplicate",
                    codexTaskId: task.id,
                    relationship: "continuation" as const,
                    linkedAt: NOW,
                    resultCycles: [],
                  },
                ],
              },
            ],
          })),
        })),
      },
      recoveryLocked: false,
      helper: "more than one current plan link",
    },
  ])(
    "blocks plan insertion for $name while preserving manual follow-up",
    async ({
      name,
      taskValue,
      projectValue,
      initial,
      recoveryLocked,
      helper,
    }) => {
      const mutations: WorkspaceMutation[] = [];
      const submitFollowUp = vi.fn();
      const actions: CodexActionsController = {
        operations: [],
        available: true,
        error: null,
        submitFollowUp,
        requestReview: vi.fn(),
        latestOperationFor: () => undefined,
      };
      await act(async () =>
        root.render(
          <WorkspaceInspectorHarness
            key={name}
            initial={initial}
            reviewController={createReviewController()}
            mutations={mutations}
            actions={actions}
            taskValue={taskValue}
            projectValue={{ ...projectValue, tasks: [taskValue] }}
            recoveryLocked={recoveryLocked}
          />,
        ),
      );

      await click(buttonNamed(container, "Send follow-up"));
      const insert = buttonNamed(container, "Insert current plan context");
      expect(insert.disabled).toBe(true);
      expect(
        document.getElementById(insert.getAttribute("aria-describedby")!)
          ?.textContent,
      ).toContain(helper);
      await enterText(
        controlLabelled<HTMLTextAreaElement>(
          container,
          "Follow-up instruction",
        ),
        "Proceed with a shorter manual instruction.",
      );
      await click(buttonNamed(container, "Review before sending"));
      expect(
        container.querySelector('[aria-label="Confirm Codex action"]'),
      ).not.toBeNull();
      expect(mutations).toEqual([]);
      expect(submitFollowUp).not.toHaveBeenCalled();
    },
  );

  it("prepares, edits, navigates, and exactly confirms one safe failed-check repair follow-up", async () => {
    const mutations: WorkspaceMutation[] = [];
    const submitFollowUp = vi.fn(async (): Promise<CodexOperation> => ({
      id: "repair-operation",
      kind: "send_follow_up",
      taskId: task.id,
      state: "queued",
      createdAt: NOW,
      updatedAt: NOW,
    }));
    const run = vi.fn();
    const cancel = vi.fn();
    const failed = verificationReceipt("failed");
    const durable = {
      ...workspaceWithVerificationReceipt(failed),
      projectDecisionEvents: [
        {
          id: "private-decision-id",
          projectId: project.id,
          action: "recorded" as const,
          statement: "Keep the repair narrowly scoped.",
          authorship: "user" as const,
          recordedAt: NOW,
        },
      ],
      evidence: [
        {
          id: "private-evidence-id",
          kind: "verification" as const,
          outcome: "failed" as const,
          summary: "SECRET OUTPUT LOG PATH COMMAND",
          recordedAt: NOW,
          projectId: project.id,
          provenance: { source: "coffice" as const },
        },
      ],
    };
    const verifications = verificationController({
      receipts: [failed],
      run,
      cancel,
    });

    await act(async () =>
      root.render(
        <WorkspaceInspectorHarness
          initial={durable}
          reviewController={createReviewController()}
          mutations={mutations}
          actions={repairActions(submitFollowUp)}
          verifications={verifications}
          taskValue={assignedRepairTask}
          projectValue={{ ...project, tasks: [assignedRepairTask] }}
        />,
      ),
    );
    expect(
      container.querySelector('[data-repair-follow-up-insert="true"]'),
    ).toBeNull();

    await click(buttonNamed(container, "Send follow-up"));
    const insert = buttonNamed(container, "Prepare repair follow-up");
    expect(insert.disabled).toBe(false);
    await click(insert);
    const textarea = controlLabelled<HTMLTextAreaElement>(
      container,
      "Follow-up instruction",
    );
    const original = textarea.value;
    expect(original).toContain("Coffice repair follow-up copied for review");
    expect(original).toContain("Objective: Ship the useful review workflow");
    expect(original).toContain("Work item: Review the completed slice");
    expect(original).toContain("Keep the repair narrowly scoped.");
    expect(original).toContain("Failed quality check: Tests");
    expect(original).toContain("Observed outcome: Failed · exit 1");
    expect(original).toContain("diagnose and repair");
    expect(original).not.toMatch(
      /task-a|project-a|objective-a|work-a|attempt-a|receipt-failed|2026-|SECRET|OUTPUT|LOG|PATH|COMMAND/u,
    );
    expect(document.activeElement).toBe(textarea);
    expect(textarea.selectionStart).toBe(original.length);
    expect(textarea.selectionEnd).toBe(original.length);
    expect(container.textContent).toContain(
      "Prepared from the current failed quality check",
    );
    expect(mutations).toEqual([]);
    expect(run).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
    expect(submitFollowUp).not.toHaveBeenCalled();

    expect(insert.disabled).toBe(true);
    await click(insert);
    expect(textarea.value).toBe(original);
    const edited = `${original}\n\nKeep this user edit.`;
    await enterText(textarea, edited);
    await click(buttonNamed(container, "Review before sending"));
    expect(document.activeElement).toBe(buttonNamed(container, "Back"));
    await click(buttonNamed(container, "Back"));
    await nextAnimationFrame();
    const restoredTextarea = controlLabelled<HTMLTextAreaElement>(
      container,
      "Follow-up instruction",
    );
    expect(document.activeElement).toBe(restoredTextarea);
    expect(restoredTextarea.value).toBe(edited);
    await click(buttonNamed(container, "Review before sending"));
    await act(async () =>
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })),
    );
    await nextAnimationFrame();
    const escapedTextarea = controlLabelled<HTMLTextAreaElement>(
      container,
      "Follow-up instruction",
    );
    expect(document.activeElement).toBe(escapedTextarea);
    expect(escapedTextarea.value).toBe(edited);
    await click(buttonNamed(container, "Cancel"));
    await nextAnimationFrame();
    expect(document.activeElement).toBe(
      buttonNamed(container, "Send follow-up"),
    );

    await click(buttonNamed(container, "Send follow-up"));
    await click(buttonNamed(container, "Prepare repair follow-up"));
    const exact = controlLabelled<HTMLTextAreaElement>(
      container,
      "Follow-up instruction",
    ).value;
    await click(buttonNamed(container, "Review before sending"));
    expect(container.textContent).toContain(
      "Coffice has not repaired or rerun anything and does not store the instruction",
    );
    await click(buttonNamed(container, "Confirm & send"));
    expect(submitFollowUp).toHaveBeenCalledOnce();
    expect(submitFollowUp).toHaveBeenCalledWith(task.id, exact);
    expect(mutations).toEqual([]);
    expect(run).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
  });

  it.each(["missing", "later pass"])(
    "hides routine repair insertion for $state receipt evidence",
    async (state) => {
      const live = state === "missing" ? [] : [verificationReceipt("passed")];
      const durable =
        state === "missing"
          ? workspaceFixture(true)
          : workspaceWithVerificationReceipt(verificationReceipt("passed"));
      await act(async () =>
        root.render(
          <WorkspaceInspectorHarness
            initial={durable}
            reviewController={createReviewController()}
            mutations={[]}
            actions={repairActions()}
            verifications={verificationController({ receipts: live })}
            taskValue={assignedRepairTask}
            projectValue={{ ...project, tasks: [assignedRepairTask] }}
          />,
        ),
      );
      await click(buttonNamed(container, "Send follow-up"));
      expect(
        container.querySelector('[data-repair-follow-up-insert="true"]'),
      ).toBeNull();
    },
  );

  it("shows an oversized valid repair candidate as disabled while preserving manual compose", async () => {
    const failed = verificationReceipt("failed");
    const durable = {
      ...workspaceWithVerificationReceipt(failed),
      projectDecisionEvents: Array.from({ length: 3 }, (_, index) => ({
        id: `repair-large-decision-${index}`,
        projectId: project.id,
        action: "recorded" as const,
        statement: "s".repeat(1_000),
        context: "c".repeat(2_000),
        authorship: "user" as const,
        recordedAt: NOW,
      })),
    };
    await act(async () =>
      root.render(
        <WorkspaceInspectorHarness
          initial={durable}
          reviewController={createReviewController()}
          mutations={[]}
          actions={repairActions()}
          verifications={verificationController({ receipts: [failed] })}
          taskValue={assignedRepairTask}
          projectValue={{ ...project, tasks: [assignedRepairTask] }}
        />,
      ),
    );
    await click(buttonNamed(container, "Send follow-up"));
    const insert = buttonNamed(container, "Prepare repair follow-up");
    expect(insert.disabled).toBe(true);
    expect(
      document.getElementById(insert.getAttribute("aria-describedby")!)
        ?.textContent,
    ).toContain("cannot fit in one Codex follow-up");
    expect(container.textContent).toContain(
      "You can still write a shorter instruction manually",
    );
    await enterText(
      controlLabelled<HTMLTextAreaElement>(container, "Follow-up instruction"),
      "Use a shorter manual repair request.",
    );
    expect(buttonNamed(container, "Review before sending").disabled).toBe(
      false,
    );
  });

  it("invalidates result, link, plan, and decision changes in compose while preserving ordinary draft text", async () => {
    const failed = verificationReceipt("failed");
    const original = workspaceWithVerificationReceipt(failed);
    const scenarios = [
      {
        name: "plan",
        replacement: {
          ...original,
          projects: original.projects.map((savedProject) => ({
            ...savedProject,
            objectives: savedProject.objectives.map((objective) => ({
              ...objective,
              title: "A newly revised objective",
            })),
          })),
        },
        live: failed,
      },
      {
        name: "decision",
        replacement: {
          ...original,
          projectDecisionEvents: [
            {
              id: "new-decision-id",
              projectId: project.id,
              action: "recorded" as const,
              statement: "Use the newly agreed repair boundary.",
              authorship: "user" as const,
              recordedAt: NOW,
            },
          ],
        },
        live: failed,
      },
      (() => {
        const target = { ...verificationTarget, attemptId: "attempt-new" };
        const live = receiptWithTarget(target, { id: "receipt-link-new" });
        const source = workspaceFixture(true);
        const replacement = workspaceWithVerificationReceipt(live, {
          ...source,
          projects: source.projects.map((savedProject) => ({
            ...savedProject,
            objectives: savedProject.objectives.map((objective) => ({
              ...objective,
              workItems: objective.workItems.map((workItem) => ({
                ...workItem,
                attempts: workItem.attempts.map((attempt) => ({
                  ...attempt,
                  id: "attempt-new",
                })),
              })),
            })),
          })),
        });
        return { name: "link", replacement, live };
      })(),
      (() => {
        const target = {
          ...verificationTarget,
          resultKey: { kind: "revision" as const, id: "new-result-key" },
        };
        const live = receiptWithTarget(target, { id: "receipt-result-new" });
        const source = workspaceFixture(true);
        const replacement = workspaceWithVerificationReceipt(live, {
          ...source,
          projects: source.projects.map((savedProject) => ({
            ...savedProject,
            objectives: savedProject.objectives.map((objective) => ({
              ...objective,
              workItems: objective.workItems.map((workItem) => ({
                ...workItem,
                attempts: workItem.attempts.map((attempt) => ({
                  ...attempt,
                  resultCycles: [
                    ...attempt.resultCycles,
                    { key: target.resultKey, observedAt: NOW },
                  ],
                })),
              })),
            })),
          })),
        });
        return { name: "result", replacement, live };
      })(),
    ];

    for (const scenario of scenarios) {
      const submitFollowUp = vi.fn();
      await act(async () =>
        root.render(
          <WorkspaceInspectorHarness
            key={scenario.name}
            initial={original}
            reviewController={createReviewController()}
            mutations={[]}
            actions={repairActions(submitFollowUp)}
            verifications={verificationController({ receipts: [failed] })}
            taskValue={assignedRepairTask}
            projectValue={{ ...project, tasks: [assignedRepairTask] }}
          />,
        ),
      );
      await click(buttonNamed(container, "Send follow-up"));
      await click(buttonNamed(container, "Prepare repair follow-up"));
      const draft = controlLabelled<HTMLTextAreaElement>(
        container,
        "Follow-up instruction",
      ).value;

      await act(async () =>
        root.render(
          <WorkspaceInspectorHarness
            key={scenario.name}
            initial={original}
            replacement={scenario.replacement}
            reviewController={createReviewController()}
            mutations={[]}
            actions={repairActions(submitFollowUp)}
            verifications={verificationController({
              receipts: [scenario.live],
            })}
            taskValue={assignedRepairTask}
            projectValue={{ ...project, tasks: [assignedRepairTask] }}
          />,
        ),
      );
      await click(buttonNamed(container, "Review before sending"));
      const preserved = controlLabelled<HTMLTextAreaElement>(
        container,
        "Follow-up instruction",
      );
      expect(preserved.value, scenario.name).toBe(draft);
      expect(document.activeElement, scenario.name).toBe(preserved);
      expect(container.textContent, scenario.name).toContain(
        "Your draft was preserved as ordinary text",
      );
      expect(submitFollowUp, scenario.name).not.toHaveBeenCalled();
    }
  });

  it("invalidates a newer live failed receipt at confirmation and preserves the exact draft", async () => {
    const failed = verificationReceipt("failed");
    const submitFollowUp = vi.fn();
    const durable = workspaceWithVerificationReceipt(failed);
    const render = async (live: VerificationReceiptView) =>
      await act(async () =>
        root.render(
          <WorkspaceInspectorHarness
            initial={durable}
            reviewController={createReviewController()}
            mutations={[]}
            actions={repairActions(submitFollowUp)}
            verifications={verificationController({ receipts: [live] })}
            taskValue={assignedRepairTask}
            projectValue={{ ...project, tasks: [assignedRepairTask] }}
          />,
        ),
      );

    await render(failed);
    await click(buttonNamed(container, "Send follow-up"));
    await click(buttonNamed(container, "Prepare repair follow-up"));
    const draft = controlLabelled<HTMLTextAreaElement>(
      container,
      "Follow-up instruction",
    ).value;
    await click(buttonNamed(container, "Review before sending"));
    const newer = receiptWithTarget(verificationTarget, {
      id: "newer-live-failure",
      exitCode: -2,
    });
    await render(newer);
    const preserved = controlLabelled<HTMLTextAreaElement>(
      container,
      "Follow-up instruction",
    );
    expect(preserved.value).toBe(draft);
    expect(document.activeElement).toBe(preserved);
    expect(container.textContent).toContain(
      "Your draft was preserved as ordinary text",
    );
    expect(submitFollowUp).not.toHaveBeenCalled();
  });

  it.each([
    { name: "unavailable persistence", workspacePersistent: false },
    { name: "recovery lock", recoveryLocked: true },
    { name: "stale assignment", assignmentSourceFresh: false },
    { name: "degraded receipts", degraded: true },
  ])(
    "invalidates repair binding after $name without dispatch",
    async ({
      name,
      workspacePersistent = true,
      recoveryLocked = false,
      assignmentSourceFresh = true,
      degraded = false,
    }) => {
      const failed = verificationReceipt("failed");
      const durable = workspaceWithVerificationReceipt(failed);
      const submitFollowUp = vi.fn();
      const render = async (changed: boolean) =>
        await act(async () =>
          root.render(
            <WorkspaceInspectorHarness
              initial={durable}
              reviewController={createReviewController()}
              mutations={[]}
              actions={repairActions(submitFollowUp)}
              verifications={verificationController({
                receipts: [failed],
                degraded: changed && degraded,
              })}
              taskValue={{
                ...assignedRepairTask,
                assignmentSourceFresh: changed ? assignmentSourceFresh : true,
              }}
              projectValue={{ ...project, tasks: [assignedRepairTask] }}
              workspacePersistent={changed ? workspacePersistent : true}
              recoveryLocked={changed && recoveryLocked}
            />,
          ),
        );

      await render(false);
      await click(buttonNamed(container, "Send follow-up"));
      await click(buttonNamed(container, "Prepare repair follow-up"));
      const draft = controlLabelled<HTMLTextAreaElement>(
        container,
        "Follow-up instruction",
      ).value;
      await render(true);
      await click(buttonNamed(container, "Review before sending"));
      expect(
        controlLabelled<HTMLTextAreaElement>(container, "Follow-up instruction")
          .value,
        name,
      ).toBe(draft);
      expect(container.textContent, name).toContain(
        "Your draft was preserved as ordinary text",
      );
      expect(submitFollowUp, name).not.toHaveBeenCalled();
    },
  );

  it("preserves a confirmed repair draft while Codex actions are unavailable", async () => {
    const failed = verificationReceipt("failed");
    const durable = workspaceWithVerificationReceipt(failed);
    const submitFollowUp = vi.fn();
    const available = repairActions(submitFollowUp);
    const render = async (actions: CodexActionsController) =>
      await act(async () =>
        root.render(
          <WorkspaceInspectorHarness
            initial={durable}
            reviewController={createReviewController()}
            mutations={[]}
            actions={actions}
            verifications={verificationController({ receipts: [failed] })}
            taskValue={assignedRepairTask}
            projectValue={{ ...project, tasks: [assignedRepairTask] }}
          />,
        ),
      );
    await render(available);
    await click(buttonNamed(container, "Send follow-up"));
    await click(buttonNamed(container, "Prepare repair follow-up"));
    const draft = controlLabelled<HTMLTextAreaElement>(
      container,
      "Follow-up instruction",
    ).value;
    await click(buttonNamed(container, "Review before sending"));
    await render({
      ...available,
      available: false,
      error: "Codex actions are temporarily unavailable.",
    });
    expect(
      container.querySelector<HTMLElement>('[data-follow-up-preview="true"]')
        ?.textContent,
    ).toBe(draft);
    expect(buttonNamed(container, "Confirm & send").disabled).toBe(true);
    expect(submitFollowUp).not.toHaveBeenCalled();
  });

  it("replaces repair provenance with plan-only provenance after the user clears and inserts plan context", async () => {
    const failed = verificationReceipt("failed");
    const durable = workspaceWithVerificationReceipt(failed);
    const submitFollowUp = vi.fn();
    const render = async (live: VerificationReceiptView) =>
      await act(async () =>
        root.render(
          <WorkspaceInspectorHarness
            initial={durable}
            reviewController={createReviewController()}
            mutations={[]}
            actions={repairActions(submitFollowUp)}
            verifications={verificationController({ receipts: [live] })}
            taskValue={assignedRepairTask}
            projectValue={{ ...project, tasks: [assignedRepairTask] }}
          />,
        ),
      );
    await render(failed);
    await click(buttonNamed(container, "Send follow-up"));
    await click(buttonNamed(container, "Prepare repair follow-up"));
    const textarea = controlLabelled<HTMLTextAreaElement>(
      container,
      "Follow-up instruction",
    );
    await enterText(textarea, "");
    await click(buttonNamed(container, "Insert current plan context"));
    const planDraft = textarea.value;
    expect(planDraft).toContain("Coffice plan context copied for review");
    expect(planDraft).not.toContain("Failed quality check");

    await render(
      receiptWithTarget(verificationTarget, {
        id: "newer-irrelevant-repair-receipt",
        exitCode: -3,
      }),
    );
    await click(buttonNamed(container, "Review before sending"));
    expect(
      container.querySelector<HTMLElement>('[data-follow-up-preview="true"]')
        ?.textContent,
    ).toBe(planDraft);
    expect(container.textContent).toContain(
      "Coffice plan context was inserted into this draft",
    );
    expect(container.textContent).not.toContain(
      "plan and failed-check context were inserted",
    );
    expect(submitFollowUp).not.toHaveBeenCalled();
  });

  it("preserves an exact reviewed plan-assisted draft when actions become unavailable", async () => {
    const submitFollowUp = vi.fn();
    const availableActions: CodexActionsController = {
      operations: [],
      available: true,
      error: null,
      submitFollowUp,
      requestReview: vi.fn(),
      latestOperationFor: () => undefined,
    };
    const unavailableActions: CodexActionsController = {
      ...availableActions,
      available: false,
      error: "Codex actions are temporarily unavailable.",
    };
    const assignedTask: ReviewTask = {
      ...task,
      assignmentEvidence: "explicit_project",
      assignmentSourceFresh: true,
    };
    const render = async (actions: CodexActionsController) =>
      await act(async () =>
        root.render(
          <WorkspaceInspectorHarness
            initial={workspaceFixture(true)}
            reviewController={createReviewController()}
            mutations={[]}
            actions={actions}
            taskValue={assignedTask}
            projectValue={{ ...project, tasks: [assignedTask] }}
          />,
        ),
      );

    await render(availableActions);
    await click(buttonNamed(container, "Send follow-up"));
    await click(buttonNamed(container, "Insert current plan context"));
    const textarea = controlLabelled<HTMLTextAreaElement>(
      container,
      "Follow-up instruction",
    );
    const exactDraft = `${textarea.value}\n\nKeep this edit.`;
    await enterText(textarea, exactDraft);
    await click(buttonNamed(container, "Review before sending"));

    await render(unavailableActions);
    expect(
      container.querySelector<HTMLElement>('[data-follow-up-preview="true"]')
        ?.textContent,
    ).toBe(exactDraft);
    expect(buttonNamed(container, "Confirm & send").disabled).toBe(true);
    await click(buttonNamed(container, "Confirm & send"));
    expect(submitFollowUp).not.toHaveBeenCalled();
    await click(buttonNamed(container, "Back"));
    expect(
      controlLabelled<HTMLTextAreaElement>(container, "Follow-up instruction")
        .value,
    ).toBe(exactDraft);

    await render(availableActions);
    await click(buttonNamed(container, "Review before sending"));
    expect(buttonNamed(container, "Confirm & send").disabled).toBe(false);
    expect(submitFollowUp).not.toHaveBeenCalled();
  });

  it("cancels an open follow-up with Escape, clears it, and restores Send focus", async () => {
    const actions: CodexActionsController = {
      operations: [],
      available: true,
      error: null,
      submitFollowUp: vi.fn(),
      requestReview: vi.fn(),
      latestOperationFor: () => undefined,
    };
    await act(async () =>
      root.render(
        <WorkspaceInspectorHarness
          initial={workspaceFixture(true)}
          reviewController={createReviewController()}
          mutations={[]}
          actions={actions}
        />,
      ),
    );
    await click(buttonNamed(container, "Send follow-up"));
    await enterText(
      controlLabelled<HTMLTextAreaElement>(container, "Follow-up instruction"),
      "Do not keep this draft",
    );
    await act(async () =>
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })),
    );
    await nextAnimationFrame();
    expect(document.activeElement).toBe(
      buttonNamed(container, "Send follow-up"),
    );
    await click(buttonNamed(container, "Send follow-up"));
    expect(
      controlLabelled<HTMLTextAreaElement>(container, "Follow-up instruction")
        .value,
    ).toBe("");
  });

  it("enables Codex actions only for safe settled tasks with no active operation", async () => {
    const running: CodexOperation = {
      id: "operation-running",
      kind: "send_follow_up",
      taskId: task.id,
      state: "running",
      createdAt: NOW,
      updatedAt: NOW,
      turnId: "turn-running",
    };
    const actions: CodexActionsController = {
      operations: [],
      available: true,
      error: null,
      submitFollowUp: vi.fn(),
      requestReview: vi.fn(),
      archiveTask: vi.fn(),
      latestOperationFor: () => undefined,
    };
    const blockedTask: ReviewTask = {
      ...task,
      status: { ...task.status, value: "blocked" },
    };

    await act(async () =>
      root.render(
        <WorkspaceInspectorHarness
          initial={workspaceFixture(true)}
          reviewController={createReviewController()}
          mutations={[]}
          actions={actions}
          taskValue={blockedTask}
          projectValue={{ ...project, tasks: [blockedTask] }}
        />,
      ),
    );
    expect(buttonNamed(container, "Send follow-up").disabled).toBe(true);
    expect(container.textContent).toContain("not in a safe settled state");

    await act(async () =>
      root.render(
        <WorkspaceInspectorHarness
          initial={workspaceFixture(true)}
          reviewController={createReviewController()}
          mutations={[]}
          actions={{
            ...actions,
            operations: [running],
            latestOperationFor: () => running,
          }}
        />,
      ),
    );
    expect(buttonNamed(container, "Send follow-up").disabled).toBe(true);
    expect(container.textContent).toContain("already tracking a Codex action");

    const idleTask: ReviewTask = {
      ...task,
      status: { ...task.status, value: "idle" },
    };
    await act(async () =>
      root.render(
        <WorkspaceInspectorHarness
          initial={workspaceFixture(true)}
          reviewController={createReviewController()}
          mutations={[]}
          actions={actions}
          taskValue={idleTask}
          projectValue={{ ...project, tasks: [idleTask] }}
        />,
      ),
    );
    expect(
      [...container.querySelectorAll("button")].some(
        (button) => normalized(button.textContent) === "Archive task",
      ),
    ).toBe(false);
  });

  it("describes an App Server input wait without inventing a decision", async () => {
    const waiting: CodexOperation = {
      id: "operation-needs-input",
      kind: "send_follow_up",
      taskId: task.id,
      state: "failed",
      errorCode: "USER_ACTION_REQUIRED",
      createdAt: NOW,
      updatedAt: NOW,
    };
    const actions: CodexActionsController = {
      operations: [waiting],
      available: true,
      error: null,
      submitFollowUp: vi.fn(),
      requestReview: vi.fn(),
      latestOperationFor: () => waiting,
    };

    await act(async () =>
      root.render(
        <WorkspaceInspectorHarness
          initial={workspaceFixture(true)}
          reviewController={createReviewController()}
          mutations={[]}
          actions={actions}
        />,
      ),
    );

    expect(container.textContent).toContain(
      "Codex needs your input, which Coffice cannot safely provide.",
    );
    expect(container.textContent).not.toContain("needs a decision");
  });

  it("revalidates action safety before the confirmation is submitted", async () => {
    const requestReview = vi.fn();
    const actions: CodexActionsController = {
      operations: [],
      available: true,
      error: null,
      submitFollowUp: vi.fn(),
      requestReview,
      latestOperationFor: () => undefined,
    };
    const render = async (taskValue: ReviewTask) =>
      await act(async () =>
        root.render(
          <WorkspaceInspectorHarness
            initial={workspaceFixture(true)}
            reviewController={createReviewController()}
            mutations={[]}
            actions={actions}
            taskValue={taskValue}
            projectValue={{ ...project, tasks: [taskValue] }}
          />,
        ),
      );

    await render(task);
    await click(buttonNamed(container, "Request review"));
    const activeTask: ReviewTask = {
      ...task,
      status: { ...task.status, value: "active" },
    };
    await render(activeTask);

    const confirm = buttonNamed(container, "Confirm review");
    expect(confirm.disabled).toBe(true);
    await click(confirm);
    expect(requestReview).not.toHaveBeenCalled();
  });

  it("shows exact profile details before it sends a quality-check request", async () => {
    const passed = verificationReceipt("passed");
    const run = vi.fn(async () => ({
      ok: true as const,
      receipt: passed,
      replayed: false,
    }));
    await act(async () =>
      root.render(
        <WorkspaceInspectorHarness
          initial={workspaceFixture(true)}
          reviewController={createReviewController()}
          mutations={[]}
          verifications={verificationController({ run })}
        />,
      ),
    );

    expect(container.textContent).toContain("Quality checks");
    expect(container.textContent).toContain("Review the completed slice");
    expect(container.textContent).toContain("Result observed");
    await click(buttonNamed(container, "Review check details"));
    await nextAnimationFrame();
    expect(run).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(
      buttonNamed(container, "Confirm and run"),
    );
    expect(container.textContent).toContain("Run the project test suite.");
    expect(container.textContent).toContain("network access off");
    expect(container.textContent).toContain("Output is not stored");
    expect(container.textContent).toContain("not Codex approval");

    await click(buttonNamed(container, "Confirm and run"));
    expect(run).toHaveBeenCalledWith(verificationTarget, {
      id: "test",
      version: "1",
    });
    expect(buttonNamed(container, "Accept result")).not.toBeNull();
  });

  it("does not offer checks for unlinked work or a project holding area", async () => {
    const render = async (projectValue: ReviewProject) =>
      await act(async () =>
        root.render(
          <WorkspaceInspectorHarness
            initial={workspaceFixture(false)}
            reviewController={createReviewController()}
            mutations={[]}
            verifications={verificationController()}
            projectValue={projectValue}
          />,
        ),
      );

    await render(project);
    expect(container.textContent).not.toContain("Quality checks");
    expect(container.textContent).toContain("Link this Codex attempt");

    await render({ ...project, holding: true });
    expect(container.textContent).not.toContain("Quality checks");
    expect(container.textContent).toContain(
      "Assign this task to a Codex project",
    );
    expect(buttonNamed(container, "Track this work").disabled).toBe(true);
  });

  it("does not guess an attempt when the same task is linked more than once", async () => {
    const linked = workspaceFixture(true);
    const firstAttempt =
      linked.projects[0].objectives[0].workItems[0].attempts[0];
    const ambiguous: CofficeWorkspace = {
      ...linked,
      projects: [
        {
          ...linked.projects[0],
          objectives: [
            {
              ...linked.projects[0].objectives[0],
              workItems: [
                {
                  ...linked.projects[0].objectives[0].workItems[0],
                  attempts: [
                    firstAttempt,
                    { ...firstAttempt, id: "attempt-duplicate" },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const run = vi.fn();
    await act(async () =>
      root.render(
        <WorkspaceInspectorHarness
          initial={ambiguous}
          reviewController={createReviewController()}
          mutations={[]}
          verifications={verificationController({
            run: run as VerificationsController["run"],
          })}
        />,
      ),
    );

    expect(container.textContent).not.toContain("Quality checks");
    expect(container.textContent).toContain(
      "linked to more than one saved attempt",
    );
    expect(buttonNamed(container, "Track this work").disabled).toBe(true);
    expect(run).not.toHaveBeenCalled();
  });

  it("keeps unavailable and degraded verification states honest and non-actionable", async () => {
    const render = async (verifications: VerificationsController) =>
      await act(async () =>
        root.render(
          <WorkspaceInspectorHarness
            initial={workspaceFixture(true)}
            reviewController={createReviewController()}
            mutations={[]}
            verifications={verifications}
          />,
        ),
      );

    await render(
      verificationController({ available: false, profileEligible: false }),
    );
    expect(container.textContent).toContain(
      "Quality checks are unavailable for this saved project.",
    );

    const run = vi.fn(async () => ({
      ok: false as const,
      reason: "unavailable" as const,
    }));
    await render(verificationController({ degraded: true, run }));
    expect(container.textContent).toContain(
      "Live receipt updates are temporarily unavailable.",
    );
    expect(buttonNamed(container, "Review check details").disabled).toBe(true);
    await click(buttonNamed(container, "Review check details"));
    expect(run).not.toHaveBeenCalled();
  });

  it("never presents a fresh cross-project link mismatch as unlinked and confirms an exact move", async () => {
    const withDestination = reduceCofficeWorkspace(
      workspaceFixture(true),
      {
        type: "project.upsert",
        project: {
          id: "project-b",
          title: "Project B",
          createdAt: NOW,
          updatedAt: NOW,
          objectives: [
            {
              id: "objective-b",
              title: "Continue the useful workflow",
              status: "active",
              createdAt: NOW,
              updatedAt: NOW,
              workItems: [
                {
                  id: "work-b",
                  title: "Review future revisions",
                  expectedOutcome: "A later revision is reviewed in Project B.",
                  status: "in_progress",
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
    const mutations: WorkspaceMutation[] = [];
    const run = vi.fn().mockResolvedValue({
      ok: true,
      receipt: verificationReceipt("passed"),
      replayed: false,
    });
    let latestWorkspace = withDestination;
    const taskB: ReviewTask = {
      ...task,
      assignmentEvidence: "explicit_project",
    };
    const projectB: ReviewProject = {
      ...project,
      id: "project-b",
      name: "Project B",
      tasks: [taskB],
    };
    await act(async () =>
      root.render(
        <WorkspaceInspectorHarness
          initial={withDestination}
          reviewController={createReviewController()}
          mutations={mutations}
          verifications={verificationController({ run })}
          taskValue={taskB}
          projectValue={projectB}
          onWorkspace={(value) => {
            latestWorkspace = value;
          }}
        />,
      ),
    );

    expect(container.textContent).toContain(
      "Codex now assigns this task to Project B",
    );
    expect(container.textContent).not.toContain("Link this Codex attempt");
    await click(buttonNamed(container, "Mark reviewed"));
    await click(buttonNamed(container, "Accept result"));
    await click(buttonNamed(container, "Confirm decision"));
    expect(mutations.slice(0, 2)).toMatchObject([
      {
        type: "result.review",
        projectId: "project-a",
        objectiveId: "objective-a",
        workItemId: "work-a",
        attemptId: "attempt-a",
      },
      {
        type: "result.decide",
        projectId: "project-a",
        objectiveId: "objective-a",
        workItemId: "work-a",
        attemptId: "attempt-a",
        evidence: { projectId: "project-a" },
      },
    ]);
    await click(buttonNamed(container, "Review check details"));
    await click(buttonNamed(container, "Confirm and run"));
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-a",
        objectiveId: "objective-a",
        workItemId: "work-a",
        attemptId: "attempt-a",
      }),
      expect.any(Object),
    );
    await click(buttonNamed(container, "Move plan link"));
    expect(container.textContent).toContain("Destination work item");
    await act(async () =>
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })),
    );
    expect(container.textContent).not.toContain("Destination work item");

    await click(buttonNamed(container, "Move plan link"));
    await click(buttonNamed(container, "Continue"));
    expect(mutations).toHaveLength(2);
    expect(container.textContent).toContain(
      "Saved results, decisions, and quality-check receipts remain in their original history",
    );
    await click(buttonNamed(container, "Move link"));

    expect(mutations).toHaveLength(3);
    expect(mutations[2]).toMatchObject({
      type: "taskLink.move",
      codexTaskId: "task-a",
      from: {
        projectId: "project-a",
        objectiveId: "objective-a",
        workItemId: "work-a",
        attemptId: "attempt-a",
      },
      to: {
        projectId: "project-b",
        objectiveId: "objective-b",
        workItemId: "work-b",
      },
      baselineResultKey: { kind: "revision", id: item.eventKey },
    });
    const source = latestWorkspace.projects[0].objectives[0].workItems[0];
    const destination = latestWorkspace.projects[1].objectives[0].workItems[0];
    expect(source.attempts[0].unlinkedAt).toBeTruthy();
    expect(source.attempts[0].resultCycles).toHaveLength(1);
    expect(destination.attempts).toMatchObject([
      { relationship: "continuation", resultCycles: [] },
    ]);
    await nextAnimationFrame();
    expect(container.textContent).toContain("Plan link moved.");
    expect(document.activeElement?.textContent).toContain("Plan link moved.");
  });

  it("cancels an active check against the exact historical project after reassignment", async () => {
    const running = verificationReceipt("running");
    const cancel = vi.fn(async () => ({
      ok: true as const,
      receipt: running,
      replayed: false,
    }));
    const taskB: ReviewTask = {
      ...task,
      assignmentEvidence: "explicit_project",
    };
    await act(async () =>
      root.render(
        <WorkspaceInspectorHarness
          initial={workspaceFixture(true)}
          reviewController={createReviewController()}
          mutations={[]}
          verifications={verificationController({
            receipts: [running],
            cancel,
          })}
          taskValue={taskB}
          projectValue={{
            ...project,
            id: "project-b",
            name: "Project B",
            tasks: [taskB],
          }}
        />,
      ),
    );

    expect(container.textContent).toContain("Running");
    await click(buttonNamed(container, "Cancel"));
    await click(buttonNamed(container, "Confirm cancel"));
    expect(cancel).toHaveBeenCalledWith(running.id);
  });

  it("confirms an explicit-unassigned unlink and preserves source history", async () => {
    const mutations: WorkspaceMutation[] = [];
    let latestWorkspace = workspaceFixture(true);
    const unassignedTask: ReviewTask = {
      ...task,
      assignmentEvidence: "explicit_unassigned",
    };
    await act(async () =>
      root.render(
        <WorkspaceInspectorHarness
          initial={latestWorkspace}
          reviewController={createReviewController()}
          mutations={mutations}
          taskValue={unassignedTask}
          projectValue={{
            ...project,
            id: "__unassigned__",
            name: "Unassigned sessions",
            holding: true,
            tasks: [unassignedTask],
          }}
          onWorkspace={(value) => {
            latestWorkspace = value;
          }}
        />,
      ),
    );

    expect(container.textContent).toContain(
      "now reports this task as unassigned",
    );
    expect(container.textContent).not.toContain("Move plan link");
    await click(buttonNamed(container, "Unlink from plan"));
    expect(mutations).toHaveLength(0);
    expect(container.textContent).toContain(
      "This does not archive, delete, or move the Codex task.",
    );
    await click(buttonNamed(container, "Unlink task"));

    expect(mutations).toMatchObject([
      {
        type: "taskLink.unlink",
        codexTaskId: "task-a",
        from: { attemptId: "attempt-a" },
      },
    ]);
    const attempt =
      latestWorkspace.projects[0].objectives[0].workItems[0].attempts[0];
    expect(attempt.unlinkedAt).toBeTruthy();
    expect(attempt.resultCycles).toHaveLength(1);
    expect(container.textContent).toContain("History only");
  });

  it("allows old task status with a fresh assignment source and blocks stale-source or fallback assignment", async () => {
    const mutations: WorkspaceMutation[] = [];
    const render = async (taskValue: ReviewTask) =>
      await act(async () =>
        root.render(
          <WorkspaceInspectorHarness
            initial={workspaceFixture(true)}
            reviewController={createReviewController()}
            mutations={mutations}
            taskValue={taskValue}
            projectValue={{ ...project, tasks: [taskValue] }}
          />,
        ),
      );

    await render({
      ...task,
      assignmentEvidence: "explicit_project",
      assignmentSourceFresh: true,
      status: { ...task.status, stale: true },
    });
    expect(buttonNamed(container, "Change plan link").disabled).toBe(false);

    await render({
      ...task,
      assignmentEvidence: "explicit_project",
      assignmentSourceFresh: false,
      status: { ...task.status, stale: false },
    });
    expect(buttonNamed(container, "Change plan link").disabled).toBe(true);
    expect(container.textContent).toContain("assignment source is stale");

    await render({ ...task, assignmentEvidence: "cwd_fallback" });
    expect(buttonNamed(container, "Change plan link").disabled).toBe(true);
    expect(container.textContent).toContain("folder-based project guess");
    expect(mutations).toHaveLength(0);
  });

  it("blocks link changes while storage is unavailable or recovery review is pending", async () => {
    const explicitTask = {
      ...task,
      assignmentEvidence: "explicit_project" as const,
    };
    const render = async (options: {
      workspacePersistent?: boolean;
      recoveryLocked?: boolean;
    }) =>
      await act(async () =>
        root.render(
          <WorkspaceInspectorHarness
            initial={workspaceFixture(true)}
            reviewController={createReviewController()}
            mutations={[]}
            taskValue={explicitTask}
            projectValue={{ ...project, tasks: [explicitTask] }}
            {...options}
          />,
        ),
      );

    await render({ workspacePersistent: false });
    expect(buttonNamed(container, "Change plan link").disabled).toBe(true);
    expect(container.textContent).toContain("workspace is unavailable");

    await render({ recoveryLocked: true });
    expect(buttonNamed(container, "Change plan link").disabled).toBe(true);
    expect(container.textContent).toContain(
      "acknowledge the recovered workspace",
    );
  });

  it("blocks link changes during active exact-result verification or pending result storage", async () => {
    const target = {
      projectId: "project-a",
      objectiveId: "objective-a",
      workItemId: "work-a",
      attemptId: "attempt-a",
      resultKey: { kind: "revision" as const, id: item.eventKey },
    };
    const activeVerification = {
      ...workspaceFixture(true),
      verificationReceipts: [
        createVerificationReceipt(
          {
            id: "receipt-running",
            idempotencyKey: "receipt-running-key",
            target,
            profile: { id: "test", version: "1" },
            checks: [{ id: "test", version: "1" }],
          },
          "a".repeat(64),
          NOW,
        ),
      ],
    };
    const explicitTask = {
      ...task,
      assignmentEvidence: "explicit_project" as const,
    };
    const render = async (initial: CofficeWorkspace) =>
      await act(async () =>
        root.render(
          <WorkspaceInspectorHarness
            key={
              initial.verificationReceipts.length ? "verification" : "pending"
            }
            initial={initial}
            reviewController={createReviewController()}
            mutations={[]}
            taskValue={explicitTask}
            projectValue={{ ...project, tasks: [explicitTask] }}
          />,
        ),
      );

    await render(activeVerification);
    expect(buttonNamed(container, "Change plan link").disabled).toBe(true);
    expect(container.textContent).toContain("running quality check");

    const pending = workspaceFixture(true);
    pending.projects[0].objectives[0].workItems[0].attempts[0].resultCycles =
      [];
    await render(pending);
    expect(buttonNamed(container, "Change plan link").disabled).toBe(true);
    expect(container.textContent).toContain("current result is saved");
  });

  it("resumes tracking from the latest closed segment without moving its history", async () => {
    const mutations: WorkspaceMutation[] = [];
    let latestWorkspace = resumableWorkspace();
    const explicitTask = {
      ...task,
      assignmentEvidence: "explicit_project" as const,
    };
    await act(async () =>
      root.render(
        <WorkspaceInspectorHarness
          initial={latestWorkspace}
          reviewController={createReviewController()}
          mutations={mutations}
          taskValue={explicitTask}
          projectValue={{ ...project, tasks: [explicitTask] }}
          onWorkspace={(value) => {
            latestWorkspace = value;
          }}
        />,
      ),
    );

    expect(container.textContent).toContain("History only");
    await click(buttonNamed(container, "Resume tracking"));
    await click(buttonNamed(container, "Continue"));
    expect(container.textContent).toContain(
      "Resume in Project A / Continue future revisions",
    );
    expect(container.textContent).toContain("opens a new continuation link");
    await click(buttonNamed(container, "Resume link"));

    expect(mutations[0]).toMatchObject({
      type: "taskLink.move",
      from: { attemptId: "attempt-a" },
      to: { workItemId: "work-b" },
      baselineResultKey: { kind: "revision", id: item.eventKey },
    });
    const [source, destination] =
      latestWorkspace.projects[0].objectives[0].workItems;
    expect(source.attempts[0].resultCycles).toHaveLength(1);
    expect(destination.attempts).toMatchObject([
      { relationship: "continuation", resultCycles: [] },
    ]);
    expect(container.textContent).toContain("Tracking resumed");
  });

  it("refreshes after an unconfirmed move and never submits a duplicate retry", async () => {
    const mutations: WorkspaceMutation[] = [];
    const refresh = vi.fn();
    const explicitTask = {
      ...task,
      assignmentEvidence: "explicit_project" as const,
    };
    await act(async () =>
      root.render(
        <WorkspaceInspectorHarness
          initial={resumableWorkspace()}
          reviewController={createReviewController()}
          mutations={mutations}
          taskValue={explicitTask}
          projectValue={{ ...project, tasks: [explicitTask] }}
          mutateFailureReason="unavailable"
          onRefresh={refresh}
        />,
      ),
    );

    await click(buttonNamed(container, "Resume tracking"));
    await click(buttonNamed(container, "Continue"));
    await click(buttonNamed(container, "Resume link"));

    expect(mutations).toHaveLength(1);
    expect(refresh).toHaveBeenCalledOnce();
    expect(container.textContent).toContain(
      "could not confirm that plan-link change",
    );
    await act(async () => Promise.resolve());
    expect(mutations).toHaveLength(1);
  });

  it("cancels a pending confirmation when a newer result becomes current and keeps focus in the dialog", async () => {
    const controller = verificationController();
    const render = async (taskValue: ReviewTask) =>
      await act(async () =>
        root.render(
          <WorkspaceInspectorHarness
            initial={workspaceFixture(true)}
            reviewController={createReviewController()}
            mutations={[]}
            verifications={controller}
            taskValue={taskValue}
            projectValue={{ ...project, tasks: [taskValue] }}
          />,
        ),
      );

    await render(task);
    await click(buttonNamed(container, "Review check details"));
    expect(container.textContent).toContain("Confirm local quality check");

    const newerTask: ReviewTask = {
      ...task,
      status: { ...task.status, timestamp: "2026-08-10T10:09:00.000Z" },
      updatedAt: "2026-08-10T10:09:00.000Z",
    };
    await render(newerTask);
    await nextAnimationFrame();

    expect(container.textContent).not.toContain("Confirm local quality check");
    expect(container.textContent).toContain("still being saved");
    expect(document.activeElement).toBe(
      container.querySelector<HTMLElement>("[class*='qualityChecks']"),
    );
    expect(
      container
        .querySelector("[data-review-act-inspector='true']")
        ?.contains(document.activeElement),
    ).toBe(true);
  });

  it("ignores an old run completion after a newer result becomes current", async () => {
    const pendingRun =
      deferred<Awaited<ReturnType<VerificationsController["run"]>>>();
    const run = vi.fn(() => pendingRun.promise);
    const controller = verificationController({ run });
    const render = async (taskValue: ReviewTask) =>
      await act(async () =>
        root.render(
          <WorkspaceInspectorHarness
            initial={workspaceFixture(true)}
            reviewController={createReviewController()}
            mutations={[]}
            verifications={controller}
            taskValue={taskValue}
            projectValue={{ ...project, tasks: [taskValue] }}
          />,
        ),
      );

    await render(task);
    await click(buttonNamed(container, "Review check details"));
    await click(buttonNamed(container, "Confirm and run"));
    expect(run).toHaveBeenCalledTimes(1);

    const newerTask: ReviewTask = {
      ...task,
      status: { ...task.status, timestamp: "2026-08-10T10:09:00.000Z" },
      updatedAt: "2026-08-10T10:09:00.000Z",
    };
    await render(newerTask);
    await nextAnimationFrame();
    expect(container.textContent).toContain("still being saved");

    await act(async () => {
      pendingRun.resolve({
        ok: true,
        receipt: verificationReceipt("passed"),
        replayed: false,
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).not.toContain("Quality check queued.");
    expect(container.textContent).toContain("still being saved");
    expect(
      container
        .querySelector("[data-review-act-inspector='true']")
        ?.contains(document.activeElement),
    ).toBe(true);
  });

  it("locks run and cancel actions while a recovered workspace awaits review", async () => {
    const running = verificationReceipt("running");
    const run = vi.fn(async () => ({
      ok: false as const,
      reason: "unavailable" as const,
    }));
    const cancel = vi.fn(async () => ({
      ok: false as const,
      reason: "unavailable" as const,
    }));
    await act(async () =>
      root.render(
        <WorkspaceInspectorHarness
          initial={workspaceFixture(true)}
          reviewController={createReviewController()}
          mutations={[]}
          verifications={verificationController({
            receipts: [running],
            run,
            cancel,
          })}
          workspacePersistent={false}
          recoveryLocked
        />,
      ),
    );

    expect(container.textContent).toContain("actions are locked");
    expect(container.textContent).toContain("Running");
    expect(normalized(container.textContent)).not.toContain(
      "Review check details",
    );
    expect(normalized(container.textContent)).not.toContain("Cancel");
    expect(run).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
  });

  it("confirms cancellation and reports terminal receipt states without changing result decisions", async () => {
    const running = verificationReceipt("running");
    const unknown = verificationReceipt("unknown");
    const cancel = vi.fn(async () => ({
      ok: true as const,
      receipt: unknown,
      replayed: false,
    }));
    await act(async () =>
      root.render(
        <WorkspaceInspectorHarness
          initial={workspaceFixture(true)}
          reviewController={createReviewController()}
          mutations={[]}
          verifications={verificationController({
            receipts: [running],
            cancel,
          })}
        />,
      ),
    );

    expect(container.textContent).toContain("Running");
    await click(buttonNamed(container, "Cancel"));
    await nextAnimationFrame();
    expect(cancel).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(
      buttonNamed(container, "Confirm cancel"),
    );
    await click(buttonNamed(container, "Confirm cancel"));
    expect(cancel).toHaveBeenCalledWith(running.id);
    expect(buttonNamed(container, "Accept result")).not.toBeNull();

    await act(async () =>
      root.render(
        <WorkspaceInspectorHarness
          initial={workspaceFixture(true)}
          reviewController={createReviewController()}
          mutations={[]}
          verifications={verificationController({ receipts: [unknown] })}
        />,
      ),
    );
    expect(container.textContent).toContain("Outcome unknown");
    expect(buttonNamed(container, "Accept result")).not.toBeNull();

    await act(async () =>
      root.render(
        <WorkspaceInspectorHarness
          initial={workspaceFixture(true)}
          reviewController={createReviewController()}
          mutations={[]}
          verifications={verificationController({
            receipts: [verificationReceipt("failed")],
          })}
        />,
      ),
    );
    expect(container.textContent).toContain("Failed · exit 1");
    expect(buttonNamed(container, "Accept result")).not.toBeNull();
  });

  it("keeps an active receipt and cancellation visible while its project root is busy", async () => {
    const running = verificationReceipt("running");
    await act(async () =>
      root.render(
        <WorkspaceInspectorHarness
          initial={workspaceFixture(true)}
          reviewController={createReviewController()}
          mutations={[]}
          verifications={verificationController({
            receipts: [running],
            available: false,
            profileEligible: false,
          })}
        />,
      ),
    );

    expect(container.textContent).toContain("Running");
    expect(container.textContent).toContain("already has a quality check");
    expect(buttonNamed(container, "Cancel")).not.toBeNull();
  });

  it("shows history only for the exact stored result", async () => {
    const earlier = verificationReceipt("failed");
    const latest = { ...verificationReceipt("passed"), id: "receipt-latest" };
    const otherResult = {
      ...verificationReceipt("failed"),
      id: "receipt-other-result",
      target: {
        ...verificationTarget,
        resultKey: { kind: "revision" as const, id: "different-result" },
      },
    };
    await act(async () =>
      root.render(
        <WorkspaceInspectorHarness
          initial={workspaceFixture(true)}
          reviewController={createReviewController()}
          mutations={[]}
          verifications={verificationController({
            receipts: [earlier, otherResult, latest],
          })}
        />,
      ),
    );

    expect(container.textContent).toContain("Earlier runs for this result (1)");
    expect(container.textContent).not.toContain("different-result");
  });

  it("does not present a generic legacy evidence record as a quality-check result", async () => {
    const initial = reduceCofficeWorkspace(
      workspaceFixture(true),
      {
        type: "evidence.append",
        record: {
          id: "legacy-evidence",
          kind: "verification",
          outcome: "neutral",
          summary: "A historical activity record.",
          recordedAt: NOW,
          projectId: "project-a",
          objectiveId: "objective-a",
          workItemId: "work-a",
          attemptId: "attempt-a",
          provenance: { source: "coffice" },
        },
      },
      NOW,
    );
    await act(async () =>
      root.render(
        <WorkspaceInspectorHarness
          initial={initial}
          reviewController={createReviewController()}
          mutations={[]}
          verifications={verificationController()}
        />,
      ),
    );

    expect(container.textContent).toContain(
      "Legacy activity · not quality proof",
    );
    expect(container.textContent).toContain("No evidence reported");
    expect(container.textContent).toContain(
      "No quality-check receipt exists for this result yet.",
    );
  });

  it("labels historical App Server review evidence as activity rather than quality proof", async () => {
    const initial = reduceCofficeWorkspace(
      workspaceFixture(true),
      {
        type: "evidence.append",
        record: {
          id: "historical-review-evidence",
          kind: "verification",
          outcome: "neutral",
          summary: "Codex review completed; no verdict was reported.",
          recordedAt: NOW,
          projectId: "project-a",
          objectiveId: "objective-a",
          workItemId: "work-a",
          attemptId: "attempt-a",
          provenance: {
            source: "codex",
            reference: "codex-operation:historical-review",
          },
        },
      },
      NOW,
    );
    await act(async () =>
      root.render(
        <WorkspaceInspectorHarness
          initial={initial}
          reviewController={createReviewController()}
          mutations={[]}
          verifications={verificationController()}
        />,
      ),
    );

    expect(container.textContent).toContain("Codex review activity");
    expect(container.textContent).toContain("Review request activity");
    expect(container.textContent).toContain(
      "No quality-check receipt exists for this result yet.",
    );
  });
});
