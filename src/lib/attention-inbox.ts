import type { EvidenceProvenance, NormalizedStatusValue } from "./domain";

export const ATTENTION_REVIEW_STORAGE_KEY = "coffice.attention-review.v2";
export const ATTENTION_REVIEW_LEGACY_STORAGE_KEY =
  "coffice.attention-review.v1";
export const ATTENTION_REVIEW_STATE_VERSION = 2 as const;

const INVALID_ATTENTION_REVIEW_BASELINE = new Date(0).toISOString();

const MAX_EVENT_KEY_LENGTH = 320;
const MAX_STORED_TIMESTAMP_LENGTH = 64;
export const MAX_ATTENTION_REVIEW_STORAGE_BYTES = 256 * 1024;

export type AttentionKind =
  | "needs_input"
  | "decision_needed"
  | "task_failed"
  | "verification_failed"
  | "plan_link_mismatch"
  | "plan_link_orphaned"
  | "project_review_due"
  | "blocked"
  | "ready_for_review";

export type AttentionDispositionKind =
  "baseline" | "reviewed" | "dismissed" | "needs_review";

export interface AttentionTaskStatus {
  value: NormalizedStatusValue;
  evidence: EvidenceProvenance;
  source?: string;
  timestamp: string | null;
  stale?: boolean;
}

export interface AttentionTask {
  id: string;
  title: string;
  updatedAt?: string;
  lastActivityAt?: string;
  status: AttentionTaskStatus;
}

export interface AttentionProject {
  id: string;
  name: string;
  tasks: readonly AttentionTask[];
  verificationReceipts?: readonly AttentionVerificationReceipt[];
  planLinkNotices?: readonly AttentionPlanLinkNotice[];
  reviewSchedule?: { nextReviewAt: string };
  decisionRequests?: readonly AttentionDecisionRequest[];
}

export interface AttentionDecisionRequest {
  id: string;
  createdAt: string;
  workItemId: string;
  workItemTitle: string;
  taskId?: string;
  verificationTarget?: AttentionVerificationReceipt["target"];
}

export interface AttentionPlanLinkNotice {
  kind: "plan_link_mismatch" | "plan_link_orphaned";
  taskId: string;
  taskTitle: string;
  attemptId: string;
  linkedProjectName: string;
  occurredAt: null;
}

export interface AttentionVerificationReceipt {
  id: string;
  state: "queued" | "running" | "passed" | "failed" | "unknown";
  completedAt?: string;
  target: {
    projectId: string;
    objectiveId: string;
    workItemId: string;
    attemptId: string;
    resultKey: { kind: "turn" | "operation" | "revision"; id: string };
  };
  workItemTitle: string;
  resultObservedAt: string;
  taskId?: string;
  taskTitle?: string;
}

export interface AttentionItem {
  eventKey: string;
  kind: AttentionKind;
  priority: number;
  projectId: string;
  projectName: string;
  taskId: string;
  openTaskId?: string;
  verificationTarget?: AttentionVerificationReceipt["target"];
  planProjectId?: string;
  taskTitle: string;
  occurredAt: string | null;
  status: NormalizedStatusValue;
  evidence: EvidenceProvenance;
  stale: boolean;
  reason: string;
  recommendedAction: string;
}

export function createProjectReviewAttentionItem(
  project: AttentionProject,
  referenceTime: number,
): AttentionItem | null {
  const nextReviewAt = project.reviewSchedule?.nextReviewAt;
  if (
    !validTimestamp(nextReviewAt) ||
    Date.parse(nextReviewAt) > referenceTime
  ) {
    return null;
  }
  return {
    eventKey: `project-review:${project.id}:${nextReviewAt}`.slice(
      0,
      MAX_EVENT_KEY_LENGTH,
    ),
    kind: "project_review_due",
    priority: 2,
    projectId: project.id,
    projectName: project.name,
    taskId: project.id,
    planProjectId: project.id,
    taskTitle: "Scheduled project review",
    occurredAt: nextReviewAt,
    status: "waiting_for_user",
    evidence: "observed",
    stale: false,
    reason: "Your scheduled project review is due.",
    recommendedAction: "Open the project plan",
  };
}

