import {
  selectActiveProjectDecisions,
  type CodexTaskAttempt,
  type CofficeWorkspace,
  type Objective,
  type WorkItem,
  type WorkspaceProject,
} from "./coffice-workspace";

export const MAX_FOLLOW_UP_CONTEXT_LENGTH = 8_000;

export type FollowUpContextResult =
  | { kind: "ready"; text: string }
  | {
      kind: "unavailable";
      reason: "no_open_context" | "ambiguous_open_context";
    }
  | { kind: "too_large"; length: number; maxLength: number };

function normalized(value: string): string {
  return value.replace(/\r\n?/gu, "\n");
}

function labelled(label: string, value: string): string {
  return `${label}: ${normalized(value).replace(/\n/gu, "\n  ")}`;
}

function bullet(value: string): string {
  return `- ${normalized(value).replace(/\n/gu, "\n  ")}`;
}

interface OpenContext {
  project: WorkspaceProject;
  objective: Objective;
  workItem: WorkItem;
  attempt: CodexTaskAttempt;
}

function selectOpenContexts(
  workspace: CofficeWorkspace | null,
  taskId: string,
): OpenContext[] {
  const contexts: OpenContext[] = [];
  for (const project of workspace?.projects ?? []) {
    for (const objective of project.objectives) {
      for (const workItem of objective.workItems) {
        for (const attempt of workItem.attempts) {
          if (
            attempt.codexTaskId === taskId &&
            attempt.unlinkedAt === undefined
          ) {
            contexts.push({ project, objective, workItem, attempt });
          }
        }
      }
    }
  }
  return contexts;
}

/**
 * Builds an editable follow-up draft from one task's unique current Coffice
 * plan link. Historical links, older superseded versions, and withdrawn heads
 * are excluded; current correction or replacement heads remain active. The
 * returned text is never truncated.
 */
export function buildCurrentPlanFollowUpContext(
  workspace: CofficeWorkspace | null,
  taskId: string,
): FollowUpContextResult {
  const openContexts = selectOpenContexts(workspace, taskId);
  if (openContexts.length === 0) {
    return { kind: "unavailable", reason: "no_open_context" };
  }
  if (openContexts.length !== 1) {
    return { kind: "unavailable", reason: "ambiguous_open_context" };
  }

  const context = openContexts[0]!;
  const lines = [
    "Coffice plan context copied for review",
    "",
    labelled("Objective", context.objective.title),
    ...(context.objective.expectedOutcome
      ? [
          labelled(
            "Objective definition of success",
            context.objective.expectedOutcome,
          ),
        ]
      : []),
    labelled("Work item", context.workItem.title),
    labelled("Expected outcome", context.workItem.expectedOutcome),
  ];
  const decisions = selectActiveProjectDecisions(
    workspace?.projectDecisionEvents ?? [],
    context.project.id,
  );
  if (decisions.length > 0) {
    lines.push("", "Current user-recorded project decisions:");
    for (const decision of decisions) {
      lines.push(bullet(decision.statement));
      if (decision.context) {
        lines.push(`  ${labelled("Recorded context", decision.context)}`);
      }
    }
  }

  const text = lines.join("\n");
  if (text.length > MAX_FOLLOW_UP_CONTEXT_LENGTH) {
    return {
      kind: "too_large",
      length: text.length,
      maxLength: MAX_FOLLOW_UP_CONTEXT_LENGTH,
    };
  }
  return { kind: "ready", text };
}
