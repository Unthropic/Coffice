import type { CofficeWorkspace } from "./coffice-workspace";

/**
 * Returns the exact Attention completion keys resolved by durable result review.
 * Non-revision result keys belong to other observation domains and must not be
 * interpreted as Attention event identities.
 */
export function selectReviewedResultAttentionEventKeys(
  workspace: CofficeWorkspace | null,
): ReadonlySet<string> {
  const resolved = new Set<string>();
  if (!workspace) return resolved;

  for (const project of workspace.projects) {
    for (const objective of project.objectives) {
      for (const workItem of objective.workItems) {
        for (const attempt of workItem.attempts) {
          for (const result of attempt.resultCycles) {
            if (result.key.kind === "revision" && result.review) {
              resolved.add(result.key.id);
            }
          }
        }
      }
    }
  }

  return resolved;
}