export function createDecisionRequestAttentionItem(
  project: AttentionProject,
  request: AttentionDecisionRequest,
): AttentionItem | null {
  if (!validTimestamp(request.createdAt)) return null;
  return {
    eventKey: `decision-request:${request.id}`.slice(0, MAX_EVENT_KEY_LENGTH),
    kind: "decision_needed",
    priority: 0,
    projectId: project.id,
    projectName: project.name,
    taskId: request.taskId ?? request.workItemId,
    ...(request.taskId ? { openTaskId: request.taskId } : {}),
    ...(request.verificationTarget
      ? { verificationTarget: request.verificationTarget }
      : {}),
    planProjectId: project.id,
    taskTitle: request.workItemTitle,
    occurredAt: request.createdAt,
    status: "waiting_for_user",
    evidence: "observed",
    stale: false,
    reason: "A decision you recorded is still open.",
    recommendedAction: request.verificationTarget
      ? "Review the exact result decision"
      : "Review the work item decision",
  };
}

export function createPlanLinkAttentionItem(
  project: AttentionProject,
  notice: AttentionPlanLinkNotice,
): AttentionItem | null {
  const mismatch = notice.kind === "plan_link_mismatch";
  return {
    eventKey:
      `plan-link:${notice.kind}:${notice.taskId}:${notice.attemptId}:${project.id}`.slice(
        0,
        MAX_EVENT_KEY_LENGTH,
      ),
    kind: notice.kind,
    priority: 1,
    projectId: project.id,
    projectName: project.name,
    taskId: notice.taskId,
    openTaskId: notice.taskId,
    taskTitle: notice.taskTitle,
    occurredAt: notice.occurredAt,
    status: "blocked",
    evidence: "observed",
    stale: false,
    reason: mismatch
      ? `Codex now assigns this task here, but its active plan link remains in ${notice.linkedProjectName}.`
      : `Codex now reports this task as unassigned, but its active plan link remains in ${notice.linkedProjectName}.`,
    recommendedAction: mismatch ? "Move plan link" : "Unlink from plan",
  };
}

export function createVerificationAttentionItem(
  project: AttentionProject,
  receipt: AttentionVerificationReceipt,
): AttentionItem | null {
  if (
    receipt.state !== "failed" ||
    receipt.target.projectId !== project.id ||
    !validTimestamp(receipt.completedAt) ||
    !validTimestamp(receipt.resultObservedAt)
  ) {
    return null;
  }
  return {
    eventKey: `verification:${receipt.id}`.slice(0, MAX_EVENT_KEY_LENGTH),
    kind: "verification_failed",
    priority: 1,
    projectId: project.id,
    projectName: project.name,
    taskId: receipt.taskId ?? receipt.target.attemptId,
    verificationTarget: receipt.target,
    taskTitle: receipt.taskTitle ?? receipt.workItemTitle,
    occurredAt: receipt.completedAt,
    status: "failed",
    evidence: "observed",
    stale: false,
    reason: "A quality check failed for this exact result.",
    recommendedAction: "Review the stored work result",
  };
}

export interface AttentionDisposition {
  kind: AttentionDispositionKind;
  at: string;
}

export interface AttentionReviewState {
  version: typeof ATTENTION_REVIEW_STATE_VERSION;
  initializedAt: string;
  dispositions: Record<string, AttentionDisposition>;
  snoozedUntil: Record<string, string>;
}

function validTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= MAX_STORED_TIMESTAMP_LENGTH &&
    Number.isFinite(Date.parse(value))
  );
}

function eventTimestamp(task: AttentionTask): string | null {
  return validTimestamp(task.status.timestamp) ? task.status.timestamp : null;
}

export function attentionEventKey(task: AttentionTask): string {
  const revision = eventTimestamp(task);
  const semanticStatus = isPersistentCompletion(task)
    ? "completed"
    : task.status.value;
  return `${task.id}:${semanticStatus}:${revision || "unknown"}`.slice(
    0,
    MAX_EVENT_KEY_LENGTH,
  );
}

