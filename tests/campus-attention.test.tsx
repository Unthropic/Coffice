// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Campus } from "../src/components/coffice-app";
import type { DesktopAlertSettingsController } from "../src/components/use-desktop-alert-settings";
import type { AttentionReviewController } from "../src/components/use-attention-review-state";
import type { CofficeWorkspaceController } from "../src/components/use-coffice-workspace";
import { selectAttentionProjectProjection } from "../src/lib/attention-digest";
import type { AttentionItem } from "../src/lib/attention-inbox";
import { selectProjectCountsById } from "../src/lib/project-task-presentation";

const activeTask = {
  id: "task-a",
  title: "Active project work",
  kind: "temporary" as const,
  assignmentEvidence: "explicit_project" as const,
  status: {
    value: "active" as const,
    evidence: "observed" as const,
    source: "test",
    timestamp: "2026-08-11T08:00:00.000Z",
    stale: false,
  },
};

const cleanRepository = {
  availability: "available" as const,
  branch: "main",
  headOid: "0123456789abcdef0123456789abcdef01234567",
  headState: "commit" as const,
  changedFiles: 0,
  stagedFiles: 0,
  untrackedFiles: 0,
  conflictedFiles: 0,
  ahead: 0,
  behind: 0,
  clean: true,
  source: "git:status-porcelain-v2" as const,
  observedAt: "2026-08-11T08:00:00.000Z",
  changeAreas: {
    totalFiles: 0,
    summarizedFiles: 0,
    omittedFiles: 0,
    areas: [],
  },
};

const projects = [
  {
    id: "project-a",
    name: "Project A",
    order: 0,
    tasks: [activeTask],
    repository: cleanRepository,
    repositoryRoots: [
      {
        role: "primary" as const,
        evidence: cleanRepository,
        evidenceState: "fresh" as const,
      },
      {
        role: "additional" as const,
        evidenceState: "refreshing" as const,
      },
    ],
    repositoryEvidenceState: "fresh" as const,
  },
  {
    id: "project-b",
    name: "Project B",
    order: 1,
    tasks: [],
    repository: cleanRepository,
    repositoryRoots: [
      {
        role: "primary" as const,
        evidence: cleanRepository,
        evidenceState: "fresh" as const,
      },
    ],
    repositoryEvidenceState: "fresh" as const,
  },
  {
    id: "project-c",
    name: "Project C",
    order: 2,
    tasks: [],
    repositoryRootCount: 25,
    repositoryCollectionState: "bounded_out" as const,
    repository: cleanRepository,
    repositoryRoots: [
      {
        role: "primary" as const,
        evidence: cleanRepository,
        evidenceState: "fresh" as const,
      },
    ],
    repositoryEvidenceState: "fresh" as const,
  },
  {
    id: "__unassigned__",
    name: "Holding area",
    order: 3,
    tasks: [],
    holding: true,
  },
];

const items: AttentionItem[] = [
  {
    eventKey: "result:project-b",
    kind: "ready_for_review",
    priority: 3,
    projectId: "project-b",
    projectName: "Project B",
    taskId: "archived-b",
    taskTitle: "Archived result",
    occurredAt: "2026-08-11T08:00:00.000Z",
    status: "completed",
    evidence: "observed",
    stale: false,
    reason: "A completed result is ready to review.",
    recommendedAction: "Review the result",
  },
  {
    eventKey: "verification:project-b",
    kind: "verification_failed",
    priority: 1,
    projectId: "project-b",
    projectName: "Project B",
    taskId: "attempt-b",
    taskTitle: "Archived quality result",
    occurredAt: "2026-08-11T08:01:00.000Z",
    status: "failed",
    evidence: "observed",
    stale: false,
    reason: "A quality check failed for this exact result.",
    recommendedAction: "Review the stored work result",
    verificationTarget: {
      projectId: "project-b",
      objectiveId: "objective-b",
      workItemId: "work-b",
      attemptId: "attempt-b",
      resultKey: { kind: "revision", id: "result-b" },
    },
  },
  {
    eventKey: "decision-request:project-b",
    kind: "decision_needed",
    priority: 0,
    projectId: "project-b",
    projectName: "Project B",
    taskId: "work-b",
    planProjectId: "project-b",
    taskTitle: "Release target",
    occurredAt: "2026-08-11T08:01:30.000Z",
    status: "waiting_for_user",
    evidence: "observed",
    stale: false,
    reason: "A decision you recorded is still open.",
    recommendedAction: "Review the work item decision",
  },
  {
    eventKey: "needs-input:holding",
    kind: "needs_input",
    priority: 0,
    projectId: "__unassigned__",
    projectName: "Holding area",
    taskId: "holding-task",
    openTaskId: "holding-task",
    taskTitle: "Unassigned input request",
    occurredAt: "2026-08-11T08:02:00.000Z",
    status: "waiting_for_user",
    evidence: "observed",
    stale: false,
    reason: "Codex is waiting for your response.",
    recommendedAction: "Reply in Codex",
  },
];

