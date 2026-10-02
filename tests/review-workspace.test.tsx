import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  AttentionInboxPanel,
  ReviewActInspector,
  type ReviewProject,
  type ReviewTask,
} from "../src/components/review-workspace";
import {
  createAttentionItem,
  type AttentionItem,
} from "../src/lib/attention-inbox";
import type { AttentionReviewController } from "../src/components/use-attention-review-state";
import type { CofficeWorkspaceController } from "../src/components/use-coffice-workspace";
import {
  createEmptyCofficeWorkspace,
  reduceCofficeWorkspace,
  type CofficeWorkspace,
} from "../src/lib/coffice-workspace";

const task: ReviewTask = {
  id: "019fdb30-03e7-79a1-ab7c-0bb0ea2920fb",
  title: "Find LangFlow example workflows",
  kind: "temporary",
  model: "gpt-5",
  updatedAt: "2026-08-10T09:58:00.000Z",
  lastActivityAt: "2026-08-10T09:58:00.000Z",
  status: {
    value: "completed",
    evidence: "observed",
    source: "session-jsonl:event_msg.turn_complete",
    timestamp: "2026-08-10T09:58:00.000Z",
    stale: false,
  },
};

const project: ReviewProject = {
  id: "langflow",
  name: "Langflow",
  tasks: [task],
  repository: {
    availability: "available",
    branch: "main",
    headOid: "0123456789abcdef0123456789abcdef01234567",
    headState: "commit",
    changedFiles: 2,
    stagedFiles: 0,
    untrackedFiles: 1,
    conflictedFiles: 0,
    ahead: 0,
    behind: 0,
    clean: false,
    changeAreas: {
      totalFiles: 2,
      summarizedFiles: 2,
      omittedFiles: 0,
      areas: [
        { area: "Source", files: 1 },
        { area: "Tests", files: 1 },
      ],
    },
    diffStats: {
      trackedFiles: 1,
      additions: 12,
      deletions: 3,
      binaryFiles: 0,
      source: "git:diff-numstat",
    },
    source: "git:status-porcelain-v2",
    observedAt: "2026-08-10T09:59:00.000Z",
  },
  repositoryEvidenceState: "fresh",
};

function controller(
  item: AttentionItem,
  options: { baseline?: boolean } = {},
): AttentionReviewController {
  return {
    ready: true,
    persistent: true,
    initializedAt: "2026-08-10T09:00:00.000Z",
    items: options.baseline ? [] : [item],
    dispositionFor: () =>
      options.baseline
        ? { kind: "baseline", at: "2026-08-10T09:00:00.000Z" }
        : undefined,
    snoozedUntilFor: () => undefined,
    isBaselined: () => Boolean(options.baseline),
    markSeen: vi.fn(async () => true),
    markReviewed: vi.fn(async () => true),
    dismiss: vi.fn(),
    snooze: vi.fn(),
    restore: vi.fn(),
  };
}