function presentationForStatus(status: NormalizedStatusValue): {
  kind: AttentionKind;
  priority: number;
  reason: string;
  recommendedAction: string;
} | null {
  switch (status) {
    case "waiting_for_user":
      return {
        kind: "needs_input",
        priority: 0,
        reason: "Codex is waiting for your response.",
        recommendedAction: "Open the task and respond",
      };
    case "failed":
      return {
        kind: "task_failed",
        priority: 1,
        reason: "The task reported a failure.",
        recommendedAction: "Open the task and inspect the failure",
      };
    case "blocked":
      return {
        kind: "blocked",
        priority: 2,
        reason: "The task reported that it is blocked.",
        recommendedAction: "Open the task and unblock the work",
      };
    case "completed":
      return {
        kind: "ready_for_review",
        priority: 3,
        reason: "A new completed result is ready for review.",
        recommendedAction: "Review the result in Codex",
      };
    default:
      return null;
  }
}

export function isPersistentCompletion(task: AttentionTask): boolean {
  return (
    task.status.value === "idle" &&
    task.status.evidence === "inferred" &&
    (task.status.source === "session-jsonl:event_msg.task_complete" ||
      task.status.source === "session-jsonl:event_msg.turn_complete")
  );
}

export function createAttentionItem(
  project: AttentionProject,
  task: AttentionTask,
): AttentionItem | null {
  const persistentCompletion = isPersistentCompletion(task);
  const presentation = persistentCompletion
    ? presentationForStatus("completed")
    : presentationForStatus(task.status.value);
  if (
    !presentation ||
    (task.status.evidence !== "observed" && !persistentCompletion)
  ) {
    return null;
  }

  // A stale completion or failure is still a durable result. A stale waiting or
  // inferred blocked signal may already have been resolved, so it must not page
  // the user. An exact persisted goal block remains unresolved until a later
  // successful goal read proves otherwise; keep it visible but label the stale
  // confirmation plainly below.
  if (
    task.status.stale &&
    (task.status.value === "waiting_for_user" ||
      (task.status.value === "blocked" &&
        task.status.source !== "codex-app-server:thread/goal/get"))
  ) {
    return null;
  }

  const occurredAt = eventTimestamp(task);
  if (!occurredAt) return null;

  return {
    eventKey: attentionEventKey(task),
    ...presentation,
    ...(task.status.value === "blocked" &&
    task.status.stale &&
    task.status.source === "codex-app-server:thread/goal/get"
      ? {
          reason:
            "The task was last observed blocked; live confirmation is unavailable.",
          recommendedAction: "Open the task and confirm what is still needed",
        }
      : {}),
    priority:
      presentation.priority +
      (task.status.stale && task.status.value === "failed" ? 2 : 0),
    projectId: project.id,
    projectName: project.name,
    taskId: task.id,
    openTaskId: task.id,
    taskTitle: task.title,
    occurredAt,
    status: persistentCompletion ? "completed" : task.status.value,
    evidence: task.status.evidence,
    stale: Boolean(task.status.stale),
  };
}

function compareAttentionItems(left: AttentionItem, right: AttentionItem) {
  if (left.priority !== right.priority) return left.priority - right.priority;
  const leftTime = left.occurredAt ? Date.parse(left.occurredAt) : 0;
  const rightTime = right.occurredAt ? Date.parse(right.occurredAt) : 0;
  if (leftTime !== rightTime) return rightTime - leftTime;
  const projectOrder = left.projectName.localeCompare(right.projectName);
  if (projectOrder !== 0) return projectOrder;
  return left.taskTitle.localeCompare(right.taskTitle);
}