const workspace: CofficeWorkspaceController = {
  workspace: null,
  ready: true,
  persistent: true,
  recovery: null,
  recoveryAcknowledged: false,
  error: null,
  refresh: async () => undefined,
  acknowledgeRecovery: vi.fn(),
  mutate: async () => ({ ok: false, reason: "unavailable" }),
  replaceAttentionReview: async () => ({ ok: false, reason: "unavailable" }),
  updateAttentionEvent: async () => ({ ok: false, reason: "unavailable" }),
};

const desktopAlerts: DesktopAlertSettingsController = {
  status: "off",
  busy: false,
  message: null,
  enabled: false,
  optedIn: true,
  coordinationAvailable: true,
  projectMutedById: new Map(projects.map((project) => [project.id, false])),
  projectMuteBusyId: null,
  projectMuteMessage: null,
  projectMuteResetBusy: false,
  projectMuteResetAvailable: false,
  projectMuteManageable: true,
  setProjectMuted: vi.fn().mockResolvedValue(true),
  resetProjectMutes: vi.fn().mockResolvedValue(true),
  enable: vi.fn().mockResolvedValue(undefined),
  disable: vi.fn(),
};

function reviewController(ready: boolean): AttentionReviewController {
  return {
    ready,
    persistent: true,
    initializedAt: "2026-08-11T07:00:00.000Z",
    items,
    dispositionFor: () => undefined,
    snoozedUntilFor: () => undefined,
    isBaselined: () => false,
    markSeen: vi.fn(async () => true),
    markReviewed: vi.fn(async () => true),
    dismiss: vi.fn(),
    snooze: vi.fn(),
    restore: vi.fn(),
  };
}

