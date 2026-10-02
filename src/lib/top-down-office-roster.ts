import type { NormalizedStatusValue } from "./domain";
import {
  attentionEventKey,
  isPersistentCompletion,
  type AttentionItem,
  type AttentionTaskStatus,
} from "./attention-inbox";
import { formatVisibleTaskName } from "./project-task-presentation";

export const TOP_DOWN_AVATAR_VARIANT_COUNT = 6;

export interface TopDownRosterSource {
  id: string;
  title: string;
  kind?: "staff" | "temporary";
  agentName?: string;
  status: AttentionTaskStatus;
}

export type TopDownWorkflowArea = "desk" | "meeting" | "review";

export interface TopDownRosterContext {
  projectId: string;
  attentionItems: readonly AttentionItem[];
}

export interface TopDownRosterWorker {
  taskId: string;
  displayName: string;
  status: NormalizedStatusValue;
  attention: boolean;
  stale: boolean;
  workflowArea: TopDownWorkflowArea;
  visualIdentity: number;
}

const ATTENTION_STATUSES = new Set<NormalizedStatusValue>([
  "waiting_for_user",
  "blocked",
  "failed",
]);

/** Adapts live product metadata into the renderer-neutral office roster. */
export function bindTopDownRoster(
  tasks: readonly TopDownRosterSource[],
  labelByTaskId: ReadonlyMap<string, string> = new Map(),
  context?: TopDownRosterContext,
): TopDownRosterWorker[] {
  return tasks.map((task) => ({
    taskId: task.id,
    displayName:
      labelByTaskId.get(task.id) ??
      formatVisibleTaskName({
        id: task.id,
        title: task.title,
        agentName: task.agentName,
        kind: task.kind ?? "temporary",
      }),
    status: task.status.value,
    attention: ATTENTION_STATUSES.has(task.status.value),
    stale: task.status.stale === true,
    workflowArea: context
      ? selectTopDownWorkflowArea(
          task,
          context.projectId,
          context.attentionItems,
        )
      : "desk",
    visualIdentity: stableTopDownVisualIdentity(task.id),
  }));
}

/**
 * Selects a shared workflow area from the canonical, currently visible
 * Attention event for this exact task revision. All other signals remain at
 * the worker's desk.
 */
export function selectTopDownWorkflowArea(
  task: TopDownRosterSource,
  projectId: string,
  attentionItems: readonly AttentionItem[],
): TopDownWorkflowArea {
  const currentEventKey = attentionEventKey(task);
  const exactItems = attentionItems.filter(
    (item) =>
      item.projectId === projectId &&
      item.taskId === task.id &&
      item.eventKey === currentEventKey,
  );

  if (
    task.status.value === "waiting_for_user" &&
    task.status.evidence === "observed" &&
    task.status.stale !== true &&
    exactItems.some(
      (item) =>
        item.kind === "needs_input" &&
        item.evidence === "observed" &&
        !item.stale,
    )
  ) {
    return "meeting";
  }

  const isReviewableCompletion =
    isPersistentCompletion(task) ||
    (task.status.value === "completed" && task.status.evidence === "observed");
  if (
    isReviewableCompletion &&
    exactItems.some((item) => item.kind === "ready_for_review")
  ) {
    return "review";
  }

  return "desk";
}

export function stableTopDownVisualIdentity(taskId: string): number {
  let hash = 2166136261;
  for (let index = 0; index < taskId.length; index += 1) {
    hash ^= taskId.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0) % TOP_DOWN_AVATAR_VARIANT_COUNT;
}