export function selectAttentionItems(
  projects: readonly AttentionProject[],
  state: AttentionReviewState,
  referenceTime: number,
  resolvedCompletionEventKeys: ReadonlySet<string> = new Set(),
): AttentionItem[] {
  const unique = new Map<string, AttentionItem>();
  for (const project of projects) {
    for (const task of project.tasks) {
      const item = createAttentionItem(project, task);
      if (!item) continue;
      if (
        item.kind === "ready_for_review" &&
        resolvedCompletionEventKeys.has(item.eventKey)
      ) {
        continue;
      }
      const disposition = state.dispositions[item.eventKey];
      if (disposition && disposition.kind !== "needs_review") continue;
      if (!disposition && isAttentionItemBaselined(item, state)) continue;
      const snoozedUntil = state.snoozedUntil[item.eventKey];
      if (
        validTimestamp(snoozedUntil) &&
        Date.parse(snoozedUntil) > referenceTime
      ) {
        continue;
      }
      unique.set(item.eventKey, item);
    }
    for (const request of project.decisionRequests ?? []) {
      const item = createDecisionRequestAttentionItem(project, request);
      if (!item || unique.has(item.eventKey)) continue;
      const disposition = state.dispositions[item.eventKey];
      if (disposition && disposition.kind !== "needs_review") continue;
      if (!disposition && isAttentionItemBaselined(item, state)) continue;
      const snoozedUntil = state.snoozedUntil[item.eventKey];
      if (
        validTimestamp(snoozedUntil) &&
        Date.parse(snoozedUntil) > referenceTime
      ) {
        continue;
      }
      unique.set(item.eventKey, item);
    }
    for (const receipt of project.verificationReceipts ?? []) {
      const item = createVerificationAttentionItem(project, receipt);
      if (!item) continue;
      const disposition = state.dispositions[item.eventKey];
      if (disposition && disposition.kind !== "needs_review") continue;
      const snoozedUntil = state.snoozedUntil[item.eventKey];
      if (
        validTimestamp(snoozedUntil) &&
        Date.parse(snoozedUntil) > referenceTime
      ) {
        continue;
      }
      unique.set(item.eventKey, item);
    }
    for (const notice of project.planLinkNotices ?? []) {
      const item = createPlanLinkAttentionItem(project, notice);
      if (!item) continue;
      const disposition = state.dispositions[item.eventKey];
      if (disposition && disposition.kind !== "needs_review") continue;
      const snoozedUntil = state.snoozedUntil[item.eventKey];
      if (
        validTimestamp(snoozedUntil) &&
        Date.parse(snoozedUntil) > referenceTime
      ) {
        continue;
      }
      unique.set(item.eventKey, item);
    }
    const scheduledReview = createProjectReviewAttentionItem(
      project,
      referenceTime,
    );
    if (scheduledReview) {
      const disposition = state.dispositions[scheduledReview.eventKey];
      const snoozedUntil = state.snoozedUntil[scheduledReview.eventKey];
      if (
        (!disposition || disposition.kind === "needs_review") &&
        (!validTimestamp(snoozedUntil) ||
          Date.parse(snoozedUntil) <= referenceTime)
      ) {
        unique.set(scheduledReview.eventKey, scheduledReview);
      }
    }
  }
  return [...unique.values()].sort(compareAttentionItems);
}

export function createInitialAttentionReviewState(
  now: string,
): AttentionReviewState {
  return {
    version: ATTENTION_REVIEW_STATE_VERSION,
    initializedAt: validTimestamp(now)
      ? now
      : INVALID_ATTENTION_REVIEW_BASELINE,
    dispositions: {},
    snoozedUntil: {},
  };
}

/**
 * Repairs the old invalid fallback baseline without touching a real historical
 * baseline or any per-event review receipts. The observation time must itself
 * be a usable post-epoch timestamp so one bad sentinel cannot become another.
 */
export function repairInvalidAttentionBaseline(
  state: AttentionReviewState,
  observedAt: string,
): AttentionReviewState {
  if (
    state.initializedAt !== INVALID_ATTENTION_REVIEW_BASELINE ||
    !validTimestamp(observedAt) ||
    Date.parse(observedAt) <= 0
  ) {
    return state;
  }
  return { ...state, initializedAt: observedAt };
}

export function isAttentionItemBaselined(
  item: AttentionItem,
  state: AttentionReviewState,
): boolean {
  const disposition = state.dispositions[item.eventKey];
  if (disposition?.kind === "baseline") return true;
  if (disposition) return false;
  return (
    item.kind === "ready_for_review" &&
    item.occurredAt !== null &&
    Date.parse(item.occurredAt) <= Date.parse(state.initializedAt)
  );
}

function serializedByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validEventKey(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_EVENT_KEY_LENGTH
  );
}

function completionTimestampFromEventKey(eventKey: string): number | null {
  const marker = ":completed:";
  const markerIndex = eventKey.lastIndexOf(marker);
  if (markerIndex < 0) return null;
  const timestamp = eventKey.slice(markerIndex + marker.length);
  return validTimestamp(timestamp) ? Date.parse(timestamp) : null;
}

interface StoredAttentionRecord {
  eventKey: string;
  disposition?: AttentionDisposition;
  snoozedUntil?: string;
}