describe("campus project Attention signals", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    window.localStorage.clear();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  async function renderCampus(ready: boolean) {
    const review = reviewController(ready);
    const projection = selectAttentionProjectProjection(
      review.items,
      projects,
      review.dispositionFor,
    );
    await act(async () => {
      root.render(
        <Campus
          projects={projects}
          onEnter={vi.fn()}
          referenceTime={Date.parse("2026-08-11T08:03:00.000Z")}
          projectCountsById={selectProjectCountsById(projects)}
          workspace={workspace}
          review={review}
          attentionProjection={projection}
          digestSourceState="fresh"
          onOpenReviewTask={vi.fn()}
          onOpenStoredResult={vi.fn()}
          desktopAlerts={desktopAlerts}
        />,
      );
    });
    return { review, projection };
  }

  it("uses canonical project actions for order, quiet retention, card copy, and the holding route", async () => {
    const { projection } = await renderCampus(true);
    const cards = [
      ...host.querySelectorAll<HTMLButtonElement>(".project-building"),
    ];

    expect(cards.map((card) => card.dataset.projectId)).toEqual([
      "project-b",
      "project-a",
      "__unassigned__",
    ]);
    expect(host.querySelector('[data-project-id="project-c"]')).toBeNull();

    const projectB = host.querySelector<HTMLButtonElement>(
      '[data-project-id="project-b"]',
    )!;
    expect(projectB.dataset.attentionCount).toBe("3");
    expect(projectB.dataset.needsReplyCount).toBe("0");
    expect(projectB.dataset.needsDecisionCount).toBe("1");
    expect(projectB.dataset.unreadResultCount).toBe("1");
    expect(projectB.textContent).toContain("3 actions");
    expect(projectB.textContent).toContain("1 decision needed");
    expect(projectB.textContent).toContain("1 unread result");
    expect(projectB.dataset.repositoryRootCount).toBe("1");
    expect(projectB.textContent).toContain("Clear skies · clean");
    expect(projectB.getAttribute("aria-label")).not.toContain(
      "saved Git roots",
    );
    expect(projectB.getAttribute("aria-label")).toContain(
      "3 current actions: 0 replies needed, 1 decision needed, 1 unread result, 1 other action.",
    );

    const projectA = host.querySelector<HTMLButtonElement>(
      '[data-project-id="project-a"]',
    )!;
    expect(projectA.dataset.repositoryRootCount).toBe("2");
    expect(projectA.textContent).toContain("2 Git roots · inspect separately");
    expect(projectA.textContent).not.toContain("Clear skies · clean");
    expect(projectA.getAttribute("aria-label")).toContain(
      "2 saved Git roots; inspect separately.",
    );

    const holding = host.querySelector<HTMLButtonElement>(
      '[data-project-id="__unassigned__"]',
    )!;
    expect(holding.dataset.attentionCount).toBe("1");
    expect(holding.dataset.needsReplyCount).toBe("1");
    expect(holding.dataset.unreadResultCount).toBe("0");
    expect(holding.textContent).toContain("1 action");
    expect(holding.textContent).toContain("1 reply needed");
    expect(holding.textContent).not.toContain("unread result");
    expect(holding.getAttribute("aria-label")).toContain(
      "1 current action: 1 reply needed, 0 decisions needed, 0 unread results, 0 other actions.",
    );
    expect(projection.byProjectId.get("__unassigned__")?.counts.total).toBe(1);

    const rollup = host.querySelector(".campus-attention-rollup")!;
    expect(rollup.textContent).toContain("1 needs reply");
    expect(rollup.textContent).toContain("1 needs decision");
    expect(rollup.textContent).toContain("1 unread result");
    expect(rollup.textContent).toContain("1 other action");

    await act(async () => {
      host
        .querySelector<HTMLButtonElement>('[aria-label^="Open digest"]')!
        .click();
    });
    await act(async () => {
      document
        .querySelector<HTMLElement>("[data-desktop-alert-settings] summary")!
        .click();
    });
    expect(
      Array.from(
        document.querySelectorAll<HTMLInputElement>(
          '[data-desktop-alert-settings] input[type="checkbox"]',
        ),
      ).map((control) => control.getAttribute("aria-label")),
    ).toEqual([
      "Desktop alerts for Project A",
      "Desktop alerts for Project B",
      "Desktop alerts for Project C",
      "Desktop alerts for Unassigned sessions",
    ]);
  });

  it("shows unknown counts, keeps routes visible, and does not reorder before Attention is ready", async () => {
    await renderCampus(false);
    const cards = [
      ...host.querySelectorAll<HTMLButtonElement>(".project-building"),
    ];

    expect(cards.map((card) => card.dataset.projectId)).toEqual([
      "project-a",
      "project-b",
      "project-c",
      "__unassigned__",
    ]);
    expect(cards.every((card) => card.dataset.attentionCount === "—")).toBe(
      true,
    );
    expect(cards.every((card) => card.dataset.needsReplyCount === "—")).toBe(
      true,
    );
    expect(cards.every((card) => card.dataset.unreadResultCount === "—")).toBe(
      true,
    );
    const bounded = host.querySelector<HTMLButtonElement>(
      '[data-project-id="project-c"]',
    )!;
    expect(bounded.dataset.repositoryRootCount).toBe("25");
    expect(bounded.dataset.repositoryCollectionState).toBe("bounded_out");
    expect(bounded.textContent).toContain(
      "25 Git roots · evidence unavailable",
    );
    expect(bounded.textContent).not.toContain("Clear skies · clean");
    expect(bounded.getAttribute("aria-label")).toContain(
      "25 saved Git roots; evidence unavailable.",
    );
    expect(cards.every((card) => card.textContent?.includes("— actions"))).toBe(
      true,
    );
    expect(
      host.querySelector<HTMLButtonElement>(
        '[aria-label="Attention order unavailable while Attention is loading"]',
      )?.disabled,
    ).toBe(true);
    expect(host.textContent).not.toContain("quiet wing");
  });
});
