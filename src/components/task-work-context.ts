import type {
  CodexTaskAttempt,
  CofficeWorkspace,
  Objective,
  TaskLinkLocation,
  WorkItem,
  WorkspaceProject,
} from "../lib/coffice-workspace";

export interface TaskWorkContext {
  project: WorkspaceProject;
  objective: Objective;
  workItem: WorkItem;
  attempt: CodexTaskAttempt;
  location: TaskLinkLocation;
}

export function selectTaskWorkContexts(
  workspace: CofficeWorkspace | null,
  taskId: string,
): TaskWorkContext[] {
  const matches: TaskWorkContext[] = [];
  for (const project of workspace?.projects ?? []) {
    for (const objective of project.objectives) {
      for (const workItem of objective.workItems) {
        for (const attempt of workItem.attempts) {
          if (attempt.codexTaskId !== taskId) continue;
          matches.push({
            project,
            objective,
            workItem,
            attempt,
            location: {
              projectId: project.id,
              objectiveId: objective.id,
              workItemId: workItem.id,
              attemptId: attempt.id,
            },
          });
        }
      }
    }
  }
  return matches;
}

export function selectOpenTaskWorkContext(
  workspace: CofficeWorkspace | null,
  taskId: string,
): TaskWorkContext | null {
  return (
    selectTaskWorkContexts(workspace, taskId).find(
      (context) => context.attempt.unlinkedAt === undefined,
    ) ?? null
  );
}

export function selectLatestClosedTaskWorkContext(
  workspace: CofficeWorkspace | null,
  taskId: string,
): TaskWorkContext | null {
  let latest: TaskWorkContext | null = null;
  for (const context of selectTaskWorkContexts(workspace, taskId)) {
    if (!context.attempt.unlinkedAt) continue;
    if (
      !latest ||
      Date.parse(context.attempt.unlinkedAt) >
        Date.parse(latest.attempt.unlinkedAt!) ||
      (context.attempt.unlinkedAt === latest.attempt.unlinkedAt &&
        (Date.parse(context.attempt.linkedAt) >
          Date.parse(latest.attempt.linkedAt) ||
          (context.attempt.linkedAt === latest.attempt.linkedAt &&
            context.attempt.id.localeCompare(latest.attempt.id) > 0)))
    ) {
      latest = context;
    }
  }
  return latest;
}