function workspaceController(
  workspace: CofficeWorkspace,
  mutate = vi.fn<CofficeWorkspaceController["mutate"]>(),
  overrides: Partial<CofficeWorkspaceController> = {},
): CofficeWorkspaceController {
  return {
    workspace,
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

function workspaceWithProjectDecisions(
  sourceResultEventKey?: string,
): CofficeWorkspace {
  const at = "2026-08-10T09:00:00.000Z";
  let workspace = createEmptyCofficeWorkspace(at);
  for (const [id, title] of [
    [project.id, project.name],
    ["another-project", "Another project"],
  ]) {
    workspace = reduceCofficeWorkspace(
      workspace,
      {
        type: "project.upsert",
        project: {
          id,
          title,
          rules:
            id === project.id
              ? [
                  "Apply SourceRuleFirst<plain-text> before review.",
                  "Keep SourceRuleSecond & in its recorded order.",
                ]
              : ["DestinationRuleMustNotReplaceHistoricalSource."],
          qualityBars:
            id === project.id
              ? [
                  { profileId: "test", profileVersion: "1" },
                  { profileId: "lint", profileVersion: "1" },
                ]
              : [{ profileId: "build", profileVersion: "1" }],
          contextReview:
            id === project.id
              ? {
                  concerns: ["stale", "contradictory"] as const,
                  note: "SourceContextReviewMustRemainExact<plain-text>.",
                  markedAt: "2026-08-10T09:07:00.000Z",
                  authorship: "user" as const,
                }
              : {
                  concerns: ["contradictory"] as const,
                  note: "DestinationContextFlagMustNotReplaceHistoricalSource.",
                  markedAt: "2026-08-10T09:08:00.000Z",
                  authorship: "user" as const,
                },
          createdAt: at,
          updatedAt: at,
          objectives:
            id === project.id && sourceResultEventKey
              ? [
                  {
                    id: "source-objective",
                    title: "Source objective",
                    status: "active",
                    createdAt: at,
                    updatedAt: at,
                    workItems: [
                      {
                        id: "source-work-item",
                        title: "Source work item",
                        expectedOutcome: "Review the retained source result.",
                        definitionOfDone: [
                          "SourceDoDCurrent<plain-text>LongUnbrokenCriterionForContainment",
                          "A reviewer makes the final decision.",
                        ],
                        relationships: [
                          {
                            kind: "hands_off_to",
                            targetObjectiveId: "source-objective",
                            targetWorkItemId: "source-release",
                          },
                        ],
                        status: "ready_for_review",
                        createdAt: at,
                        updatedAt: task.updatedAt ?? at,
                        attempts: [
                          {
                            id: "source-attempt",
                            codexTaskId: task.id,
                            relationship: "primary",
                            linkedAt: at,
                            resultCycles: [],
                          },
                        ],
                      },
                      {
                        id: "source-release",
                        title: "Source release handoff",
                        expectedOutcome: "The source result is released.",
                        status: "planned",
                        createdAt: at,
                        updatedAt: at,
                        attempts: [],
                      },
                    ],
                  },
                ]
              : [],
        },
      },
      at,
    );
  }
  if (sourceResultEventKey) {
    workspace = reduceCofficeWorkspace(
      workspace,
      {
        type: "result.upsert",
        projectId: project.id,
        objectiveId: "source-objective",
        workItemId: "source-work-item",
        attemptId: "source-attempt",
        result: {
          key: { kind: "revision", id: sourceResultEventKey },
          observedAt: task.status.timestamp ?? task.updatedAt ?? at,
        },
      },
      "2026-08-10T09:58:00.000Z",
    );
    workspace = reduceCofficeWorkspace(
      workspace,
      {
        type: "taskLink.unlink",
        codexTaskId: task.id,
        from: {
          projectId: project.id,
          objectiveId: "source-objective",
          workItemId: "source-work-item",
          attemptId: "source-attempt",
        },
        unlinkedAt: "2026-08-10T09:59:00.000Z",
      },
      "2026-08-10T09:59:00.000Z",
    );
  }
  workspace = reduceCofficeWorkspace(
    workspace,
    {
      type: "projectDecision.record",
      id: "decision-original",
      projectId: project.id,
      statement: "Use the earlier review wording.",
      context: "Earlier context must not remain current.",
    },
    "2026-08-10T09:01:00.000Z",
  );
  workspace = reduceCofficeWorkspace(
    workspace,
    {
      type: "projectDecision.supersede",
      id: "decision-corrected",
      projectId: project.id,
      supersedesId: "decision-original",
      supersessionKind: "correction",
      statement:
        "Keep CurrentProjectDecisionWithAnIntentionallyLongUnbrokenTokenForContainment exact-project scoped.",
      context:
        "Use the <source> project retained by this historical result as plain text.",
    },
    "2026-08-10T09:02:00.000Z",
  );
  workspace = reduceCofficeWorkspace(
    workspace,
    {
      type: "projectDecision.record",
      id: "decision-second",
      projectId: project.id,
      statement: "Review every current decision before accepting this result.",
    },
    "2026-08-10T17:03:00+08:00",
  );
  workspace = reduceCofficeWorkspace(
    workspace,
    {
      type: "projectDecision.record",
      id: "decision-withdrawn",
      projectId: project.id,
      statement: "This withdrawn statement must stay out of the inspector.",
    },
    "2026-08-10T09:04:00.000Z",
  );
  workspace = reduceCofficeWorkspace(
    workspace,
    {
      type: "projectDecision.withdraw",
      id: "decision-withdrawal",
      projectId: project.id,
      supersedesId: "decision-withdrawn",
      reason: "No longer current.",
    },
    "2026-08-10T09:05:00.000Z",
  );
  workspace = reduceCofficeWorkspace(
    workspace,
    {
      type: "projectDecision.record",
      id: "decision-other-project",
      projectId: "another-project",
      statement: "Another project's private decision.",
    },
    "2026-08-10T09:06:00.000Z",
  );
  if (!sourceResultEventKey) return workspace;
  const target = {
    projectId: project.id,
    objectiveId: "source-objective",
    workItemId: "source-work-item",
    attemptId: "source-attempt",
    resultKey: { kind: "revision" as const, id: sourceResultEventKey },
  };
  return {
    ...workspace,
    verificationReceipts: [
      {
        id: "quality-test-passed",
        idempotencyKey: "quality-test-passed-key",
        requestHash: "a".repeat(64),
        target,
        profile: { id: "test", version: "1" },
        checks: [
          {
            id: "test",
            version: "1",
            state: "passed",
            queuedAt: "2026-08-10T09:50:00.000Z",
            startedAt: "2026-08-10T09:50:01.000Z",
            completedAt: "2026-08-10T09:50:02.000Z",
          },
        ],
        state: "passed",
        queuedAt: "2026-08-10T09:50:00.000Z",
        startedAt: "2026-08-10T09:50:01.000Z",
        completedAt: "2026-08-10T09:50:02.000Z",
      },
      {
        id: "quality-lint-failed",
        idempotencyKey: "quality-lint-failed-key",
        requestHash: "b".repeat(64),
        target,
        profile: { id: "lint", version: "1" },
        checks: [
          {
            id: "lint",
            version: "1",
            state: "failed",
            queuedAt: "2026-08-10T09:51:00.000Z",
            startedAt: "2026-08-10T09:51:01.000Z",
            completedAt: "2026-08-10T09:51:02.000Z",
            failureKind: "exit",
            exitCode: 1,
          },
        ],
        state: "failed",
        queuedAt: "2026-08-10T09:51:00.000Z",
        startedAt: "2026-08-10T09:51:01.000Z",
        completedAt: "2026-08-10T09:51:02.000Z",
      },
    ],
  };
}

describe("attention and review workspace", () => {
  it("renders a compact evidence-backed attention item", () => {
    const item = createAttentionItem(project, task)!;
    const markup = renderToStaticMarkup(
      <AttentionInboxPanel
        items={[item]}
        initializedAt="2026-08-10T09:00:00.000Z"
        persistent={true}
        referenceTime={Date.parse("2026-08-10T10:00:00.000Z")}
        onOpenItem={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(markup).toContain('data-attention-inbox="true"');
    expect(markup).toContain("Ready for review");
    expect(markup).toContain("Find LangFlow example workflows");
    expect(markup).toContain("Langflow");
    expect(markup).toContain("Review the result in Codex");
    expect(markup).toContain("Older completed results remain available");
  });

  it.each(["request_user_input", "elicitation_request"] as const)(
    "presents a structural %s event as a generic reply request",
    (sourceEvent) => {
      const waitingTask: ReviewTask = {
        ...task,
        status: {
          value: "waiting_for_user",
          evidence: "observed",
          source: `session-jsonl:event_msg.${sourceEvent}`,
          timestamp: "2026-08-10T09:59:00.000Z",
          stale: false,
        },
      };
      const waitingProject: ReviewProject = {
        ...project,
        tasks: [waitingTask],
      };
      const waitingItem = createAttentionItem(waitingProject, waitingTask)!;
      const inboxMarkup = renderToStaticMarkup(
        <AttentionInboxPanel
          items={[waitingItem]}
          initializedAt="2026-08-10T09:00:00.000Z"
          persistent={true}
          referenceTime={Date.parse("2026-08-10T10:00:00.000Z")}
          onOpenItem={vi.fn()}
          onClose={vi.fn()}
        />,
      );
      const inspectorMarkup = renderToStaticMarkup(
        <ReviewActInspector
          task={waitingTask}
          project={waitingProject}
          displayName={waitingTask.title}
          referenceTime={Date.parse("2026-08-10T10:00:00.000Z")}
          review={controller(waitingItem)}
          onClose={vi.fn()}
        />,
      );

      expect(waitingItem).toMatchObject({
        kind: "needs_input",
        reason: "Codex is waiting for your response.",
        recommendedAction: "Open the task and respond",
      });
      expect(inboxMarkup).toContain("Reply needed");
      expect(inspectorMarkup).toContain("Reply needed");
      expect(`${inboxMarkup}${inspectorMarkup}`).not.toMatch(
        /decision needed/iu,
      );
    },
  );

  it("replaces metadata details with a truthful Review & Act inspector", () => {
    const item = createAttentionItem(project, task)!;
    const markup = renderToStaticMarkup(
      <ReviewActInspector
        task={task}
        project={project}
        displayName="Find LangFlow example workflows"
        referenceTime={Date.parse("2026-08-10T10:00:00.000Z")}
        review={controller(item)}
        onClose={vi.fn()}
      />,
    );

    expect(markup).toContain('data-review-act-inspector="true"');
    expect(markup).toContain("Review &amp; act");
    expect(markup).toContain("Expected outcome");
    expect(markup).toContain("Observed task title");
    expect(markup).toContain("A privacy-safe result summary is not reported");
    expect(markup).toContain("Not reported per task");
    expect(markup).toContain("No evidence reported");
    expect(markup).toContain(
      "No task-level risk report or self-critique is available",
    );
    expect(markup).toContain("Project Git evidence");
    expect(markup).toContain("Primary-root working tree");
    expect(markup).toContain("Not attributed to this task or result");
    expect(markup).toContain("main @ 0123456789ab");
    expect(markup).toContain("2 changed");
    expect(markup).toContain("Source 1");
    expect(markup).toContain("Tests 1");
    expect(markup).toContain("1 tracked · +12 −3");
    expect(markup).toContain("Privacy-isolated Git status");
    expect(markup).toContain("Git diff totals");
    expect(markup).toContain("Mark reviewed");
    expect(markup).not.toContain("Current project decisions");
    expect(markup).toContain(
      'href="codex://threads/019fdb30-03e7-79a1-ab7c-0bb0ea2920fb"',
    );
    expect(markup).not.toMatch(/verification failed/i);
  });

  it("progressively discloses every active decision from the exact result project without writing", () => {
    const item = createAttentionItem(project, task)!;
    const mutate = vi.fn<CofficeWorkspaceController["mutate"]>();
    const markup = renderToStaticMarkup(
      <ReviewActInspector
        task={task}
        project={project}
        displayName={task.title}
        referenceTime={Date.parse("2026-08-10T10:00:00.000Z")}
        review={controller(item)}
        workspace={workspaceController(
          workspaceWithProjectDecisions(item.eventKey),
          mutate,
        )}
        onClose={vi.fn()}
      />,
    );

    expect(markup).toContain('data-current-project-decisions="langflow"');
    expect(markup).toContain("Current project decisions · 2");
    expect(markup).toContain(
      'aria-label="2 current project decisions for Langflow"',
    );
    expect(markup).toContain("You recorded in Coffice");
    expect(markup).toContain("You recorded in Coffice · Current for Langflow");
    expect(markup).toContain(
      "Current project context—not a snapshot stored with this result.",
    );
    expect(markup).toContain(
      "Keep CurrentProjectDecisionWithAnIntentionallyLongUnbrokenTokenForContainment exact-project scoped.",
    );
    expect(markup).toContain(
      "Use the &lt;source&gt; project retained by this historical result as plain text.",
    );
    expect(markup).toContain(
      "Review every current decision before accepting this result.",
    );
    expect(markup).toContain('dateTime="2026-08-10T17:03:00+08:00"');
    expect(markup).toContain("2026-08-10 09:03 UTC");
    expect(markup).toContain('data-project-decision-id="decision-corrected"');
    expect(markup).toContain('data-project-decision-id="decision-second"');
    expect(markup.indexOf("Review every current decision")).toBeLessThan(
      markup.indexOf("Keep CurrentProjectDecision"),
    );
    expect(markup).not.toContain("Use the earlier review wording.");
    expect(markup).not.toContain(
      "This withdrawn statement must stay out of the inspector.",
    );
    expect(markup).not.toContain("Another project&#x27;s private decision.");
    expect(markup).not.toContain("<details open");
    expect(mutate).not.toHaveBeenCalled();
  });

  it("uses the stored result's source project decisions after the visible task moves", () => {
    const item = createAttentionItem(project, task)!;
    const base = workspaceWithProjectDecisions(item.eventKey);
    const sourceWorkspace: CofficeWorkspace = {
      ...base,
      projects: base.projects.map((candidateProject) =>
        candidateProject.id === "another-project"
          ? {
              ...candidateProject,
              objectives: [
                {
                  id: "destination-objective",
                  title: "Destination objective",
                  status: "active" as const,
                  createdAt: "2026-08-10T09:00:00.000Z",
                  updatedAt: "2026-08-10T09:00:00.000Z",
                  workItems: [
                    {
                      id: "destination-work-item",
                      title: "Destination work item",
                      expectedOutcome: "Continue after the retained result.",
                      definitionOfDone: [
                        "DestinationDoDMustNotReplaceHistoricalSource",
                      ],
                      relationships: [
                        {
                          kind: "depends_on" as const,
                          targetObjectiveId: "destination-objective",
                          targetWorkItemId: "destination-prerequisite",
                        },
                      ],
                      status: "in_progress" as const,
                      createdAt: "2026-08-10T09:00:00.000Z",
                      updatedAt: "2026-08-10T09:58:00.000Z",
                      attempts: [
                        {
                          id: "destination-attempt",
                          codexTaskId: task.id,
                          relationship: "continuation" as const,
                          linkedAt: "2026-08-10T09:59:30.000Z",
                          resultCycles: [],
                        },
                      ],
                    },
                    {
                      id: "destination-prerequisite",
                      title: "DestinationLinkMustNotReplaceHistoricalSource",
                      expectedOutcome: "Destination context only.",
                      status: "planned" as const,
                      createdAt: "2026-08-10T09:00:00.000Z",
                      updatedAt: "2026-08-10T09:00:00.000Z",
                      attempts: [],
                    },
                  ],
                },
              ],
            }
          : candidateProject,
      ),
    };
    const movedProject: ReviewProject = {
      ...project,
      id: "another-project",
      name: "Another project",
    };
    const markup = renderToStaticMarkup(
      <ReviewActInspector
        task={task}
        project={movedProject}
        displayName={task.title}
        referenceTime={Date.parse("2026-08-10T10:00:00.000Z")}
        review={controller(item)}
        workspace={workspaceController(sourceWorkspace)}
        onClose={vi.fn()}
      />,
    );

    expect(markup).toContain('data-current-project-decisions="langflow"');
    expect(markup).toContain(
      'aria-label="2 current project decisions for Langflow"',
    );
    expect(markup).toContain("Historical result");
    const rulesMarkup = markup.match(
      /<section[^>]*data-current-project-rules="true"[\s\S]*?<\/section>/u,
    )?.[0];
    expect(rulesMarkup).toBeDefined();
    expect(rulesMarkup).toContain("Current project rules");
    expect(rulesMarkup).toContain("2 rules");
    expect(rulesMarkup).toContain(
      "Apply SourceRuleFirst&lt;plain-text&gt; before review.",
    );
    expect(rulesMarkup).toContain(
      "Keep SourceRuleSecond &amp; in its recorded order.",
    );
    expect(rulesMarkup!.indexOf("SourceRuleFirst")).toBeLessThan(
      rulesMarkup!.indexOf("SourceRuleSecond"),
    );
    expect(rulesMarkup).not.toContain(
      "DestinationRuleMustNotReplaceHistoricalSource",
    );
    expect(rulesMarkup).not.toMatch(
      /<button|<input|<select|<textarea|contenteditable|href=/u,
    );
    expect(rulesMarkup).toContain(
      "Current project context—not a snapshot stored with this result. Coffice does not enforce these rules or treat them as evidence.",
    );
    const contextReviewMarkup = markup.match(
      /<section[^>]*data-current-project-context-review="true"[\s\S]*?<\/section>/u,
    )?.[0];
    expect(contextReviewMarkup).toBeDefined();
    expect(contextReviewMarkup).toContain("Current context needs review");
    expect(contextReviewMarkup).toContain("Stale + Contradictory");
    expect(contextReviewMarkup).toContain(
      "SourceContextReviewMustRemainExact&lt;plain-text&gt;.",
    );
    expect(contextReviewMarkup).not.toContain(
      "DestinationContextFlagMustNotReplaceHistoricalSource",
    );
    expect(contextReviewMarkup).toContain(
      "Flagged 2026-08-10 09:07 UTC by you.",
    );
    expect(contextReviewMarkup).toContain(
      "User-declared current project context—not inferred and not a snapshot stored with this result. Review and acceptance remain your decisions.",
    );
    const qualityBarsMarkup = markup.match(
      /<section[^>]*data-current-project-quality-bars="true"[\s\S]*?<\/section>/u,
    )?.[0];
    expect(qualityBarsMarkup).toBeDefined();
    expect(qualityBarsMarkup).toContain("Current project quality bars");
    expect(qualityBarsMarkup).toContain("Not ready");
    expect(qualityBarsMarkup).toContain("Tests");
    expect(qualityBarsMarkup).toContain("Passed");
    expect(qualityBarsMarkup).toContain("Lint");
    expect(qualityBarsMarkup).toContain("Failed");
    expect(qualityBarsMarkup).toContain("Recorded 2026-08-10 09:51 UTC");
    expect(qualityBarsMarkup).not.toContain("Production build");
    expect(qualityBarsMarkup).not.toMatch(
      /<button|<input|<select|<textarea|contenteditable|href=/u,
    );
    expect(qualityBarsMarkup).toContain(
      "Current project standard—not a snapshot stored with this result. Coffice does not run checks automatically or block acceptance.",
    );
    const workLinksMarkup = markup.match(
      /<section[^>]*data-current-work-links="true"[\s\S]*?<\/section>/u,
    )?.[0];
    expect(workLinksMarkup).toBeDefined();
    expect(workLinksMarkup).toContain("Current work links");
    expect(workLinksMarkup).toContain("1 link");
    expect(workLinksMarkup).toContain("Hands off to");
    expect(workLinksMarkup).toContain("Source release handoff");
    expect(workLinksMarkup).not.toContain(
      "DestinationLinkMustNotReplaceHistoricalSource",
    );
    expect(workLinksMarkup).not.toMatch(
      /<button|<input|<select|<textarea|contenteditable|href=/u,
    );
    expect(workLinksMarkup).toContain(
      "Current work-item context—not a snapshot stored with this result. These links are advisory and do not determine readiness or acceptance.",
    );
    expect(markup).toContain('data-current-definition-of-done="true"');
    expect(markup).toContain("Current definition of done");
    expect(markup).toContain(
      "SourceDoDCurrent&lt;plain-text&gt;LongUnbrokenCriterionForContainment",
    );
    expect(markup).toContain("2 criteria");
    expect(markup).toContain(
      "Current work-item context—not a snapshot stored with this result. Coffice does not verify these criteria automatically.",
    );
    expect(markup).not.toContain(
      "DestinationDoDMustNotReplaceHistoricalSource",
    );
    expect(markup).not.toMatch(/Edit criteria|Define done|type="checkbox"/u);
    expect(markup).toContain(
      "Current tracking: Another project · Destination work item.",
    );
    expect(markup).toContain("Keep CurrentProjectDecision");
    expect(markup).not.toContain("Another project&#x27;s private decision.");
  });

  it("renders an exact non-gating empty state when the source project has no rules", () => {
    const item = createAttentionItem(project, task)!;
    const linked = workspaceWithProjectDecisions(item.eventKey);
    const withoutRules: CofficeWorkspace = {
      ...linked,
      projects: linked.projects.map((candidateProject) =>
        candidateProject.id === project.id
          ? { ...candidateProject, rules: [], qualityBars: undefined }
          : candidateProject,
      ),
    };
    const mutate = vi.fn<CofficeWorkspaceController["mutate"]>();
    const markup = renderToStaticMarkup(
      <ReviewActInspector
        task={task}
        project={project}
        displayName={task.title}
        referenceTime={Date.parse("2026-08-10T10:00:00.000Z")}
        review={controller(item)}
        workspace={workspaceController(withoutRules, mutate, {
          persistent: false,
          recovery: { kind: "backup", reason: "primary-corrupt" },
          recoveryAcknowledged: false,
        })}
        onClose={vi.fn()}
      />,
    );
    const rulesMarkup = markup.match(
      /<section[^>]*data-current-project-rules="true"[\s\S]*?<\/section>/u,
    )?.[0];

    expect(rulesMarkup).toBeDefined();
    expect(rulesMarkup).toContain("Current project rules");
    expect(rulesMarkup).toContain("Not recorded");
    expect(rulesMarkup).toContain("No project rules recorded.");
    expect(rulesMarkup).toContain(
      "Current project context—not a snapshot stored with this result. Coffice does not enforce these rules or treat them as evidence.",
    );
    expect(rulesMarkup).not.toMatch(
      /<button|<input|<select|<textarea|contenteditable|href=/u,
    );
    const qualityBarsMarkup = markup.match(
      /<section[^>]*data-current-project-quality-bars="true"[\s\S]*?<\/section>/u,
    )?.[0];
    expect(qualityBarsMarkup).toContain("Not configured");
    expect(qualityBarsMarkup).toContain("No project quality bars selected.");
    expect(qualityBarsMarkup).not.toMatch(
      /<button|<input|<select|<textarea|contenteditable|href=/u,
    );
    expect(mutate).not.toHaveBeenCalled();
  });

  it("omits current project decisions from the holding inspector", () => {
    const holdingProject: ReviewProject = {
      ...project,
      holding: true,
    };
    const item = createAttentionItem(holdingProject, task)!;
    const markup = renderToStaticMarkup(
      <ReviewActInspector
        task={task}
        project={holdingProject}
        displayName={task.title}
        referenceTime={Date.parse("2026-08-10T10:00:00.000Z")}
        review={controller(item)}
        workspace={workspaceController(workspaceWithProjectDecisions())}
        onClose={vi.fn()}
      />,
    );

    expect(markup).not.toContain("Current project decisions");
    expect(markup).not.toContain("data-current-project-decisions");
  });

  it("keeps source-project decisions for an exact historical result opened from holding", () => {
    const item = createAttentionItem(project, task)!;
    const holdingProject: ReviewProject = {
      ...project,
      id: "__unassigned__",
      name: "Unassigned Sessions",
      holding: true,
    };
    const markup = renderToStaticMarkup(
      <ReviewActInspector
        task={task}
        project={holdingProject}
        displayName={task.title}
        referenceTime={Date.parse("2026-08-10T10:00:00.000Z")}
        review={controller(item)}
        workspace={workspaceController(
          workspaceWithProjectDecisions(item.eventKey),
        )}
        onClose={vi.fn()}
      />,
    );

    expect(markup).toContain('data-current-project-decisions="langflow"');
    expect(markup).toContain("You recorded in Coffice · Current for Langflow");
    expect(markup).not.toContain("Another project&#x27;s private decision.");
  });

  it("omits decisions without a managed work context or without an active head", () => {
    const item = createAttentionItem(project, task)!;
    const unmanagedMarkup = renderToStaticMarkup(
      <ReviewActInspector
        task={task}
        project={project}
        displayName={task.title}
        referenceTime={Date.parse("2026-08-10T10:00:00.000Z")}
        review={controller(item)}
        workspace={workspaceController(workspaceWithProjectDecisions())}
        onClose={vi.fn()}
      />,
    );
    const linked = workspaceWithProjectDecisions(item.eventKey);
    const withdrawnOnly: CofficeWorkspace = {
      ...linked,
      projectDecisionEvents: linked.projectDecisionEvents.filter((event) =>
        ["decision-withdrawn", "decision-withdrawal"].includes(event.id),
      ),
    };
    const withdrawnMarkup = renderToStaticMarkup(
      <ReviewActInspector
        task={task}
        project={project}
        displayName={task.title}
        referenceTime={Date.parse("2026-08-10T10:00:00.000Z")}
        review={controller(item)}
        workspace={workspaceController(withdrawnOnly)}
        onClose={vi.fn()}
      />,
    );

    expect(unmanagedMarkup).not.toContain("data-current-project-decisions");
    expect(withdrawnMarkup).not.toContain("data-current-project-decisions");
  });

  it("omits decisions when duplicate open task links make work context ambiguous", () => {
    const item = createAttentionItem(project, task)!;
    const linked = workspaceWithProjectDecisions(item.eventKey);
    const ambiguous: CofficeWorkspace = {
      ...linked,
      projects: linked.projects.map((candidateProject) => {
        if (candidateProject.id === project.id) {
          return {
            ...candidateProject,
            objectives: candidateProject.objectives.map((objective) => ({
              ...objective,
              workItems: objective.workItems.map((workItem) => ({
                ...workItem,
                attempts: workItem.attempts.map(
                  ({ unlinkedAt, ...attempt }) => {
                    void unlinkedAt;
                    return attempt;
                  },
                ),
              })),
            })),
          };
        }
        return {
          ...candidateProject,
          objectives: [
            {
              id: "ambiguous-objective",
              title: "Ambiguous objective",
              status: "active" as const,
              createdAt: task.updatedAt!,
              updatedAt: task.updatedAt!,
              workItems: [
                {
                  id: "ambiguous-work",
                  title: "Ambiguous work",
                  expectedOutcome: "Do not guess the source context.",
                  status: "in_progress" as const,
                  createdAt: task.updatedAt!,
                  updatedAt: task.updatedAt!,
                  attempts: [
                    {
                      id: "ambiguous-attempt",
                      codexTaskId: task.id,
                      relationship: "continuation" as const,
                      linkedAt: task.updatedAt!,
                      resultCycles: [],
                    },
                  ],
                },
              ],
            },
          ],
        };
      }),
    };
    const markup = renderToStaticMarkup(
      <ReviewActInspector
        task={task}
        project={project}
        displayName={task.title}
        referenceTime={Date.parse("2026-08-10T10:00:00.000Z")}
        review={controller(item)}
        workspace={workspaceController(ambiguous)}
        onClose={vi.fn()}
      />,
    );

    expect(markup).not.toContain("data-current-project-decisions");
  });

  it("keeps saved decisions visible when workspace writes are unavailable or recovery-locked", () => {
    const item = createAttentionItem(project, task)!;
    const workspace = workspaceWithProjectDecisions(item.eventKey);
    const unavailableMarkup = renderToStaticMarkup(
      <ReviewActInspector
        task={task}
        project={project}
        displayName={task.title}
        referenceTime={Date.parse("2026-08-10T10:00:00.000Z")}
        review={controller(item)}
        workspace={workspaceController(workspace, undefined, {
          persistent: false,
        })}
        onClose={vi.fn()}
      />,
    );
    const recoveryMarkup = renderToStaticMarkup(
      <ReviewActInspector
        task={task}
        project={project}
        displayName={task.title}
        referenceTime={Date.parse("2026-08-10T10:00:00.000Z")}
        review={controller(item)}
        workspace={workspaceController(workspace, undefined, {
          recovery: { kind: "backup", reason: "primary-corrupt" },
          recoveryAcknowledged: false,
        })}
        onClose={vi.fn()}
      />,
    );

    expect(unavailableMarkup).toContain(
      'data-current-project-decisions="langflow"',
    );
    expect(recoveryMarkup).toContain(
      'data-current-project-decisions="langflow"',
    );
  });

  it("describes observed failure evidence without claiming which turn failed", () => {
    const failedTask: ReviewTask = {
      ...task,
      id: "failed-task",
      status: {
        ...task.status,
        value: "failed",
        source: "session-jsonl:event_msg.task_failed",
      },
    };
    const failedProject: ReviewProject = {
      ...project,
      tasks: [failedTask],
    };
    const failedItem = createAttentionItem(failedProject, failedTask)!;
    const markup = renderToStaticMarkup(
      <ReviewActInspector
        task={failedTask}
        project={failedProject}
        displayName={failedTask.title}
        referenceTime={Date.parse("2026-08-10T10:00:00.000Z")}
        review={controller(failedItem)}
        onClose={vi.fn()}
      />,
    );

    expect(markup).toContain("Task failed");
    expect(markup).toContain("inspect the failure");
    expect(markup).not.toMatch(/latest turn failed/i);
  });

  it("lets a baselined historical result be deliberately restored", () => {
    const item = createAttentionItem(project, task)!;
    const markup = renderToStaticMarkup(
      <ReviewActInspector
        task={task}
        project={project}
        displayName="Find LangFlow example workflows"
        referenceTime={Date.parse("2026-08-10T10:00:00.000Z")}
        review={controller(item, { baseline: true })}
        onClose={vi.fn()}
      />,
    );

    expect(markup).toContain("Existing result");
    expect(markup).toContain("Add to inbox");
    expect(markup).toContain("Mark reviewed");
  });

  it("does not pretend a resident-agent label is an expected outcome", () => {
    const resident: ReviewTask = {
      ...task,
      id: "resident-agent",
      title: "[AGENT] Scientist (3)",
      kind: "staff",
      status: {
        ...task.status,
        value: "idle",
        evidence: "inferred",
        source: "session-jsonl:event_msg.task_complete",
      },
    };
    const residentProject: ReviewProject = {
      ...project,
      tasks: [resident],
    };
    const item = createAttentionItem(residentProject, resident)!;
    const markup = renderToStaticMarkup(
      <ReviewActInspector
        task={resident}
        project={residentProject}
        displayName="Scientist"
        referenceTime={Date.parse("2026-08-10T10:00:00.000Z")}
        review={controller(item)}
        onClose={vi.fn()}
      />,
    );

    expect(markup).toContain(
      "Not reported by the current metadata source for this resident agent.",
    );
    expect(markup).toContain(
      "Open the completed result in Codex, review it, then mark this result reviewed here.",
    );
    expect(markup).not.toContain(
      '<p class="outcome">[AGENT] Scientist (3)</p>',
    );
  });

  it("shows an honest caught-up state without treating ordinary activity as attention", () => {
    const markup = renderToStaticMarkup(
      <AttentionInboxPanel
        items={[]}
        initializedAt="2026-08-10T09:00:00.000Z"
        persistent={true}
        referenceTime={Date.parse("2026-08-10T10:00:00.000Z")}
        onOpenItem={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(markup).toContain("All caught up");
    expect(markup).toContain(
      "New completed results and current observed problems will appear here.",
    );
  });

  it("names an exact project scope and gives it a truthful empty state", () => {
    const markup = renderToStaticMarkup(
      <AttentionInboxPanel
        items={[]}
        initializedAt="2026-08-10T09:00:00.000Z"
        persistent={true}
        referenceTime={Date.parse("2026-08-10T10:00:00.000Z")}
        scopeLabel="Langflow"
        scopeProjectId="langflow"
        onOpenItem={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(markup).toContain('data-attention-scope-project-id="langflow"');
    expect(markup).toContain("Project attention");
    expect(markup).toContain("Langflow attention");
    expect(markup).toContain("Only current observed actions for Langflow.");
    expect(markup).toContain("No current actions");
    expect(markup).toContain("Langflow has no current Attention items.");
    expect(markup).not.toContain("All caught up");
  });

  it("warns when review choices cannot be persisted", () => {
    const item = createAttentionItem(project, task)!;
    const temporaryController = { ...controller(item), persistent: false };
    const markup = renderToStaticMarkup(
      <ReviewActInspector
        task={task}
        project={project}
        displayName={task.title}
        referenceTime={Date.parse("2026-08-10T10:00:00.000Z")}
        review={temporaryController}
        onClose={vi.fn()}
      />,
    );

    expect(markup).toContain(
      "This review choice cannot be saved because the local Coffice workspace is unavailable.",
    );
  });

  it("does not invent repository counters when Git evidence is unavailable", () => {
    const item = createAttentionItem(project, task)!;
    const unavailableProject: ReviewProject = {
      ...project,
      repository: {
        availability: "unavailable",
        source: "git",
        observedAt: "2026-08-10T09:59:00.000Z",
      },
      repositoryEvidenceState: "unavailable",
    };
    const markup = renderToStaticMarkup(
      <ReviewActInspector
        task={task}
        project={unavailableProject}
        displayName={task.title}
        referenceTime={Date.parse("2026-08-10T10:00:00.000Z")}
        review={controller(item)}
        onClose={vi.fn()}
      />,
    );

    expect(markup).toContain("Privacy-safe Git evidence is unavailable");
    expect(markup).toContain("Last checked 1m ago");
    expect(markup).not.toContain("0 changed");
    expect(markup).not.toContain("Clean working tree");
  });

  it("labels retained repository evidence stale and reports missing diff stats", () => {
    const item = createAttentionItem(project, task)!;
    const staleProject: ReviewProject = {
      ...project,
      repository:
        project.repository?.availability === "available"
          ? { ...project.repository, diffStats: undefined }
          : project.repository,
      repositoryEvidenceState: "stale",
    };
    const markup = renderToStaticMarkup(
      <ReviewActInspector
        task={task}
        project={staleProject}
        displayName={task.title}
        referenceTime={Date.parse("2026-08-10T10:00:00.000Z")}
        review={controller(item)}
        onClose={vi.fn()}
      />,
    );

    expect(markup).toContain("This repository snapshot is stale");
    expect(markup).toContain("Diff stats unavailable");
  });

  it("preserves the compact primary-root presentation for a single saved root", () => {
    const item = createAttentionItem(project, task)!;
    const markup = renderToStaticMarkup(
      <ReviewActInspector
        task={task}
        project={project}
        displayName={task.title}
        referenceTime={Date.parse("2026-08-10T10:00:00.000Z")}
        review={controller(item)}
        onClose={vi.fn()}
      />,
    );

    expect(markup).toContain("Primary-root working tree");
    expect(markup).not.toContain("saved roots");
    expect(markup).not.toContain("Totals are not combined");
  });

  it("does not resurrect legacy evidence for an authoritative cold primary root", () => {
    const item = createAttentionItem(project, task)!;
    const coldPrimaryProject: ReviewProject = {
      ...project,
      repositoryRoots: [{ role: "primary", evidenceState: "refreshing" }],
    };
    const markup = renderToStaticMarkup(
      <ReviewActInspector
        task={task}
        project={coldPrimaryProject}
        displayName={task.title}
        referenceTime={Date.parse("2026-08-10T10:00:00.000Z")}
        review={controller(item)}
        onClose={vi.fn()}
      />,
    );

    expect(markup).toContain('data-repository-evidence-state="refreshing"');
    expect(markup).toContain("Primary-root working tree");
    expect(markup).toContain(
      "Git evidence is refreshing; no previous repository snapshot is available.",
    );
    expect(markup).not.toContain("main @ 0123456789ab");
    expect(markup).not.toContain("2 changed");
    expect(markup).not.toContain("Last checked");
  });

  it("reports multiple saved roots independently without exposing path labels", () => {
    const item = createAttentionItem(project, task)!;
    if (
      !project.repository ||
      project.repository.availability !== "available"
    ) {
      throw new Error(
        "Expected the review fixture to have repository evidence.",
      );
    }
    const privatePrimaryPath = "C:/PRIVATE/primary-canary";
    const privateAdditionalPath = "D:/PRIVATE/additional-canary";
    const multiRootProject = {
      ...project,
      repositoryRoots: [
        {
          role: "primary" as const,
          evidence: { ...project.repository, path: privatePrimaryPath },
          evidenceState: "fresh" as const,
        },
        {
          role: "additional" as const,
          evidence: {
            ...project.repository,
            path: privateAdditionalPath,
            branch: "release",
            headOid: "fedcba9876543210fedcba9876543210fedcba98",
            changedFiles: 0,
            stagedFiles: 0,
            untrackedFiles: 0,
            clean: true,
            behind: 2,
            changeAreas: {
              totalFiles: 0,
              summarizedFiles: 0,
              omittedFiles: 0,
              areas: [],
            },
            diffStats: undefined,
          },
          evidenceState: "stale" as const,
        },
      ],
    } as unknown as ReviewProject;
    const markup = renderToStaticMarkup(
      <ReviewActInspector
        task={task}
        project={multiRootProject}
        displayName={task.title}
        referenceTime={Date.parse("2026-08-10T10:00:00.000Z")}
        review={controller(item)}
        onClose={vi.fn()}
      />,
    );

    expect(markup).toContain('data-repository-root-count="2"');
    expect(markup).toContain("2 saved roots");
    expect(markup).toContain("Primary saved root");
    expect(markup).toContain("Additional saved root 2");
    expect(markup).toContain("Saved root 1 of 2");
    expect(markup).toContain("Saved root 2 of 2");
    expect(markup).toContain(
      "Each saved root is reported separately. Totals are not combined, and local paths are not shown.",
    );
    expect(markup).toContain("main @ 0123456789ab");
    expect(markup).toContain("release @ fedcba987654");
    expect(markup).toContain("2 changed");
    expect(markup).toContain("Clean working tree");
    expect(markup).toContain("This repository snapshot is stale");
    expect(markup.match(/Repository details/g)).toHaveLength(2);
    expect(markup).not.toContain(privatePrimaryPath);
    expect(markup).not.toContain(privateAdditionalPath);
  });

  it("shows cold multi-root placeholders immediately without invented timestamps", () => {
    const item = createAttentionItem(project, task)!;
    const coldProject: ReviewProject = {
      ...project,
      repository: undefined,
      repositoryRoots: [
        { role: "primary", evidenceState: "refreshing" },
        { role: "additional", evidenceState: "refreshing" },
      ],
      repositoryEvidenceState: "refreshing",
    };
    const markup = renderToStaticMarkup(
      <ReviewActInspector
        task={task}
        project={coldProject}
        displayName={task.title}
        referenceTime={Date.parse("2026-08-10T10:00:00.000Z")}
        review={controller(item)}
        onClose={vi.fn()}
      />,
    );

    expect(markup).toContain('data-repository-root-count="2"');
    expect(markup.match(/Refreshing/g)).toHaveLength(2);
    expect(markup.match(/no previous repository snapshot/g)).toHaveLength(2);
    expect(markup).not.toContain("Last checked");
    expect(markup).not.toContain("Primary-root working tree");
  });

  it("renders one compact bounded-out record without partial root placeholders", () => {
    const item = createAttentionItem(project, task)!;
    const boundedProject: ReviewProject = {
      ...project,
      repositoryRootCount: 25,
      repositoryCollectionState: "bounded_out",
      repositoryRoots: [
        {
          role: "primary",
          evidenceState: "fresh",
          evidence: project.repository,
        },
      ],
    };
    const markup = renderToStaticMarkup(
      <ReviewActInspector
        task={task}
        project={boundedProject}
        displayName={task.title}
        referenceTime={Date.parse("2026-08-10T10:00:00.000Z")}
        review={controller(item)}
        onClose={vi.fn()}
      />,
    );

    expect(markup).toContain('data-repository-root-count="25"');
    expect(markup).toContain('data-repository-collection-state="bounded_out"');
    expect(markup).toContain("25 saved roots");
    expect(markup).toContain(
      "the source-wide saved-root inventory exceeds the technical collection safety bound",
    );
    expect(markup).toContain("No partial subset was inspected.");
    expect(markup).not.toContain("Primary saved root");
    expect(markup).not.toContain("Primary-root working tree");
    expect(markup).not.toContain("main @ 0123456789ab");
    expect(markup).not.toContain('role="listitem"');
  });

  it("does not imply that a projectless task has a repository", () => {
    const item = createAttentionItem(project, task)!;
    const holdingProject: ReviewProject = {
      ...project,
      id: "__unassigned__",
      name: "Projectless intake",
      holding: true,
      repository: undefined,
      repositoryEvidenceState: "unavailable",
    };
    const markup = renderToStaticMarkup(
      <ReviewActInspector
        task={task}
        project={holdingProject}
        displayName={task.title}
        referenceTime={Date.parse("2026-08-10T10:00:00.000Z")}
        review={controller(item)}
        onClose={vi.fn()}
      />,
    );

    expect(markup).toContain("No saved project root");
    expect(markup).toContain("This task is in projectless intake");
    expect(markup).not.toContain("Primary-root working tree");
  });
});
