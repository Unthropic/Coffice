import type { CodexOperation } from "./codex-app-server";

const TERMINAL_OPERATION_STATES = new Set([
  "completed",
  "failed",
  "interrupted",
  "unknown",
]);

export interface OperationEvidenceProject {
  id: string;
  tasks: readonly { id: string }[];
}

export interface PendingOperationEvidence {
  operation: CodexOperation;
  projectId: string;
}

export function selectNextCodexOperationEvidence(
  operations: readonly CodexOperation[],
  projects: readonly OperationEvidenceProject[],
  recordedReferences: ReadonlySet<string>,
  pendingOperationIds: ReadonlySet<string>,
): PendingOperationEvidence | null {
  for (const operation of operations) {
    if (
      !TERMINAL_OPERATION_STATES.has(operation.state) ||
      recordedReferences.has(`codex-operation:${operation.id}`) ||
      pendingOperationIds.has(operation.id)
    ) {
      continue;
    }
    const project = projects.find((candidate) =>
      candidate.tasks.some((task) => task.id === operation.taskId),
    );
    if (project) return { operation, projectId: project.id };
  }
  return null;
}