function recordActivity(record: StoredAttentionRecord): number {
  const dispositionTime = record.disposition
    ? Date.parse(record.disposition.at)
    : 0;
  const snoozeTime = record.snoozedUntil ? Date.parse(record.snoozedUntil) : 0;
  return Math.max(dispositionTime, snoozeTime);
}

function recordPriority(
  record: StoredAttentionRecord,
  initializedAt: string,
): number {
  const completionTime = completionTimestampFromEventKey(record.eventKey);
  const resolvedCompletion =
    completionTime !== null &&
    completionTime > Date.parse(initializedAt) &&
    record.disposition &&
    record.disposition.kind !== "needs_review";
  if (resolvedCompletion) return 0;
  if (record.disposition?.kind === "needs_review") return 1;
  if (
    record.disposition?.kind === "reviewed" ||
    record.disposition?.kind === "dismissed" ||
    record.disposition?.kind === "baseline"
  ) {
    return 2;
  }
  return 3;
}

function sameAttentionReviewState(
  left: AttentionReviewState,
  right: AttentionReviewState,
): boolean {
  const topLevelKeys = Object.keys(left).sort();
  if (
    topLevelKeys.length !== 4 ||
    topLevelKeys[0] !== "dispositions" ||
    topLevelKeys[1] !== "initializedAt" ||
    topLevelKeys[2] !== "snoozedUntil" ||
    topLevelKeys[3] !== "version" ||
    left.version !== right.version ||
    left.initializedAt !== right.initializedAt
  ) {
    return false;
  }
  const leftDispositionKeys = Object.keys(left.dispositions);
  const rightDispositionKeys = Object.keys(right.dispositions);
  if (leftDispositionKeys.length !== rightDispositionKeys.length) return false;
  for (const eventKey of leftDispositionKeys) {
    const leftDisposition = left.dispositions[eventKey];
    const rightDisposition = right.dispositions[eventKey];
    if (
      !isRecord(leftDisposition) ||
      !rightDisposition ||
      Object.keys(leftDisposition).length !== 2 ||
      leftDisposition.kind !== rightDisposition.kind ||
      leftDisposition.at !== rightDisposition.at
    ) {
      return false;
    }
  }
  const leftSnoozeKeys = Object.keys(left.snoozedUntil);
  const rightSnoozeKeys = Object.keys(right.snoozedUntil);
  if (leftSnoozeKeys.length !== rightSnoozeKeys.length) return false;
  return leftSnoozeKeys.every(
    (eventKey) => left.snoozedUntil[eventKey] === right.snoozedUntil[eventKey],
  );
}

export function compactAttentionReviewState(
  state: AttentionReviewState,
  preferredEventKeys: ReadonlySet<string> = new Set(),
  pinnedEventKeys: ReadonlySet<string> = new Set(),
): AttentionReviewState {
  const records = new Map<string, StoredAttentionRecord>();
  for (const [eventKey, disposition] of Object.entries(state.dispositions)) {
    if (
      !validEventKey(eventKey) ||
      !isRecord(disposition) ||
      (disposition.kind !== "baseline" &&
        disposition.kind !== "reviewed" &&
        disposition.kind !== "dismissed" &&
        disposition.kind !== "needs_review") ||
      !validTimestamp(disposition.at)
    ) {
      continue;
    }
    records.set(eventKey, {
      eventKey,
      disposition: { kind: disposition.kind, at: disposition.at },
    });
  }
  for (const [eventKey, until] of Object.entries(state.snoozedUntil)) {
    if (!validEventKey(eventKey) || !validTimestamp(until)) continue;
    const record = records.get(eventKey) ?? { eventKey };
    // Older state could store a snooze without the needs-review marker. Keep
    // the explicit reopen semantics so the result returns after the snooze.
    record.disposition ??= {
      kind: "needs_review",
      at: state.initializedAt,
    };
    if (record.disposition.kind === "needs_review") {
      record.snoozedUntil = until;
    }
    records.set(eventKey, record);
  }

  const orderedRecords = [...records.values()].sort((left, right) => {
    const pinnedDifference =
      Number(pinnedEventKeys.has(right.eventKey)) -
      Number(pinnedEventKeys.has(left.eventKey));
    if (pinnedDifference !== 0) return pinnedDifference;
    const priorityDifference =
      recordPriority(left, state.initializedAt) -
      recordPriority(right, state.initializedAt);
    if (priorityDifference !== 0) return priorityDifference;
    const preferredDifference =
      Number(preferredEventKeys.has(right.eventKey)) -
      Number(preferredEventKeys.has(left.eventKey));
    if (preferredDifference !== 0) return preferredDifference;
    const activityDifference = recordActivity(right) - recordActivity(left);
    if (activityDifference !== 0) return activityDifference;
    return left.eventKey.localeCompare(right.eventKey);
  });

  const compacted: AttentionReviewState = {
    version: ATTENTION_REVIEW_STATE_VERSION,
    initializedAt: state.initializedAt,
    dispositions: {},
    snoozedUntil: {},
  };
  let currentBytes = serializedByteLength(JSON.stringify(compacted));
  let dispositionCount = 0;
  let snoozeCount = 0;

  for (const record of orderedRecords) {
    if (!record.disposition) continue;
    const dispositionBytes =
      (dispositionCount > 0 ? 1 : 0) +
      serializedByteLength(JSON.stringify(record.eventKey)) +
      1 +
      serializedByteLength(JSON.stringify(record.disposition));
    const snoozeBytes = record.snoozedUntil
      ? (snoozeCount > 0 ? 1 : 0) +
        serializedByteLength(JSON.stringify(record.eventKey)) +
        1 +
        serializedByteLength(JSON.stringify(record.snoozedUntil))
      : 0;

    if (
      currentBytes + dispositionBytes + snoozeBytes <=
      MAX_ATTENTION_REVIEW_STORAGE_BYTES
    ) {
      compacted.dispositions[record.eventKey] = record.disposition;
      dispositionCount += 1;
      if (record.snoozedUntil) {
        compacted.snoozedUntil[record.eventKey] = record.snoozedUntil;
        snoozeCount += 1;
      }
      currentBytes += dispositionBytes + snoozeBytes;
      continue;
    }

    // If the full snooze record no longer fits, retain needs-review by itself.
    // Showing the item early is safer than silently losing it after expiry.
    if (
      record.snoozedUntil &&
      currentBytes + dispositionBytes <= MAX_ATTENTION_REVIEW_STORAGE_BYTES
    ) {
      compacted.dispositions[record.eventKey] = record.disposition;
      dispositionCount += 1;
      currentBytes += dispositionBytes;
    }
  }
  return sameAttentionReviewState(state, compacted) ? state : compacted;
}

export function pruneAttentionReviewState(
  state: AttentionReviewState,
  projects: readonly AttentionProject[],
): AttentionReviewState {
  // A roster can be temporarily partial while projects refresh. Removing a
  // receipt just because its task is absent for one render resurrects the same
  // result when the task returns, so roster membership is not a safe GC signal.
  const currentEventKeys = new Set<string>();
  for (const project of projects) {
    for (const task of project.tasks) {
      const item = createAttentionItem(project, task);
      if (item) currentEventKeys.add(item.eventKey);
    }
    for (const receipt of project.verificationReceipts ?? []) {
      const item = createVerificationAttentionItem(project, receipt);
      if (item) currentEventKeys.add(item.eventKey);
    }
    for (const notice of project.planLinkNotices ?? []) {
      const item = createPlanLinkAttentionItem(project, notice);
      if (item) currentEventKeys.add(item.eventKey);
    }
    for (const request of project.decisionRequests ?? []) {
      const item = createDecisionRequestAttentionItem(project, request);
      if (item) currentEventKeys.add(item.eventKey);
    }
    if (project.reviewSchedule) {
      currentEventKeys.add(
        `project-review:${project.id}:${project.reviewSchedule.nextReviewAt}`.slice(
          0,
          MAX_EVENT_KEY_LENGTH,
        ),
      );
    }
  }
  return compactAttentionReviewState(state, currentEventKeys);
}

export function resolvedPlanLinkEventKeys(
  state: AttentionReviewState,
  projects: readonly AttentionProject[],
): string[] {
  const current = new Set(
    projects.flatMap((project) =>
      (project.planLinkNotices ?? []).flatMap((notice) => {
        const item = createPlanLinkAttentionItem(project, notice);
        return item ? [item.eventKey] : [];
      }),
    ),
  );
  return [
    ...new Set([
      ...Object.keys(state.dispositions),
      ...Object.keys(state.snoozedUntil),
    ]),
  ].filter(
    (eventKey) => eventKey.startsWith("plan-link:") && !current.has(eventKey),
  );
}

export function clearAttentionEvent(
  state: AttentionReviewState,
  eventKey: string,
): AttentionReviewState {
  const dispositions = { ...state.dispositions };
  const snoozedUntil = { ...state.snoozedUntil };
  delete dispositions[eventKey];
  delete snoozedUntil[eventKey];
  return compactAttentionReviewState({ ...state, dispositions, snoozedUntil });
}

export function parseAttentionReviewState(
  raw: string | null,
): AttentionReviewState | null {
  if (!raw || serializedByteLength(raw) > MAX_ATTENTION_REVIEW_STORAGE_BYTES) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (
      !isRecord(parsed) ||
      (parsed.version !== 1 &&
        parsed.version !== ATTENTION_REVIEW_STATE_VERSION) ||
      !validTimestamp(parsed.initializedAt) ||
      !isRecord(parsed.dispositions) ||
      (parsed.version === ATTENTION_REVIEW_STATE_VERSION &&
        !isRecord(parsed.snoozedUntil)) ||
      (parsed.snoozedUntil !== undefined && !isRecord(parsed.snoozedUntil))
    ) {
      return null;
    }

    const dispositions: Record<string, AttentionDisposition> = {};
    for (const [key, value] of Object.entries(parsed.dispositions)) {
      if (!validEventKey(key) || !isRecord(value)) {
        continue;
      }
      const candidate = value;
      if (
        (candidate.kind === "baseline" ||
          candidate.kind === "reviewed" ||
          candidate.kind === "dismissed" ||
          candidate.kind === "needs_review") &&
        validTimestamp(candidate.at)
      ) {
        dispositions[key] = {
          kind: candidate.kind,
          at: candidate.at,
        };
      }
    }

    const snoozedUntil: Record<string, string> = {};
    for (const [key, value] of Object.entries(
      (parsed.snoozedUntil as Record<string, unknown> | undefined) ?? {},
    )) {
      if (validEventKey(key) && validTimestamp(value)) {
        snoozedUntil[key] = value;
      }
    }

    return compactAttentionReviewState({
      version: ATTENTION_REVIEW_STATE_VERSION,
      initializedAt: parsed.initializedAt,
      dispositions,
      snoozedUntil,
    });
  } catch {
    return null;
  }
}

export function serializeAttentionReviewState(
  state: AttentionReviewState,
): string {
  return JSON.stringify(compactAttentionReviewState(state));
}

export function setAttentionDisposition(
  state: AttentionReviewState,
  eventKey: string,
  kind: AttentionDispositionKind,
  now: string,
): AttentionReviewState {
  if (!validEventKey(eventKey) || !validTimestamp(now)) return state;
  const snoozedUntil = { ...state.snoozedUntil };
  delete snoozedUntil[eventKey];
  return compactAttentionReviewState({
    ...state,
    dispositions: {
      ...state.dispositions,
      [eventKey]: { kind, at: now },
    },
    snoozedUntil,
  });
}

export function snoozeAttentionEvent(
  state: AttentionReviewState,
  eventKey: string,
  until: string,
  now: string,
): AttentionReviewState {
  if (
    !validEventKey(eventKey) ||
    !validTimestamp(until) ||
    !validTimestamp(now) ||
    Date.parse(until) <= Date.parse(now)
  ) {
    return state;
  }
  return compactAttentionReviewState({
    ...state,
    dispositions: {
      ...state.dispositions,
      [eventKey]: { kind: "needs_review", at: now },
    },
    snoozedUntil: { ...state.snoozedUntil, [eventKey]: until },
  });
}

export function restoreAttentionEvent(
  state: AttentionReviewState,
  eventKey: string,
  now: string,
): AttentionReviewState {
  if (!validEventKey(eventKey) || !validTimestamp(now)) return state;
  const snoozedUntil = { ...state.snoozedUntil };
  delete snoozedUntil[eventKey];
  return compactAttentionReviewState({
    ...state,
    dispositions: {
      ...state.dispositions,
      [eventKey]: { kind: "needs_review", at: now },
    },
    snoozedUntil,
  });
}
