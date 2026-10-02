import {
  ATTENTION_REVIEW_STATE_VERSION,
  compactAttentionReviewState,
  createInitialAttentionReviewState,
  MAX_ATTENTION_REVIEW_STORAGE_BYTES,
  repairInvalidAttentionBaseline,
  type AttentionDisposition,
  type AttentionDispositionKind,
  type AttentionReviewState,
} from "./attention-inbox";

export const COFFICE_WORKSPACE_SCHEMA_VERSION = 12 as const;
export const MAX_COFFICE_WORKSPACE_BYTES = 2 * 1024 * 1024;
export const MAX_COFFICE_WORKSPACE_MUTATION_BYTES =
  MAX_COFFICE_WORKSPACE_BYTES + 64 * 1024;
// Defensive parser bounds keep one malformed entry from monopolizing the
// workspace; the existing 2 MiB serialized-file limit remains authoritative.
export const MAX_REVIEW_ASSESSMENT_TEXT_LENGTH = 2_000;
export const MAX_REVIEW_ASSESSMENT_LIST_ENTRIES = 64;
export const MAX_REVIEW_ASSESSMENT_TOTAL_TEXT_LENGTH = 16_000;
export const MAX_PROJECT_DECISION_STATEMENT_LENGTH = 1_000;
export const MAX_PROJECT_DECISION_CONTEXT_LENGTH = 2_000;
export const MAX_DEFINITION_OF_DONE_ENTRIES = 64;
export const MAX_DEFINITION_OF_DONE_ENTRY_LENGTH = 1_000;
export const MAX_DEFINITION_OF_DONE_TOTAL_LENGTH = 16_000;
export const MAX_PROJECT_RULES_ENTRIES = 64;
export const MAX_PROJECT_RULE_ENTRY_LENGTH = 1_000;
export const MAX_PROJECT_RULES_TOTAL_LENGTH = 16_000;
export const MAX_DECISION_REQUEST_TEXT_LENGTH = 2_000;

const LIMITS = {
  projects: 256,
  objectivesPerProject: 256,
  workItemsPerObjective: 1_024,
  attemptsPerWorkItem: 128,
  relationshipsPerWorkItem: 256,
  resultCyclesPerAttempt: 256,
  evidence: 4_096,
  reviewAssessments: 4_096,
  decisionRequests: 4_096,
  projectDecisionEvents: 4_096,
  attentionRecords: 4_096,
  verificationReceipts: 1_024,
  checksPerVerification: 64,
  id: 160,
  version: 80,
  resultKeyId: 320,
  title: 320,
  expectedOutcome: 1_000,
  note: 2_000,
  reference: 1_024,
  timestamp: 64,
} as const;

export type ObjectiveStatus = "active" | "paused" | "achieved";
export type WorkItemStatus =
  | "planned"
  | "in_progress"
  | "blocked"
  | "ready_for_review"
  | "accepted"
  | "cancelled";
export type ResultDecisionKind = "accepted" | "redirected" | "rejected";
export const PROJECT_QUALITY_BAR_PROFILE_IDS = [
  "test",
  "typecheck",
  "lint",
  "build",
] as const;
export type ProjectQualityBarProfileId =
  (typeof PROJECT_QUALITY_BAR_PROFILE_IDS)[number];

export interface ProjectQualityBar {
  profileId: ProjectQualityBarProfileId;
  profileVersion: "1";
}

export const PROJECT_CONTEXT_CONCERNS = ["stale", "contradictory"] as const;
export type ProjectContextConcern = (typeof PROJECT_CONTEXT_CONCERNS)[number];

export interface ProjectContextReview {
  concerns: ProjectContextConcern[];
  note?: string;
  markedAt: string;
  authorship: "user";
}

export const MAX_PROJECT_REVIEW_REPEAT_DAYS = 3_650;

export interface ProjectReviewSchedule {
  nextReviewAt: string;
  repeatEveryDays?: number;
  configuredAt: string;
  lastReviewedAt?: string;
  authorship: "user";
}

export interface ResultDecision {
  kind: ResultDecisionKind;
  decidedAt: string;
  note?: string;
}

export interface ResultCycleReview {
  reviewedAt: string;
  decision?: ResultDecision;
}

export interface CodexResultKey {
  kind: "turn" | "operation" | "revision";
  id: string;
}

export interface CodexResultCycle {
  key: CodexResultKey;
  observedAt: string;
  review?: ResultCycleReview;
}

export interface CodexTaskAttempt {
  id: string;
  codexTaskId: string;
  relationship:
    "primary" | "retry" | "alternative" | "handoff" | "continuation";
  linkedAt: string;
  unlinkedAt?: string;
  observeResultsAfterKey?: CodexResultKey;
  resultCycles: CodexResultCycle[];
}

export interface TaskLinkLocation {
  projectId: string;
  objectiveId: string;
  workItemId: string;
  attemptId: string;
}

export type WorkItemRelationshipKind = "depends_on" | "hands_off_to";

export interface WorkItemRelationship {
  kind: WorkItemRelationshipKind;
  targetObjectiveId: string;
  targetWorkItemId: string;
}

export interface WorkItem {
  id: string;
  title: string;
  expectedOutcome: string;
  definitionOfDone?: string[];
  relationships?: WorkItemRelationship[];
  status: WorkItemStatus;
  createdAt: string;
  updatedAt: string;
  attempts: CodexTaskAttempt[];
}

export interface Objective {
  id: string;
  title: string;
  expectedOutcome?: string;
  status: ObjectiveStatus;
  createdAt: string;
  updatedAt: string;
  workItems: WorkItem[];
}

export interface WorkspaceProject {
  id: string;
  title: string;
  rules?: string[];
  qualityBars?: ProjectQualityBar[];
  contextReview?: ProjectContextReview;
  reviewSchedule?: ProjectReviewSchedule;
  createdAt: string;
  updatedAt: string;
  objectives: Objective[];
}

export type ProjectDecisionSupersessionKind = "correction" | "replacement";

interface ProjectDecisionEventBase {
  id: string;
  projectId: string;
  recordedAt: string;
  authorship: "user";
}

export interface ProjectDecisionRecordedEvent extends ProjectDecisionEventBase {
  action: "recorded";
  statement: string;
  context?: string;
}

export interface ProjectDecisionSupersededEvent extends ProjectDecisionEventBase {
  action: "superseded";
  supersedesId: string;
  supersessionKind: ProjectDecisionSupersessionKind;
  statement: string;
  context?: string;
}

export interface ProjectDecisionWithdrawnEvent extends ProjectDecisionEventBase {
  action: "withdrawn";
  supersedesId: string;
  reason?: string;
}

export type ProjectDecisionEvent =
  | ProjectDecisionRecordedEvent
  | ProjectDecisionSupersededEvent
  | ProjectDecisionWithdrawnEvent;

export type ActiveProjectDecisionEvent =
  ProjectDecisionRecordedEvent | ProjectDecisionSupersededEvent;

export type EvidenceKind =
  | "task_lifecycle"
  | "action"
  | "verification"
  | "changeset"
  | "repository"
  | "risk"
  | "decision";
export type EvidenceOutcome = "passed" | "failed" | "neutral";

export interface EvidenceProvenance {
  source: "codex" | "coffice" | "user";
  reference?: string;
}

export interface EvidenceRecord {
  id: string;
  kind: EvidenceKind;
  outcome: EvidenceOutcome;
  summary: string;
  recordedAt: string;
  projectId: string;
  objectiveId?: string;
  workItemId?: string;
  attemptId?: string;
  resultKey?: CodexResultKey;
  decisionKind?: ResultDecisionKind;
  provenance: EvidenceProvenance;
}

export interface WorkspaceMigrations {
  attentionReviewV2ImportedAt?: string;
}

export interface WorkspaceMutationReceipt {
  id: string;
  hash: string;
  revision: number;
  appliedAt: string;
}

export interface WorkItemReviewAssessmentTarget {
  projectId: string;
  objectiveId: string;
  workItemId: string;
}

export interface ResultReviewAssessmentTarget extends WorkItemReviewAssessmentTarget {
  attemptId: string;
  resultKey: CodexResultKey;
}

export type ReviewAssessmentTarget =
  WorkItemReviewAssessmentTarget | ResultReviewAssessmentTarget;

export type ReviewNextActionKind =
  | "open_in_codex"
  | "send_follow_up"
  | "request_review"
  | "run_quality_check"
  | "accept_result"
  | "redirect_result"
  | "reject_result";

export interface ReviewNextAction {
  kind: ReviewNextActionKind;
  note?: string;
}

export interface ReviewAssessmentDraft {
  target: ReviewAssessmentTarget;
  reviewSummary?: string;
  risks: string[];
  uncertainties: string[];
  blockedDecisions: string[];
  nextAction?: ReviewNextAction;
}

export interface ReviewAssessment extends ReviewAssessmentDraft {
  authorship: "user";
  updatedAt: string;
}

export interface DecisionRequestDraft {
  id: string;
  target: ReviewAssessmentTarget;
  prompt: string;
}

export interface DecisionRequest extends DecisionRequestDraft {
  authorship: "user";
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
  resolution?: string;
}

export interface CofficeWorkspace {
  schemaVersion: typeof COFFICE_WORKSPACE_SCHEMA_VERSION;
  revision: number;
  createdAt: string;
  updatedAt: string;
  projects: WorkspaceProject[];
  projectDecisionEvents: ProjectDecisionEvent[];
  attentionReview: AttentionReviewState;
  reviewAssessments: ReviewAssessment[];
  decisionRequests: DecisionRequest[];
  evidence: EvidenceRecord[];
  migrations: WorkspaceMigrations;
  mutationReceipts: WorkspaceMutationReceipt[];
  verificationReceipts: VerificationReceipt[];
}

export type VerificationState =
  "queued" | "running" | "passed" | "failed" | "unknown";

export interface VerificationTarget {
  projectId: string;
  objectiveId: string;
  workItemId: string;
  attemptId: string;
  resultKey: CodexResultKey;
}

export interface VerificationProfileRef {
  id: string;
  version: string;
}

export interface VerificationCheckRef {
  id: string;
  version: string;
}

export interface VerificationCheckReceipt extends VerificationCheckRef {
  state: VerificationState;
  queuedAt: string;
  startedAt?: string;
  completedAt?: string;
  failureKind?: VerificationFailureKind;
  exitCode?: number;
}

export type VerificationFailureKind = "exit" | "timeout" | "launch";

export interface VerificationReceipt {
  id: string;
  idempotencyKey: string;
  requestHash: string;
  target: VerificationTarget;
  profile: VerificationProfileRef;
  checks: VerificationCheckReceipt[];
  state: VerificationState;
  queuedAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface VerificationStartRequest {
  id: string;
  idempotencyKey: string;
  target: VerificationTarget;
  profile: VerificationProfileRef;
  checks: VerificationCheckRef[];
}

export interface VerificationCheckTransition {
  check: VerificationCheckRef;
  state: Exclude<VerificationState, "queued">;
  failureKind?: VerificationFailureKind;
  exitCode?: number;
}

export type WorkspaceMutation =
  | { type: "project.upsert"; project: WorkspaceProject }
  | { type: "project.remove"; projectId: string }
  | { type: "project.rules.set"; projectId: string; rules: string[] }
  | {
      type: "project.qualityBars.set";
      projectId: string;
      qualityBars: ProjectQualityBar[];
    }
  | {
      type: "project.contextReview.set";
      projectId: string;
      concerns: ProjectContextConcern[];
      note?: string;
    }
  | { type: "project.contextReview.clear"; projectId: string }
  | {
      type: "project.reviewSchedule.set";
      projectId: string;
      nextReviewAt: string;
      repeatEveryDays?: number;
    }
  | { type: "project.reviewSchedule.complete"; projectId: string }
  | { type: "project.reviewSchedule.clear"; projectId: string }
  | {
      type: "projectDecision.record";
      id: string;
      projectId: string;
      statement: string;
      context?: string;
    }
  | {
      type: "projectDecision.supersede";
      id: string;
      projectId: string;
      supersedesId: string;
      supersessionKind: ProjectDecisionSupersessionKind;
      statement: string;
      context?: string;
    }
  | {
      type: "projectDecision.withdraw";
      id: string;
      projectId: string;
      supersedesId: string;
      reason?: string;
    }
  | { type: "objective.upsert"; projectId: string; objective: Objective }
  | { type: "objective.remove"; projectId: string; objectiveId: string }
  | {
      type: "workItem.upsert";
      projectId: string;
      objectiveId: string;
      workItem: WorkItem;
    }
  | {
      type: "workItem.definitionOfDone.set";
      projectId: string;
      objectiveId: string;
      workItemId: string;
      definitionOfDone: string[];
    }
  | {
      type: "workItem.relationships.set";
      projectId: string;
      objectiveId: string;
      workItemId: string;
      relationships: WorkItemRelationship[];
    }
  | {
      type: "workItem.remove";
      projectId: string;
      objectiveId: string;
      workItemId: string;
    }
  | {
      type: "workItem.reorder";
      projectId: string;
      objectiveId: string;
      orderedWorkItemIds: string[];
    }
  | {
      type: "attempt.upsert";
      projectId: string;
      objectiveId: string;
      workItemId: string;
      attempt: CodexTaskAttempt;
    }
  | {
      type: "taskLink.move";
      codexTaskId: string;
      from: TaskLinkLocation;
      to: TaskLinkLocation;
      movedAt: string;
      baselineResultKey?: CodexResultKey;
    }
  | {
      type: "taskLink.unlink";
      codexTaskId: string;
      from: TaskLinkLocation;
      unlinkedAt: string;
    }
  | {
      type: "result.upsert";
      projectId: string;
      objectiveId: string;
      workItemId: string;
      attemptId: string;
      result: Omit<CodexResultCycle, "review">;
    }
  | {
      type: "result.review";
      projectId: string;
      objectiveId: string;
      workItemId: string;
      attemptId: string;
      resultKey: CodexResultKey;
      reviewedAt: string;
    }
  | {
      type: "result.decide";
      projectId: string;
      objectiveId: string;
      workItemId: string;
      attemptId: string;
      resultKey: CodexResultKey;
      decision: ResultDecision;
      evidence: EvidenceRecord;
    }
  | { type: "evidence.append"; record: EvidenceRecord }
  | { type: "attention.update"; state: AttentionReviewState }
  | { type: "attention.replace"; state: AttentionReviewState }
  | {
      type: "attention.event";
      eventKey: string;
      disposition: AttentionDisposition | null;
      snoozedUntil: string | null;
    }
  | {
      type: "attention.import";
      state: AttentionReviewState;
      importedAt: string;
    }
  | { type: "assessment.set"; assessment: ReviewAssessmentDraft }
  | { type: "assessment.clear"; target: ReviewAssessmentTarget }
  | { type: "decisionRequest.create"; request: DecisionRequestDraft }
  | { type: "decisionRequest.update"; id: string; prompt: string }
  | { type: "decisionRequest.resolve"; id: string; resolution?: string }
  | { type: "decisionRequest.reopen"; id: string }
  | { type: "decisionRequest.remove"; id: string };

export class CofficeWorkspaceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CofficeWorkspaceValidationError";
  }
}

function fail(path: string, message: string): never {
  throw new CofficeWorkspaceValidationError(`${path}: ${message}`);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(path, "expected an object");
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  path: string,
) {
  for (const key of required) if (!(key in value)) fail(path, `missing ${key}`);
  const permitted = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!permitted.has(key)) fail(path, `unknown field ${key}`);
  }
}

function boundedString(value: unknown, max: number, path: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max) {
    fail(path, `expected 1-${max} characters`);
  }
  return value;
}

function timestamp(value: unknown, path: string): string {
  const result = boundedString(value, LIMITS.timestamp, path);
  if (!Number.isFinite(Date.parse(result))) fail(path, "invalid timestamp");
  return result;
}

function oneOf<T extends string>(
  value: unknown,
  choices: readonly T[],
  path: string,
): T {
  if (typeof value !== "string" || !choices.includes(value as T)) {
    fail(path, `expected one of ${choices.join(", ")}`);
  }
  return value as T;
}

function boundedArray(value: unknown, max: number, path: string): unknown[] {
  if (!Array.isArray(value) || value.length > max) {
    fail(path, `expected an array with at most ${max} entries`);
  }
  return value;
}

function parseDefinitionOfDone(
  value: unknown,
  path: string,
  allowEmpty: boolean,
): string[] {
  const entries = boundedArray(value, MAX_DEFINITION_OF_DONE_ENTRIES, path);
  if (!allowEmpty && entries.length === 0) {
    fail(path, "expected at least one entry when present");
  }
  const normalized = entries.map((entry, index) => {
    if (typeof entry !== "string") {
      fail(`${path}[${index}]`, "expected text");
    }
    const text = entry.replace(/\r\n?/g, "\n").trim();
    if (!text || text.length > MAX_DEFINITION_OF_DONE_ENTRY_LENGTH) {
      fail(
        `${path}[${index}]`,
        `expected 1-${MAX_DEFINITION_OF_DONE_ENTRY_LENGTH} normalized characters`,
      );
    }
    return text;
  });
  const total = normalized.reduce((sum, entry) => sum + entry.length, 0);
  if (total > MAX_DEFINITION_OF_DONE_TOTAL_LENGTH) {
    fail(
      path,
      `expected at most ${MAX_DEFINITION_OF_DONE_TOTAL_LENGTH} normalized characters in total`,
    );
  }
  return normalized;
}

function parseProjectRules(
  value: unknown,
  path: string,
  allowEmpty: boolean,
): string[] {
  const entries = boundedArray(value, MAX_PROJECT_RULES_ENTRIES, path);
  if (!allowEmpty && entries.length === 0) {
    fail(path, "expected at least one entry when present");
  }
  const normalized = entries.map((entry, index) => {
    if (typeof entry !== "string") fail(`${path}[${index}]`, "expected text");
    const text = entry.replace(/\r\n?/g, "\n").trim();
    if (!text || text.length > MAX_PROJECT_RULE_ENTRY_LENGTH) {
      fail(
        `${path}[${index}]`,
        `expected 1-${MAX_PROJECT_RULE_ENTRY_LENGTH} normalized characters`,
      );
    }
    return text;
  });
  if (
    normalized.reduce((sum, entry) => sum + entry.length, 0) >
    MAX_PROJECT_RULES_TOTAL_LENGTH
  ) {
    fail(
      path,
      `expected at most ${MAX_PROJECT_RULES_TOTAL_LENGTH} normalized characters in total`,
    );
  }
  return normalized;
}

function parseProjectQualityBars(
  value: unknown,
  path: string,
  allowEmpty: boolean,
): ProjectQualityBar[] {
  const entries = boundedArray(
    value,
    PROJECT_QUALITY_BAR_PROFILE_IDS.length,
    path,
  );
  if (!allowEmpty && entries.length === 0) {
    fail(path, "expected at least one entry when present");
  }
  const parsed = entries.map((entry, index) => {
    const source = record(entry, `${path}[${index}]`);
    exactKeys(source, ["profileId", "profileVersion"], [], `${path}[${index}]`);
    const profileId = oneOf(
      source.profileId,
      PROJECT_QUALITY_BAR_PROFILE_IDS,
      `${path}[${index}].profileId`,
    );
    if (source.profileVersion !== "1") {
      fail(`${path}[${index}].profileVersion`, "expected version 1");
    }
    return { profileId, profileVersion: "1" as const };
  });
  const identities = new Set(parsed.map((bar) => bar.profileId));
  if (identities.size !== parsed.length) {
    fail(path, "duplicate quality-bar profile");
  }
  const canonical = PROJECT_QUALITY_BAR_PROFILE_IDS.filter((profileId) =>
    identities.has(profileId),
  );
  if (
    canonical.some((profileId, index) => parsed[index]?.profileId !== profileId)
  ) {
    fail(path, "quality-bar profiles must use canonical profile order");
  }
  return parsed;
}

function parseProjectContextConcerns(
  value: unknown,
  path: string,
): ProjectContextConcern[] {
  const entries = boundedArray(value, PROJECT_CONTEXT_CONCERNS.length, path);
  if (entries.length === 0) fail(path, "expected at least one concern");
  const parsed = entries.map((entry, index) =>
    oneOf(entry, PROJECT_CONTEXT_CONCERNS, `${path}[${index}]`),
  );
  const identities = new Set(parsed);
  if (identities.size !== parsed.length)
    fail(path, "duplicate context concern");
  const canonical = PROJECT_CONTEXT_CONCERNS.filter((concern) =>
    identities.has(concern),
  );
  if (canonical.some((concern, index) => parsed[index] !== concern)) {
    fail(path, "context concerns must use canonical order");
  }
  return parsed;
}

function normalizedOptionalProjectContextNote(
  value: unknown,
  path: string,
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") fail(path, "expected text");
  const note = value.replace(/\r\n?/g, "\n").trim();
  if (!note || note.length > LIMITS.note) {
    fail(path, `expected 1-${LIMITS.note} normalized characters`);
  }
  return note;
}

function parseProjectContextReview(
  value: unknown,
  path: string,
): ProjectContextReview {
  const source = record(value, path);
  exactKeys(source, ["concerns", "markedAt", "authorship"], ["note"], path);
  if (source.authorship !== "user") {
    fail(`${path}.authorship`, "expected user authorship");
  }
  const note = normalizedOptionalProjectContextNote(
    source.note,
    `${path}.note`,
  );
  return {
    concerns: parseProjectContextConcerns(source.concerns, `${path}.concerns`),
    ...(note ? { note } : {}),
    markedAt: timestamp(source.markedAt, `${path}.markedAt`),
    authorship: "user",
  };
}

function projectReviewRepeatDays(value: unknown, path: string): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 1 ||
    (value as number) > MAX_PROJECT_REVIEW_REPEAT_DAYS
  ) {
    fail(path, `expected 1-${MAX_PROJECT_REVIEW_REPEAT_DAYS} whole days`);
  }
  return value as number;
}

function parseProjectReviewSchedule(
  value: unknown,
  path: string,
): ProjectReviewSchedule {
  const source = record(value, path);
  exactKeys(
    source,
    ["nextReviewAt", "configuredAt", "authorship"],
    ["repeatEveryDays", "lastReviewedAt"],
    path,
  );
  if (source.authorship !== "user") {
    fail(`${path}.authorship`, "expected user authorship");
  }
  return {
    nextReviewAt: timestamp(source.nextReviewAt, `${path}.nextReviewAt`),
    ...(source.repeatEveryDays === undefined
      ? {}
      : {
          repeatEveryDays: projectReviewRepeatDays(
            source.repeatEveryDays,
            `${path}.repeatEveryDays`,
          ),
        }),
    configuredAt: timestamp(source.configuredAt, `${path}.configuredAt`),
    ...(source.lastReviewedAt === undefined
      ? {}
      : {
          lastReviewedAt: timestamp(
            source.lastReviewedAt,
            `${path}.lastReviewedAt`,
          ),
        }),
    authorship: "user",
  };
}

function uniqueIds<T extends { id: string }>(items: T[], path: string): T[] {
  const ids = new Set<string>();
  for (const item of items) {
    if (ids.has(item.id)) fail(path, `duplicate id ${item.id}`);
    ids.add(item.id);
  }
  return items;
}

function meaningfulProjectDecisionText(
  value: unknown,
  max: number,
  path: string,
): string {
  const parsed = boundedString(value, max, path);
  if (parsed.trim().length === 0) fail(path, "expected meaningful text");
  return parsed;
}

function parseProjectDecisionEvent(
  value: unknown,
  path: string,
): ProjectDecisionEvent {
  const source = record(value, path);
  const action = oneOf(
    source.action,
    ["recorded", "superseded", "withdrawn"],
    `${path}.action`,
  );
  const base = {
    id: structuralIdentifier(source.id, LIMITS.id, `${path}.id`),
    projectId: boundedString(source.projectId, LIMITS.id, `${path}.projectId`),
    recordedAt: timestamp(source.recordedAt, `${path}.recordedAt`),
    authorship: oneOf(source.authorship, ["user"], `${path}.authorship`),
  } as const;
  if (action === "recorded") {
    exactKeys(
      source,
      ["id", "projectId", "action", "statement", "recordedAt", "authorship"],
      ["context"],
      path,
    );
    return {
      ...base,
      action,
      statement: meaningfulProjectDecisionText(
        source.statement,
        MAX_PROJECT_DECISION_STATEMENT_LENGTH,
        `${path}.statement`,
      ),
      ...(source.context === undefined
        ? {}
        : {
            context: meaningfulProjectDecisionText(
              source.context,
              MAX_PROJECT_DECISION_CONTEXT_LENGTH,
              `${path}.context`,
            ),
          }),
    };
  }
  if (action === "superseded") {
    exactKeys(
      source,
      [
        "id",
        "projectId",
        "action",
        "supersedesId",
        "supersessionKind",
        "statement",
        "recordedAt",
        "authorship",
      ],
      ["context"],
      path,
    );
    return {
      ...base,
      action,
      supersedesId: structuralIdentifier(
        source.supersedesId,
        LIMITS.id,
        `${path}.supersedesId`,
      ),
      supersessionKind: oneOf(
        source.supersessionKind,
        ["correction", "replacement"],
        `${path}.supersessionKind`,
      ),
      statement: meaningfulProjectDecisionText(
        source.statement,
        MAX_PROJECT_DECISION_STATEMENT_LENGTH,
        `${path}.statement`,
      ),
      ...(source.context === undefined
        ? {}
        : {
            context: meaningfulProjectDecisionText(
              source.context,
              MAX_PROJECT_DECISION_CONTEXT_LENGTH,
              `${path}.context`,
            ),
          }),
    };
  }
  exactKeys(
    source,
    ["id", "projectId", "action", "supersedesId", "recordedAt", "authorship"],
    ["reason"],
    path,
  );
  return {
    ...base,
    action,
    supersedesId: structuralIdentifier(
      source.supersedesId,
      LIMITS.id,
      `${path}.supersedesId`,
    ),
    ...(source.reason === undefined
      ? {}
      : {
          reason: meaningfulProjectDecisionText(
            source.reason,
            MAX_PROJECT_DECISION_CONTEXT_LENGTH,
            `${path}.reason`,
          ),
        }),
  };
}

function validateProjectDecisionEvents(
  events: readonly ProjectDecisionEvent[],
  projectIds: ReadonlySet<string>,
  path: string,
) {
  const priorById = new Map<string, ProjectDecisionEvent>();
  const activeHeads = new Set<string>();
  events.forEach((event, index) => {
    const eventPath = `${path}[${index}]`;
    if (!projectIds.has(event.projectId)) {
      fail(eventPath, `targets unknown project ${event.projectId}`);
    }
    if (event.action === "recorded") {
      activeHeads.add(event.id);
    } else {
      const target = priorById.get(event.supersedesId);
      if (!target) {
        fail(`${eventPath}.supersedesId`, "must identify an earlier event");
      }
      if (target.projectId !== event.projectId) {
        fail(
          `${eventPath}.supersedesId`,
          "must identify an event in the same project",
        );
      }
      if (!activeHeads.has(target.id)) {
        fail(
          `${eventPath}.supersedesId`,
          "must identify a current decision head",
        );
      }
      if (Date.parse(event.recordedAt) < Date.parse(target.recordedAt)) {
        fail(eventPath, "cannot precede the event it supersedes");
      }
      activeHeads.delete(target.id);
      if (event.action === "superseded") activeHeads.add(event.id);
    }
    priorById.set(event.id, event);
  });
}

// A project's complete event log retains canonical append order.
export function selectProjectDecisionEvents(
  events: readonly ProjectDecisionEvent[],
  projectId: string,
): ProjectDecisionEvent[] {
  return events.filter((event) => event.projectId === projectId);
}

// Current decision heads are returned newest first for the project UI.
export function selectActiveProjectDecisions(
  events: readonly ProjectDecisionEvent[],
  projectId: string,
): ActiveProjectDecisionEvent[] {
  const consumedIds = new Set(
    events.flatMap((event) =>
      event.action === "recorded" ? [] : [event.supersedesId],
    ),
  );
  return events
    .filter(
      (event): event is ActiveProjectDecisionEvent =>
        event.projectId === projectId &&
        event.action !== "withdrawn" &&
        !consumedIds.has(event.id),
    )
    .reverse();
}

// Histories are returned from the original record through the selected event.
export function selectProjectDecisionHistory(
  events: readonly ProjectDecisionEvent[],
  eventId: string,
): ProjectDecisionEvent[] {
  const byId = new Map(events.map((event) => [event.id, event]));
  const seen = new Set<string>();
  const history: ProjectDecisionEvent[] = [];
  let event = byId.get(eventId);
  while (event && !seen.has(event.id)) {
    seen.add(event.id);
    history.push(event);
    event =
      event.action === "recorded" ? undefined : byId.get(event.supersedesId);
  }
  return history.reverse();
}

function parseDecision(value: unknown, path: string): ResultDecision {
  const source = record(value, path);
  exactKeys(source, ["kind", "decidedAt"], ["note"], path);
  return {
    kind: oneOf(
      source.kind,
      ["accepted", "redirected", "rejected"],
      `${path}.kind`,
    ),
    decidedAt: timestamp(source.decidedAt, `${path}.decidedAt`),
    ...(source.note === undefined
      ? {}
      : { note: boundedString(source.note, LIMITS.note, `${path}.note`) }),
  };
}

function parseReview(value: unknown, path: string): ResultCycleReview {
  const source = record(value, path);
  exactKeys(source, ["reviewedAt"], ["decision"], path);
  const reviewedAt = timestamp(source.reviewedAt, `${path}.reviewedAt`);
  const decision =
    source.decision === undefined
      ? undefined
      : parseDecision(source.decision, `${path}.decision`);
  if (decision && Date.parse(decision.decidedAt) < Date.parse(reviewedAt)) {
    fail(path, "decision cannot precede review");
  }
  return {
    reviewedAt,
    ...(decision ? { decision } : {}),
  };
}

function parseResultKey(value: unknown, path: string): CodexResultKey {
  const source = record(value, path);
  exactKeys(source, ["kind", "id"], [], path);
  const id = boundedString(source.id, LIMITS.resultKeyId, `${path}.id`);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(id)) {
    fail(`${path}.id`, "expected a safe structural identifier");
  }
  return {
    kind: oneOf(source.kind, ["turn", "operation", "revision"], `${path}.kind`),
    id,
  };
}

function resultKeyIdentity(key: CodexResultKey): string {
  return `${key.kind}:${key.id}`;
}

function sameResultKey(left: CodexResultKey, right: CodexResultKey): boolean {
  return left.kind === right.kind && left.id === right.id;
}

export function isResultReviewAssessmentTarget(
  target: ReviewAssessmentTarget,
): target is ResultReviewAssessmentTarget {
  return "attemptId" in target;
}

export function reviewAssessmentTargetIdentity(
  target: ReviewAssessmentTarget,
): string {
  return isResultReviewAssessmentTarget(target)
    ? JSON.stringify([
        "result",
        target.projectId,
        target.objectiveId,
        target.workItemId,
        target.attemptId,
        target.resultKey.kind,
        target.resultKey.id,
      ])
    : JSON.stringify([
        "work_item",
        target.projectId,
        target.objectiveId,
        target.workItemId,
      ]);
}

export function sameReviewAssessmentTarget(
  left: ReviewAssessmentTarget,
  right: ReviewAssessmentTarget,
): boolean {
  return (
    reviewAssessmentTargetIdentity(left) ===
    reviewAssessmentTargetIdentity(right)
  );
}

export function selectReviewAssessment(
  assessments: readonly ReviewAssessment[],
  target: ReviewAssessmentTarget,
): ReviewAssessment | undefined {
  const identity = reviewAssessmentTargetIdentity(target);
  return assessments.find(
    (assessment) =>
      reviewAssessmentTargetIdentity(assessment.target) === identity,
  );
}

function reviewAssessmentTargetExists(
  projects: readonly WorkspaceProject[],
  target: ReviewAssessmentTarget,
): boolean {
  const workItem = projects
    .find((project) => project.id === target.projectId)
    ?.objectives.find((objective) => objective.id === target.objectiveId)
    ?.workItems.find((item) => item.id === target.workItemId);
  if (!workItem) return false;
  if (!isResultReviewAssessmentTarget(target)) return true;
  return Boolean(
    workItem.attempts
      .find((attempt) => attempt.id === target.attemptId)
      ?.resultCycles.some((result) =>
        sameResultKey(result.key, target.resultKey),
      ),
  );
}

function parseReviewAssessmentTarget(
  value: unknown,
  path: string,
): ReviewAssessmentTarget {
  const source = record(value, path);
  const isResult = "attemptId" in source || "resultKey" in source;
  exactKeys(
    source,
    isResult
      ? ["projectId", "objectiveId", "workItemId", "attemptId", "resultKey"]
      : ["projectId", "objectiveId", "workItemId"],
    [],
    path,
  );
  const target: WorkItemReviewAssessmentTarget = {
    projectId: boundedString(source.projectId, LIMITS.id, `${path}.projectId`),
    objectiveId: boundedString(
      source.objectiveId,
      LIMITS.id,
      `${path}.objectiveId`,
    ),
    workItemId: boundedString(
      source.workItemId,
      LIMITS.id,
      `${path}.workItemId`,
    ),
  };
  return isResult
    ? {
        ...target,
        attemptId: boundedString(
          source.attemptId,
          LIMITS.id,
          `${path}.attemptId`,
        ),
        resultKey: parseResultKey(source.resultKey, `${path}.resultKey`),
      }
    : target;
}

function meaningfulAssessmentText(value: unknown, path: string): string {
  const parsed = boundedString(value, MAX_REVIEW_ASSESSMENT_TEXT_LENGTH, path);
  if (parsed.trim().length === 0) fail(path, "expected meaningful text");
  return parsed;
}

function parseReviewAssessmentList(value: unknown, path: string): string[] {
  return boundedArray(value, MAX_REVIEW_ASSESSMENT_LIST_ENTRIES, path).map(
    (entry, index) => meaningfulAssessmentText(entry, `${path}[${index}]`),
  );
}

function parseReviewNextAction(value: unknown, path: string): ReviewNextAction {
  const source = record(value, path);
  exactKeys(source, ["kind"], ["note"], path);
  return {
    kind: oneOf(
      source.kind,
      [
        "open_in_codex",
        "send_follow_up",
        "request_review",
        "run_quality_check",
        "accept_result",
        "redirect_result",
        "reject_result",
      ] satisfies ReviewNextActionKind[],
      `${path}.kind`,
    ),
    ...(source.note === undefined
      ? {}
      : { note: meaningfulAssessmentText(source.note, `${path}.note`) }),
  };
}

function parseReviewAssessmentDraft(
  value: unknown,
  path: string,
): ReviewAssessmentDraft {
  const source = record(value, path);
  exactKeys(
    source,
    ["target", "risks", "uncertainties", "blockedDecisions"],
    ["reviewSummary", "nextAction"],
    path,
  );
  const reviewSummary =
    source.reviewSummary === undefined
      ? undefined
      : meaningfulAssessmentText(source.reviewSummary, `${path}.reviewSummary`);
  const risks = parseReviewAssessmentList(source.risks, `${path}.risks`);
  const uncertainties = parseReviewAssessmentList(
    source.uncertainties,
    `${path}.uncertainties`,
  );
  const blockedDecisions = parseReviewAssessmentList(
    source.blockedDecisions,
    `${path}.blockedDecisions`,
  );
  const nextAction =
    source.nextAction === undefined
      ? undefined
      : parseReviewNextAction(source.nextAction, `${path}.nextAction`);
  const totalTextLength = [
    ...(reviewSummary ? [reviewSummary] : []),
    ...risks,
    ...uncertainties,
    ...blockedDecisions,
    ...(nextAction?.note ? [nextAction.note] : []),
  ].reduce((total, entry) => total + entry.length, 0);
  if (totalTextLength > MAX_REVIEW_ASSESSMENT_TOTAL_TEXT_LENGTH) {
    fail(
      path,
      `assessment text exceeds ${MAX_REVIEW_ASSESSMENT_TOTAL_TEXT_LENGTH} characters`,
    );
  }
  if (
    !reviewSummary &&
    risks.length === 0 &&
    uncertainties.length === 0 &&
    blockedDecisions.length === 0 &&
    !nextAction
  ) {
    fail(path, "expected at least one meaningful assessment field");
  }
  return {
    target: parseReviewAssessmentTarget(source.target, `${path}.target`),
    ...(reviewSummary ? { reviewSummary } : {}),
    risks,
    uncertainties,
    blockedDecisions,
    ...(nextAction ? { nextAction } : {}),
  };
}

function parseReviewAssessment(value: unknown, path: string): ReviewAssessment {
  const source = record(value, path);
  exactKeys(
    source,
    [
      "target",
      "authorship",
      "risks",
      "uncertainties",
      "blockedDecisions",
      "updatedAt",
    ],
    ["reviewSummary", "nextAction"],
    path,
  );
  const draft = parseReviewAssessmentDraft(
    {
      target: source.target,
      ...(source.reviewSummary === undefined
        ? {}
        : { reviewSummary: source.reviewSummary }),
      risks: source.risks,
      uncertainties: source.uncertainties,
      blockedDecisions: source.blockedDecisions,
      ...(source.nextAction === undefined
        ? {}
        : { nextAction: source.nextAction }),
    },
    path,
  );
  return {
    ...draft,
    authorship: oneOf(source.authorship, ["user"], `${path}.authorship`),
    updatedAt: timestamp(source.updatedAt, `${path}.updatedAt`),
  };
}

function meaningfulDecisionRequestText(value: unknown, path: string): string {
  const parsed = boundedString(value, MAX_DECISION_REQUEST_TEXT_LENGTH, path);
  if (parsed.trim().length === 0) fail(path, "expected meaningful text");
  return parsed;
}

function parseDecisionRequestDraft(
  value: unknown,
  path: string,
): DecisionRequestDraft {
  const source = record(value, path);
  exactKeys(source, ["id", "target", "prompt"], [], path);
  return {
    id: boundedString(source.id, LIMITS.id, `${path}.id`),
    target: parseReviewAssessmentTarget(source.target, `${path}.target`),
    prompt: meaningfulDecisionRequestText(source.prompt, `${path}.prompt`),
  };
}

function parseDecisionRequest(value: unknown, path: string): DecisionRequest {
  const source = record(value, path);
  exactKeys(
    source,
    ["id", "target", "prompt", "authorship", "createdAt", "updatedAt"],
    ["resolvedAt", "resolution"],
    path,
  );
  const draft = parseDecisionRequestDraft(
    { id: source.id, target: source.target, prompt: source.prompt },
    path,
  );
  const createdAt = timestamp(source.createdAt, `${path}.createdAt`);
  const updatedAt = timestamp(source.updatedAt, `${path}.updatedAt`);
  const resolvedAt =
    source.resolvedAt === undefined
      ? undefined
      : timestamp(source.resolvedAt, `${path}.resolvedAt`);
  const resolution =
    source.resolution === undefined
      ? undefined
      : meaningfulDecisionRequestText(source.resolution, `${path}.resolution`);
  if (Date.parse(updatedAt) < Date.parse(createdAt)) {
    fail(path, "updatedAt cannot precede createdAt");
  }
  if (resolvedAt && Date.parse(resolvedAt) < Date.parse(createdAt)) {
    fail(path, "resolvedAt cannot precede createdAt");
  }
  if (resolvedAt && Date.parse(updatedAt) < Date.parse(resolvedAt)) {
    fail(path, "updatedAt cannot precede resolvedAt");
  }
  if (resolution && !resolvedAt) {
    fail(path, "resolution requires resolvedAt");
  }
  return {
    ...draft,
    authorship: oneOf(source.authorship, ["user"], `${path}.authorship`),
    createdAt,
    updatedAt,
    ...(resolvedAt ? { resolvedAt } : {}),
    ...(resolution ? { resolution } : {}),
  };
}

function resultTargetIdentity(
  projectId: string,
  objectiveId: string,
  workItemId: string,
  attemptId: string,
  resultKey: CodexResultKey,
): string {
  return JSON.stringify([
    projectId,
    objectiveId,
    workItemId,
    attemptId,
    resultKey.kind,
    resultKey.id,
  ]);
}

function parseResultCycle(value: unknown, path: string): CodexResultCycle {
  const source = record(value, path);
  exactKeys(source, ["key", "observedAt"], ["review"], path);
  const observedAt = timestamp(source.observedAt, `${path}.observedAt`);
  const review =
    source.review === undefined
      ? undefined
      : parseReview(source.review, `${path}.review`);
  if (review && Date.parse(review.reviewedAt) < Date.parse(observedAt)) {
    fail(path, "review cannot precede result observation");
  }
  return {
    key: parseResultKey(source.key, `${path}.key`),
    observedAt,
    ...(review ? { review } : {}),
  };
}

function uniqueResultCycles(
  results: CodexResultCycle[],
  path: string,
): CodexResultCycle[] {
  const keys = new Set<string>();
  for (const result of results) {
    const identity = resultKeyIdentity(result.key);
    if (keys.has(identity)) fail(path, `duplicate result key ${identity}`);
    keys.add(identity);
  }
  return results;
}

function parseAttempt(
  value: unknown,
  path: string,
  legacyShape = false,
): CodexTaskAttempt {
  const source = record(value, path);
  exactKeys(
    source,
    ["id", "codexTaskId", "relationship", "linkedAt", "resultCycles"],
    legacyShape ? [] : ["unlinkedAt", "observeResultsAfterKey"],
    path,
  );
  const linkedAt = timestamp(source.linkedAt, `${path}.linkedAt`);
  const unlinkedAt =
    source.unlinkedAt === undefined
      ? undefined
      : timestamp(source.unlinkedAt, `${path}.unlinkedAt`);
  const observeResultsAfterKey =
    source.observeResultsAfterKey === undefined
      ? undefined
      : parseResultKey(
          source.observeResultsAfterKey,
          `${path}.observeResultsAfterKey`,
        );
  const resultCycles = uniqueResultCycles(
    boundedArray(
      source.resultCycles,
      LIMITS.resultCyclesPerAttempt,
      `${path}.resultCycles`,
    ).map((entry, index) =>
      parseResultCycle(entry, `${path}.resultCycles[${index}]`),
    ),
    `${path}.resultCycles`,
  );
  if (unlinkedAt && Date.parse(unlinkedAt) < Date.parse(linkedAt)) {
    fail(path, "unlinkedAt cannot precede linkedAt");
  }
  if (
    observeResultsAfterKey &&
    resultCycles.some((result) =>
      sameResultKey(result.key, observeResultsAfterKey),
    )
  ) {
    fail(path, "a continued link cannot repeat its baseline result");
  }
  return {
    id: boundedString(source.id, LIMITS.id, `${path}.id`),
    codexTaskId: boundedString(
      source.codexTaskId,
      LIMITS.id,
      `${path}.codexTaskId`,
    ),
    relationship: oneOf(
      source.relationship,
      legacyShape
        ? ["primary", "retry", "alternative", "handoff"]
        : ["primary", "retry", "alternative", "handoff", "continuation"],
      `${path}.relationship`,
    ),
    linkedAt,
    ...(unlinkedAt ? { unlinkedAt } : {}),
    ...(observeResultsAfterKey ? { observeResultsAfterKey } : {}),
    resultCycles,
  };
}

function parseWorkItemRelationships(
  value: unknown,
  path: string,
  allowEmpty = false,
): WorkItemRelationship[] {
  const relationships = boundedArray(
    value,
    LIMITS.relationshipsPerWorkItem,
    path,
  ).map((entry, index) => {
    const entryPath = `${path}[${index}]`;
    const source = record(entry, entryPath);
    exactKeys(
      source,
      ["kind", "targetObjectiveId", "targetWorkItemId"],
      [],
      entryPath,
    );
    return {
      kind: oneOf(
        source.kind,
        ["depends_on", "hands_off_to"],
        `${entryPath}.kind`,
      ),
      targetObjectiveId: structuralIdentifier(
        source.targetObjectiveId,
        LIMITS.id,
        `${entryPath}.targetObjectiveId`,
      ),
      targetWorkItemId: structuralIdentifier(
        source.targetWorkItemId,
        LIMITS.id,
        `${entryPath}.targetWorkItemId`,
      ),
    } satisfies WorkItemRelationship;
  });
  if (!allowEmpty && relationships.length === 0) {
    fail(path, "present work-item relationships must be nonempty");
  }
  const identities = new Set<string>();
  relationships.forEach((relationship, index) => {
    const identity = JSON.stringify([
      relationship.kind,
      relationship.targetObjectiveId,
      relationship.targetWorkItemId,
    ]);
    if (identities.has(identity)) {
      fail(`${path}[${index}]`, "duplicate work-item relationship");
    }
    identities.add(identity);
  });
  return relationships;
}

function parseWorkItem(
  value: unknown,
  path: string,
  legacyShape = false,
  allowDefinitionOfDone = true,
  allowRelationships = true,
): WorkItem {
  const source = record(value, path);
  exactKeys(
    source,
    [
      "id",
      "title",
      "expectedOutcome",
      "status",
      "createdAt",
      "updatedAt",
      "attempts",
    ],
    [
      ...(allowDefinitionOfDone ? ["definitionOfDone"] : []),
      ...(allowRelationships ? ["relationships"] : []),
    ],
    path,
  );
  return {
    id: boundedString(source.id, LIMITS.id, `${path}.id`),
    title: boundedString(source.title, LIMITS.title, `${path}.title`),
    expectedOutcome: boundedString(
      source.expectedOutcome,
      LIMITS.expectedOutcome,
      `${path}.expectedOutcome`,
    ),
    ...(source.definitionOfDone === undefined
      ? {}
      : {
          definitionOfDone: parseDefinitionOfDone(
            source.definitionOfDone,
            `${path}.definitionOfDone`,
            false,
          ),
        }),
    ...(source.relationships === undefined
      ? {}
      : {
          relationships: parseWorkItemRelationships(
            source.relationships,
            `${path}.relationships`,
          ),
        }),
    status: oneOf(
      source.status,
      [
        "planned",
        "in_progress",
        "blocked",
        "ready_for_review",
        "accepted",
        "cancelled",
      ],
      `${path}.status`,
    ),
    createdAt: timestamp(source.createdAt, `${path}.createdAt`),
    updatedAt: timestamp(source.updatedAt, `${path}.updatedAt`),
    attempts: uniqueIds(
      boundedArray(
        source.attempts,
        LIMITS.attemptsPerWorkItem,
        `${path}.attempts`,
      ).map((entry, index) =>
        parseAttempt(entry, `${path}.attempts[${index}]`, legacyShape),
      ),
      `${path}.attempts`,
    ),
  };
}

function parseObjective(
  value: unknown,
  path: string,
  legacyShape = false,
  allowDefinitionOfDone = true,
  allowRelationships = true,
): Objective {
  const source = record(value, path);
  exactKeys(
    source,
    ["id", "title", "status", "createdAt", "updatedAt", "workItems"],
    ["expectedOutcome"],
    path,
  );
  return {
    id: boundedString(source.id, LIMITS.id, `${path}.id`),
    title: boundedString(source.title, LIMITS.title, `${path}.title`),
    ...(source.expectedOutcome === undefined
      ? {}
      : {
          expectedOutcome: boundedString(
            source.expectedOutcome,
            LIMITS.expectedOutcome,
            `${path}.expectedOutcome`,
          ),
        }),
    status: oneOf(
      source.status,
      ["active", "paused", "achieved"],
      `${path}.status`,
    ),
    createdAt: timestamp(source.createdAt, `${path}.createdAt`),
    updatedAt: timestamp(source.updatedAt, `${path}.updatedAt`),
    workItems: uniqueIds(
      boundedArray(
        source.workItems,
        LIMITS.workItemsPerObjective,
        `${path}.workItems`,
      ).map((entry, index) =>
        parseWorkItem(
          entry,
          `${path}.workItems[${index}]`,
          legacyShape,
          allowDefinitionOfDone,
          allowRelationships,
        ),
      ),
      `${path}.workItems`,
    ),
  };
}

function parseProject(
  value: unknown,
  path: string,
  legacyShape = false,
  allowDefinitionOfDone = true,
  allowRules = true,
  allowQualityBars = true,
  allowRelationships = true,
  allowContextReview = true,
  allowReviewSchedule = true,
): WorkspaceProject {
  const source = record(value, path);
  exactKeys(
    source,
    ["id", "title", "createdAt", "updatedAt", "objectives"],
    [
      ...(allowRules ? ["rules"] : []),
      ...(allowQualityBars ? ["qualityBars"] : []),
      ...(allowContextReview ? ["contextReview"] : []),
      ...(allowReviewSchedule ? ["reviewSchedule"] : []),
    ],
    path,
  );
  return {
    id: boundedString(source.id, LIMITS.id, `${path}.id`),
    title: boundedString(source.title, LIMITS.title, `${path}.title`),
    ...(source.rules === undefined
      ? {}
      : { rules: parseProjectRules(source.rules, `${path}.rules`, false) }),
    ...(source.qualityBars === undefined
      ? {}
      : {
          qualityBars: parseProjectQualityBars(
            source.qualityBars,
            `${path}.qualityBars`,
            false,
          ),
        }),
    ...(source.contextReview === undefined
      ? {}
      : {
          contextReview: parseProjectContextReview(
            source.contextReview,
            `${path}.contextReview`,
          ),
        }),
    ...(source.reviewSchedule === undefined
      ? {}
      : {
          reviewSchedule: parseProjectReviewSchedule(
            source.reviewSchedule,
            `${path}.reviewSchedule`,
          ),
        }),
    createdAt: timestamp(source.createdAt, `${path}.createdAt`),
    updatedAt: timestamp(source.updatedAt, `${path}.updatedAt`),
    objectives: uniqueIds(
      boundedArray(
        source.objectives,
        LIMITS.objectivesPerProject,
        `${path}.objectives`,
      ).map((entry, index) =>
        parseObjective(
          entry,
          `${path}.objectives[${index}]`,
          legacyShape,
          allowDefinitionOfDone,
          allowRelationships,
        ),
      ),
      `${path}.objectives`,
    ),
  };
}

function workItemLocationKey(objectiveId: string, workItemId: string): string {
  return JSON.stringify([objectiveId, workItemId]);
}

function validateWorkItemRelationships(
  projects: WorkspaceProject[],
  path: string,
): void {
  projects.forEach((project, projectIndex) => {
    const locations = new Set<string>();
    project.objectives.forEach((objective) => {
      objective.workItems.forEach((workItem) => {
        locations.add(workItemLocationKey(objective.id, workItem.id));
      });
    });
    const adjacency = new Map<string, string[]>();
    const directedEdges = new Set<string>();
    project.objectives.forEach((objective, objectiveIndex) => {
      objective.workItems.forEach((workItem, workItemIndex) => {
        const sourceKey = workItemLocationKey(objective.id, workItem.id);
        (workItem.relationships ?? []).forEach((relationship, index) => {
          const relationPath = `${path}[${projectIndex}].objectives[${objectiveIndex}].workItems[${workItemIndex}].relationships[${index}]`;
          const targetKey = workItemLocationKey(
            relationship.targetObjectiveId,
            relationship.targetWorkItemId,
          );
          if (targetKey === sourceKey) {
            fail(relationPath, "a work item cannot link to itself");
          }
          if (!locations.has(targetKey)) {
            fail(
              relationPath,
              "target work item does not exist in this project",
            );
          }
          const fromKey =
            relationship.kind === "depends_on" ? targetKey : sourceKey;
          const toKey =
            relationship.kind === "depends_on" ? sourceKey : targetKey;
          const edgeIdentity = JSON.stringify([fromKey, toKey]);
          if (directedEdges.has(edgeIdentity)) {
            fail(
              relationPath,
              "duplicate advisory direction between work items",
            );
          }
          directedEdges.add(edgeIdentity);
          adjacency.set(fromKey, [...(adjacency.get(fromKey) ?? []), toKey]);
        });
      });
    });
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (key: string): void => {
      if (visiting.has(key)) {
        fail(
          `${path}[${projectIndex}]`,
          "work-item relationships form a cycle",
        );
      }
      if (visited.has(key)) return;
      visiting.add(key);
      (adjacency.get(key) ?? []).forEach(visit);
      visiting.delete(key);
      visited.add(key);
    };
    locations.forEach(visit);
  });
}

function parseAttention(value: unknown, path: string): AttentionReviewState {
  const source = record(value, path);
  exactKeys(
    source,
    ["version", "initializedAt", "dispositions", "snoozedUntil"],
    [],
    path,
  );
  if (source.version !== ATTENTION_REVIEW_STATE_VERSION)
    fail(`${path}.version`, "unsupported version");
  const initializedAt = timestamp(
    source.initializedAt,
    `${path}.initializedAt`,
  );
  const dispositionsSource = record(
    source.dispositions,
    `${path}.dispositions`,
  );
  const snoozesSource = record(source.snoozedUntil, `${path}.snoozedUntil`);
  if (Object.keys(dispositionsSource).length > LIMITS.attentionRecords)
    fail(`${path}.dispositions`, "too many entries");
  if (Object.keys(snoozesSource).length > LIMITS.attentionRecords)
    fail(`${path}.snoozedUntil`, "too many entries");
  const dispositions: AttentionReviewState["dispositions"] = {};
  for (const [key, raw] of Object.entries(dispositionsSource)) {
    boundedString(key, 320, `${path}.dispositions key`);
    dispositions[key] = parseAttentionDisposition(
      raw,
      `${path}.dispositions.${key}`,
    );
  }
  const snoozedUntil: Record<string, string> = {};
  for (const [key, raw] of Object.entries(snoozesSource)) {
    boundedString(key, 320, `${path}.snoozedUntil key`);
    snoozedUntil[key] = timestamp(raw, `${path}.snoozedUntil.${key}`);
  }
  const state: AttentionReviewState = {
    version: ATTENTION_REVIEW_STATE_VERSION,
    initializedAt,
    dispositions,
    snoozedUntil,
  };
  if (
    new TextEncoder().encode(JSON.stringify(state)).byteLength >
    MAX_ATTENTION_REVIEW_STORAGE_BYTES
  ) {
    fail(path, `state exceeds ${MAX_ATTENTION_REVIEW_STORAGE_BYTES} bytes`);
  }
  return state;
}

function parseAttentionDisposition(
  value: unknown,
  path: string,
): AttentionDisposition {
  const item = record(value, path);
  exactKeys(item, ["kind", "at"], [], path);
  return {
    kind: oneOf(
      item.kind,
      [
        "baseline",
        "reviewed",
        "dismissed",
        "needs_review",
      ] satisfies AttentionDispositionKind[],
      `${path}.kind`,
    ),
    at: timestamp(item.at, `${path}.at`),
  };
}

function parseEvidence(value: unknown, path: string): EvidenceRecord {
  const source = record(value, path);
  exactKeys(
    source,
    [
      "id",
      "kind",
      "outcome",
      "summary",
      "recordedAt",
      "projectId",
      "provenance",
    ],
    ["objectiveId", "workItemId", "attemptId", "resultKey", "decisionKind"],
    path,
  );
  const optionalId = (key: "objectiveId" | "workItemId" | "attemptId") =>
    source[key] === undefined
      ? {}
      : { [key]: boundedString(source[key], LIMITS.id, `${path}.${key}`) };
  if (source.attemptId !== undefined && source.workItemId === undefined) {
    fail(path, "attemptId requires workItemId");
  }
  if (source.workItemId !== undefined && source.objectiveId === undefined) {
    fail(path, "workItemId requires objectiveId");
  }
  if (source.resultKey !== undefined && source.attemptId === undefined) {
    fail(path, "resultKey requires attemptId");
  }
  const kind = oneOf(
    source.kind,
    [
      "task_lifecycle",
      "action",
      "verification",
      "changeset",
      "repository",
      "risk",
      "decision",
    ],
    `${path}.kind`,
  );
  const outcome = oneOf(
    source.outcome,
    ["passed", "failed", "neutral"],
    `${path}.outcome`,
  );
  const decisionKind =
    source.decisionKind === undefined
      ? undefined
      : oneOf(
          source.decisionKind,
          ["accepted", "redirected", "rejected"],
          `${path}.decisionKind`,
        );
  if (kind === "decision") {
    if (
      !decisionKind ||
      outcome !== "neutral" ||
      source.resultKey === undefined
    ) {
      fail(
        path,
        "decision evidence requires decisionKind, neutral outcome, and resultKey",
      );
    }
  } else if (decisionKind) {
    fail(path, "decisionKind is only valid for decision evidence");
  }
  return {
    id: boundedString(source.id, LIMITS.id, `${path}.id`),
    kind,
    outcome,
    summary: boundedString(source.summary, LIMITS.note, `${path}.summary`),
    recordedAt: timestamp(source.recordedAt, `${path}.recordedAt`),
    projectId: boundedString(source.projectId, LIMITS.id, `${path}.projectId`),
    ...optionalId("objectiveId"),
    ...optionalId("workItemId"),
    ...optionalId("attemptId"),
    ...(source.resultKey === undefined
      ? {}
      : { resultKey: parseResultKey(source.resultKey, `${path}.resultKey`) }),
    ...(decisionKind ? { decisionKind } : {}),
    provenance: parseEvidenceProvenance(
      source.provenance,
      `${path}.provenance`,
    ),
  } as EvidenceRecord;
}

function parseEvidenceProvenance(
  value: unknown,
  path: string,
): EvidenceProvenance {
  const source = record(value, path);
  exactKeys(source, ["source"], ["reference"], path);
  return {
    source: oneOf(
      source.source,
      ["codex", "coffice", "user"],
      `${path}.source`,
    ),
    ...(source.reference === undefined
      ? {}
      : {
          reference: boundedString(
            source.reference,
            LIMITS.reference,
            `${path}.reference`,
          ),
        }),
  };
}

function parseMigrations(value: unknown, path: string): WorkspaceMigrations {
  const source = record(value, path);
  exactKeys(source, [], ["attentionReviewV2ImportedAt"], path);
  return source.attentionReviewV2ImportedAt === undefined
    ? {}
    : {
        attentionReviewV2ImportedAt: timestamp(
          source.attentionReviewV2ImportedAt,
          `${path}.attentionReviewV2ImportedAt`,
        ),
      };
}

function parseMutationReceipt(
  value: unknown,
  path: string,
): WorkspaceMutationReceipt {
  const source = record(value, path);
  exactKeys(source, ["id", "hash", "revision", "appliedAt"], [], path);
  if (
    !Number.isSafeInteger(source.revision) ||
    (source.revision as number) < 1
  ) {
    fail(`${path}.revision`, "expected a positive safe integer");
  }
  const hash = boundedString(source.hash, 128, `${path}.hash`);
  if (!/^[a-f0-9]{64}$/.test(hash))
    fail(`${path}.hash`, "expected a SHA-256 digest");
  return {
    id: boundedString(source.id, LIMITS.id, `${path}.id`),
    hash,
    revision: source.revision as number,
    appliedAt: timestamp(source.appliedAt, `${path}.appliedAt`),
  };
}

function structuralIdentifier(value: unknown, max: number, path: string) {
  const result = boundedString(value, max, path);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(result)) {
    fail(path, "expected a safe structural identifier");
  }
  return result;
}

function parseTaskLinkLocation(value: unknown, path: string): TaskLinkLocation {
  const source = record(value, path);
  exactKeys(
    source,
    ["projectId", "objectiveId", "workItemId", "attemptId"],
    [],
    path,
  );
  return {
    projectId: structuralIdentifier(
      source.projectId,
      LIMITS.id,
      `${path}.projectId`,
    ),
    objectiveId: structuralIdentifier(
      source.objectiveId,
      LIMITS.id,
      `${path}.objectiveId`,
    ),
    workItemId: structuralIdentifier(
      source.workItemId,
      LIMITS.id,
      `${path}.workItemId`,
    ),
    attemptId: structuralIdentifier(
      source.attemptId,
      LIMITS.id,
      `${path}.attemptId`,
    ),
  };
}

function parseVerificationState(value: unknown, path: string) {
  return oneOf(
    value,
    ["queued", "running", "passed", "failed", "unknown"],
    path,
  );
}

function parseVerificationProfileRef(
  value: unknown,
  path: string,
): VerificationProfileRef {
  const source = record(value, path);
  exactKeys(source, ["id", "version"], [], path);
  return {
    id: structuralIdentifier(source.id, LIMITS.id, `${path}.id`),
    version: structuralIdentifier(
      source.version,
      LIMITS.version,
      `${path}.version`,
    ),
  };
}

function parseVerificationCheckRef(
  value: unknown,
  path: string,
): VerificationCheckRef {
  return parseVerificationProfileRef(value, path);
}

function parseVerificationTarget(
  value: unknown,
  path: string,
): VerificationTarget {
  const source = record(value, path);
  exactKeys(
    source,
    ["projectId", "objectiveId", "workItemId", "attemptId", "resultKey"],
    [],
    path,
  );
  return {
    projectId: structuralIdentifier(
      source.projectId,
      LIMITS.id,
      `${path}.projectId`,
    ),
    objectiveId: structuralIdentifier(
      source.objectiveId,
      LIMITS.id,
      `${path}.objectiveId`,
    ),
    workItemId: structuralIdentifier(
      source.workItemId,
      LIMITS.id,
      `${path}.workItemId`,
    ),
    attemptId: structuralIdentifier(
      source.attemptId,
      LIMITS.id,
      `${path}.attemptId`,
    ),
    resultKey: parseResultKey(source.resultKey, `${path}.resultKey`),
  };
}

function validateVerificationTimeline(
  state: VerificationState,
  queuedAt: string,
  startedAt: string | undefined,
  completedAt: string | undefined,
  path: string,
) {
  if (state === "queued") {
    if (startedAt || completedAt)
      fail(path, "queued state cannot have later timestamps");
    return;
  }
  if (!startedAt) fail(path, `${state} state requires startedAt`);
  if (Date.parse(startedAt) < Date.parse(queuedAt)) {
    fail(path, "startedAt cannot precede queuedAt");
  }
  if (state === "running") {
    if (completedAt) fail(path, "running state cannot have completedAt");
    return;
  }
  if (!completedAt) fail(path, `${state} state requires completedAt`);
  if (Date.parse(completedAt) < Date.parse(startedAt)) {
    fail(path, "completedAt cannot precede startedAt");
  }
}

function parseVerificationCheckReceipt(
  value: unknown,
  path: string,
): VerificationCheckReceipt {
  const source = record(value, path);
  exactKeys(
    source,
    ["id", "version", "state", "queuedAt"],
    ["startedAt", "completedAt", "failureKind", "exitCode"],
    path,
  );
  const reference = parseVerificationCheckRef(
    { id: source.id, version: source.version },
    path,
  );
  const state = parseVerificationState(source.state, `${path}.state`);
  const queuedAt = timestamp(source.queuedAt, `${path}.queuedAt`);
  const startedAt =
    source.startedAt === undefined
      ? undefined
      : timestamp(source.startedAt, `${path}.startedAt`);
  const completedAt =
    source.completedAt === undefined
      ? undefined
      : timestamp(source.completedAt, `${path}.completedAt`);
  const failureKind =
    source.failureKind === undefined
      ? undefined
      : oneOf(
          source.failureKind,
          ["exit", "timeout", "launch"],
          `${path}.failureKind`,
        );
  validateVerificationTimeline(state, queuedAt, startedAt, completedAt, path);
  if ((state === "failed") !== Boolean(failureKind)) {
    fail(path, "failureKind is required only for failed checks");
  }
  const exitCode = source.exitCode;
  if (
    exitCode !== undefined &&
    (!Number.isSafeInteger(exitCode) ||
      (exitCode as number) < -2_147_483_648 ||
      (exitCode as number) > 2_147_483_647)
  ) {
    fail(`${path}.exitCode`, "expected a signed 32-bit integer");
  }
  if (exitCode !== undefined && failureKind !== "exit") {
    fail(path, "exitCode is allowed only for an exit failure");
  }
  if (exitCode === 0) {
    fail(path, "an exit failure cannot have exit code zero");
  }
  return {
    ...reference,
    state,
    queuedAt,
    ...(startedAt ? { startedAt } : {}),
    ...(completedAt ? { completedAt } : {}),
    ...(failureKind ? { failureKind } : {}),
    ...(exitCode === undefined ? {} : { exitCode: exitCode as number }),
  };
}

function expectedVerificationState(checks: VerificationCheckReceipt[]) {
  if (checks.every((check) => check.state === "queued")) return "queued";
  if (checks.some((check) => check.state === "running")) return "running";
  if (checks.some((check) => check.state === "failed")) return "failed";
  if (checks.some((check) => check.state === "unknown")) return "unknown";
  if (checks.some((check) => check.state === "queued")) return "running";
  return "passed";
}

function parseVerificationReceipt(
  value: unknown,
  path: string,
): VerificationReceipt {
  const source = record(value, path);
  exactKeys(
    source,
    [
      "id",
      "idempotencyKey",
      "requestHash",
      "target",
      "profile",
      "checks",
      "state",
      "queuedAt",
    ],
    ["startedAt", "completedAt"],
    path,
  );
  const state = parseVerificationState(source.state, `${path}.state`);
  const queuedAt = timestamp(source.queuedAt, `${path}.queuedAt`);
  const startedAt =
    source.startedAt === undefined
      ? undefined
      : timestamp(source.startedAt, `${path}.startedAt`);
  const completedAt =
    source.completedAt === undefined
      ? undefined
      : timestamp(source.completedAt, `${path}.completedAt`);
  validateVerificationTimeline(state, queuedAt, startedAt, completedAt, path);
  const checks = uniqueIds(
    boundedArray(
      source.checks,
      LIMITS.checksPerVerification,
      `${path}.checks`,
    ).map((entry, index) =>
      parseVerificationCheckReceipt(entry, `${path}.checks[${index}]`),
    ),
    `${path}.checks`,
  );
  if (checks.length === 0)
    fail(`${path}.checks`, "expected at least one check");
  if (checks.some((check) => check.queuedAt !== queuedAt)) {
    fail(`${path}.checks`, "check queuedAt must match its receipt");
  }
  if (expectedVerificationState(checks) !== state) {
    fail(path, "state does not match check states");
  }
  if (
    state !== "queued" &&
    state !== "running" &&
    checks.some(
      (check) => check.state === "queued" || check.state === "running",
    )
  ) {
    fail(path, "terminal receipt requires terminal checks");
  }
  const firstStartedAt = checks
    .map((check) => check.startedAt)
    .filter((at): at is string => Boolean(at))
    .sort()[0];
  const lastCompletedAt = checks
    .map((check) => check.completedAt)
    .filter((at): at is string => Boolean(at))
    .sort()
    .at(-1);
  if (startedAt !== firstStartedAt) {
    fail(path, "startedAt must match the first started check");
  }
  if (completedAt !== (state === "running" ? undefined : lastCompletedAt)) {
    fail(path, "completedAt must match the final completed check");
  }
  const requestHash = boundedString(
    source.requestHash,
    64,
    `${path}.requestHash`,
  );
  if (!/^[a-f0-9]{64}$/.test(requestHash)) {
    fail(`${path}.requestHash`, "expected a SHA-256 digest");
  }
  const target = parseVerificationTarget(source.target, `${path}.target`);
  const profile = parseVerificationProfileRef(
    source.profile,
    `${path}.profile`,
  );
  return {
    id: structuralIdentifier(source.id, LIMITS.id, `${path}.id`),
    idempotencyKey: structuralIdentifier(
      source.idempotencyKey,
      LIMITS.id,
      `${path}.idempotencyKey`,
    ),
    requestHash,
    target,
    profile,
    checks,
    state,
    queuedAt,
    ...(startedAt ? { startedAt } : {}),
    ...(completedAt ? { completedAt } : {}),
  };
}

export function parseCofficeWorkspace(value: unknown): CofficeWorkspace {
  const source = record(value, "workspace");
  if (
    source.schemaVersion !== 1 &&
    source.schemaVersion !== 2 &&
    source.schemaVersion !== 3 &&
    source.schemaVersion !== 4 &&
    source.schemaVersion !== 5 &&
    source.schemaVersion !== 6 &&
    source.schemaVersion !== 7 &&
    source.schemaVersion !== 8 &&
    source.schemaVersion !== 9 &&
    source.schemaVersion !== 10 &&
    source.schemaVersion !== 11 &&
    source.schemaVersion !== 12
  ) {
    fail("workspace.schemaVersion", "unsupported schema version");
  }
  const isLegacyV1 = source.schemaVersion === 1;
  const hasReviewAssessments =
    source.schemaVersion === 4 ||
    source.schemaVersion === 5 ||
    source.schemaVersion === 6 ||
    source.schemaVersion === 7 ||
    source.schemaVersion === 8 ||
    source.schemaVersion === 9 ||
    source.schemaVersion === 10 ||
    source.schemaVersion === 11 ||
    source.schemaVersion === 12;
  const hasProjectDecisionEvents =
    source.schemaVersion === 5 ||
    source.schemaVersion === 6 ||
    source.schemaVersion === 7 ||
    source.schemaVersion === 8 ||
    source.schemaVersion === 9 ||
    source.schemaVersion === 10 ||
    source.schemaVersion === 11 ||
    source.schemaVersion === 12;
  const hasDefinitionOfDone =
    source.schemaVersion === 6 ||
    source.schemaVersion === 7 ||
    source.schemaVersion === 8 ||
    source.schemaVersion === 9 ||
    source.schemaVersion === 10 ||
    source.schemaVersion === 11 ||
    source.schemaVersion === 12;
  const hasProjectRules =
    source.schemaVersion === 7 ||
    source.schemaVersion === 8 ||
    source.schemaVersion === 9 ||
    source.schemaVersion === 10 ||
    source.schemaVersion === 11 ||
    source.schemaVersion === 12;
  const hasProjectQualityBars =
    source.schemaVersion === 8 ||
    source.schemaVersion === 9 ||
    source.schemaVersion === 10 ||
    source.schemaVersion === 11 ||
    source.schemaVersion === 12;
  const hasWorkItemRelationships =
    source.schemaVersion === 9 ||
    source.schemaVersion === 10 ||
    source.schemaVersion === 11 ||
    source.schemaVersion === 12;
  const hasProjectContextReview =
    source.schemaVersion === 10 ||
    source.schemaVersion === 11 ||
    source.schemaVersion === 12;
  const hasProjectReviewSchedule =
    source.schemaVersion === 11 || source.schemaVersion === 12;
  const hasDecisionRequests = source.schemaVersion === 12;
  const isLegacyAttemptShape =
    source.schemaVersion === 1 || source.schemaVersion === 2;
  exactKeys(
    source,
    [
      "schemaVersion",
      "revision",
      "createdAt",
      "updatedAt",
      "projects",
      ...(hasProjectDecisionEvents ? ["projectDecisionEvents"] : []),
      "attentionReview",
      ...(hasReviewAssessments ? ["reviewAssessments"] : []),
      ...(hasDecisionRequests ? ["decisionRequests"] : []),
      "evidence",
      "migrations",
      "mutationReceipts",
      ...(isLegacyV1 ? [] : ["verificationReceipts"]),
    ],
    [],
    "workspace",
  );
  if (
    !Number.isSafeInteger(source.revision) ||
    (source.revision as number) < 0
  ) {
    fail("workspace.revision", "expected a non-negative safe integer");
  }
  const projects = uniqueIds(
    boundedArray(source.projects, LIMITS.projects, "workspace.projects").map(
      (entry, index) =>
        parseProject(
          entry,
          `workspace.projects[${index}]`,
          isLegacyAttemptShape,
          hasDefinitionOfDone,
          hasProjectRules,
          hasProjectQualityBars,
          hasWorkItemRelationships,
          hasProjectContextReview,
          hasProjectReviewSchedule,
        ),
    ),
    "workspace.projects",
  );
  validateWorkItemRelationships(projects, "workspace.projects");
  const projectDecisionEvents = uniqueIds(
    boundedArray(
      hasProjectDecisionEvents ? source.projectDecisionEvents : [],
      LIMITS.projectDecisionEvents,
      "workspace.projectDecisionEvents",
    ).map((entry, index) =>
      parseProjectDecisionEvent(
        entry,
        `workspace.projectDecisionEvents[${index}]`,
      ),
    ),
    "workspace.projectDecisionEvents",
  );
  validateProjectDecisionEvents(
    projectDecisionEvents,
    new Set(projects.map((project) => project.id)),
    "workspace.projectDecisionEvents",
  );
  const taskLinkSegments = new Map<string, CodexTaskAttempt[]>();
  const decidedResults = new Map<
    string,
    { decision: ResultDecision; reviewedAt: string }
  >();
  const liveWorkItems = new Set<string>();
  const liveResults = new Set<string>();
  for (const project of projects) {
    for (const objective of project.objectives) {
      for (const workItem of objective.workItems) {
        liveWorkItems.add(
          reviewAssessmentTargetIdentity({
            projectId: project.id,
            objectiveId: objective.id,
            workItemId: workItem.id,
          }),
        );
        for (const attempt of workItem.attempts) {
          const segments = taskLinkSegments.get(attempt.codexTaskId) ?? [];
          segments.push(attempt);
          taskLinkSegments.set(attempt.codexTaskId, segments);
          for (const result of attempt.resultCycles) {
            const target = resultTargetIdentity(
              project.id,
              objective.id,
              workItem.id,
              attempt.id,
              result.key,
            );
            liveResults.add(target);
            if (result.review?.decision) {
              decidedResults.set(target, {
                decision: result.review.decision,
                reviewedAt: result.review.reviewedAt,
              });
            }
          }
        }
      }
    }
  }
  const reviewAssessments = boundedArray(
    hasReviewAssessments ? source.reviewAssessments : [],
    LIMITS.reviewAssessments,
    "workspace.reviewAssessments",
  ).map((entry, index) =>
    parseReviewAssessment(entry, `workspace.reviewAssessments[${index}]`),
  );
  const assessmentTargets = new Set<string>();
  for (const assessment of reviewAssessments) {
    const identity = reviewAssessmentTargetIdentity(assessment.target);
    if (assessmentTargets.has(identity)) {
      fail("workspace.reviewAssessments", "duplicate assessment target");
    }
    assessmentTargets.add(identity);
    const targetExists = isResultReviewAssessmentTarget(assessment.target)
      ? liveResults.has(
          resultTargetIdentity(
            assessment.target.projectId,
            assessment.target.objectiveId,
            assessment.target.workItemId,
            assessment.target.attemptId,
            assessment.target.resultKey,
          ),
        )
      : liveWorkItems.has(identity);
    if (!targetExists) {
      fail(
        "workspace.reviewAssessments",
        "assessment targets an unknown work item or result",
      );
    }
  }
  const decisionRequests = uniqueIds(
    boundedArray(
      hasDecisionRequests ? source.decisionRequests : [],
      LIMITS.decisionRequests,
      "workspace.decisionRequests",
    ).map((entry, index) =>
      parseDecisionRequest(entry, `workspace.decisionRequests[${index}]`),
    ),
    "workspace.decisionRequests",
  );
  for (const request of decisionRequests) {
    if (!reviewAssessmentTargetExists(projects, request.target)) {
      fail(
        "workspace.decisionRequests",
        "decision request targets an unknown work item or result",
      );
    }
  }
  for (const [codexTaskId, segments] of taskLinkSegments) {
    const open = segments.filter((attempt) => !attempt.unlinkedAt);
    if (open.length > 1) {
      fail(
        "workspace.projects",
        `Codex task ${codexTaskId} has more than one open link`,
      );
    }
    const ordered = [...segments].sort((left, right) => {
      const start = Date.parse(left.linkedAt) - Date.parse(right.linkedAt);
      if (start !== 0) return start;
      const leftEnd = left.unlinkedAt
        ? Date.parse(left.unlinkedAt)
        : Number.POSITIVE_INFINITY;
      const rightEnd = right.unlinkedAt
        ? Date.parse(right.unlinkedAt)
        : Number.POSITIVE_INFINITY;
      return leftEnd - rightEnd || left.id.localeCompare(right.id);
    });
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1];
      if (
        !previous.unlinkedAt ||
        Date.parse(previous.unlinkedAt) > Date.parse(ordered[index].linkedAt)
      ) {
        fail(
          "workspace.projects",
          `Codex task ${codexTaskId} has overlapping links`,
        );
      }
    }
    const taskResultKeys = new Set<string>();
    for (const attempt of segments) {
      for (const result of attempt.resultCycles) {
        const identity = resultKeyIdentity(result.key);
        if (taskResultKeys.has(identity)) {
          fail(
            "workspace.projects",
            `Codex task ${codexTaskId} repeats result key ${identity} across links`,
          );
        }
        taskResultKeys.add(identity);
      }
    }
  }
  const evidence = uniqueIds(
    boundedArray(source.evidence, LIMITS.evidence, "workspace.evidence").map(
      (entry, index) => parseEvidence(entry, `workspace.evidence[${index}]`),
    ),
    "workspace.evidence",
  );
  const decisionEvidenceCounts = new Map<string, number>();
  for (const item of evidence) {
    if (item.kind !== "decision") continue;
    const target = resultTargetIdentity(
      item.projectId,
      item.objectiveId!,
      item.workItemId!,
      item.attemptId!,
      item.resultKey!,
    );
    const decided = decidedResults.get(target);
    if (!decided) {
      if (liveResults.has(target)) {
        fail(
          "workspace.evidence",
          `decision evidence ${item.id} targets an undecided result`,
        );
      }
      continue;
    }
    if (item.decisionKind !== decided.decision.kind) {
      fail(
        "workspace.evidence",
        `decision evidence ${item.id} does not match a decided result`,
      );
    }
    if (Date.parse(item.recordedAt) < Date.parse(decided.decision.decidedAt)) {
      fail(
        "workspace.evidence",
        `decision evidence ${item.id} predates its decision`,
      );
    }
    decisionEvidenceCounts.set(
      target,
      (decisionEvidenceCounts.get(target) ?? 0) + 1,
    );
  }
  for (const target of decidedResults.keys()) {
    if (decisionEvidenceCounts.get(target) !== 1) {
      fail(
        "workspace.evidence",
        "each decided result requires exactly one matching evidence receipt",
      );
    }
  }
  const verificationReceipts = uniqueIds(
    boundedArray(
      isLegacyV1 ? [] : source.verificationReceipts,
      LIMITS.verificationReceipts,
      "workspace.verificationReceipts",
    ).map((entry, index) =>
      parseVerificationReceipt(
        entry,
        `workspace.verificationReceipts[${index}]`,
      ),
    ),
    "workspace.verificationReceipts",
  );
  const idempotencyKeys = new Set<string>();
  for (const receipt of verificationReceipts) {
    if (idempotencyKeys.has(receipt.idempotencyKey)) {
      fail(
        "workspace.verificationReceipts",
        `duplicate idempotency key ${receipt.idempotencyKey}`,
      );
    }
    idempotencyKeys.add(receipt.idempotencyKey);
    const target = resultTargetIdentity(
      receipt.target.projectId,
      receipt.target.objectiveId,
      receipt.target.workItemId,
      receipt.target.attemptId,
      receipt.target.resultKey,
    );
    if (!liveResults.has(target)) {
      fail(
        "workspace.verificationReceipts",
        `verification receipt ${receipt.id} targets an unknown result`,
      );
    }
  }
  return {
    schemaVersion: COFFICE_WORKSPACE_SCHEMA_VERSION,
    revision: source.revision as number,
    createdAt: timestamp(source.createdAt, "workspace.createdAt"),
    updatedAt: timestamp(source.updatedAt, "workspace.updatedAt"),
    projects,
    projectDecisionEvents,
    attentionReview: parseAttention(
      source.attentionReview,
      "workspace.attentionReview",
    ),
    reviewAssessments,
    decisionRequests,
    evidence,
    migrations: parseMigrations(source.migrations, "workspace.migrations"),
    mutationReceipts: uniqueIds(
      boundedArray(
        source.mutationReceipts,
        1_024,
        "workspace.mutationReceipts",
      ).map((entry, index) =>
        parseMutationReceipt(entry, `workspace.mutationReceipts[${index}]`),
      ),
      "workspace.mutationReceipts",
    ),
    verificationReceipts,
  };
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stable(item)]),
    );
  }
  return value;
}

export function serializeCofficeWorkspace(workspace: CofficeWorkspace): string {
  const serialized = `${JSON.stringify(stable(parseCofficeWorkspace(workspace)), null, 2)}\n`;
  if (
    new TextEncoder().encode(serialized).byteLength >
    MAX_COFFICE_WORKSPACE_BYTES
  ) {
    fail(
      "workspace",
      `serialized data exceeds ${MAX_COFFICE_WORKSPACE_BYTES} bytes`,
    );
  }
  return serialized;
}

export function parseSerializedCofficeWorkspace(raw: string): CofficeWorkspace {
  if (new TextEncoder().encode(raw).byteLength > MAX_COFFICE_WORKSPACE_BYTES) {
    fail("workspace", `file exceeds ${MAX_COFFICE_WORKSPACE_BYTES} bytes`);
  }
  try {
    return parseCofficeWorkspace(JSON.parse(raw));
  } catch (error) {
    if (error instanceof CofficeWorkspaceValidationError) throw error;
    throw new CofficeWorkspaceValidationError("workspace: invalid JSON");
  }
}

export function parseWorkspaceMutation(value: unknown): WorkspaceMutation {
  const source = record(value, "mutation");
  const type = boundedString(source.type, 64, "mutation.type");
  switch (type) {
    case "project.upsert":
      exactKeys(source, ["type", "project"], [], "mutation");
      return {
        type,
        project: parseProject(source.project, "mutation.project"),
      };
    case "project.remove":
      exactKeys(source, ["type", "projectId"], [], "mutation");
      return {
        type,
        projectId: boundedString(
          source.projectId,
          LIMITS.id,
          "mutation.projectId",
        ),
      };
    case "project.rules.set":
      exactKeys(source, ["type", "projectId", "rules"], [], "mutation");
      return {
        type,
        projectId: boundedString(
          source.projectId,
          LIMITS.id,
          "mutation.projectId",
        ),
        rules: parseProjectRules(source.rules, "mutation.rules", true),
      };
    case "project.qualityBars.set":
      exactKeys(source, ["type", "projectId", "qualityBars"], [], "mutation");
      return {
        type,
        projectId: boundedString(
          source.projectId,
          LIMITS.id,
          "mutation.projectId",
        ),
        qualityBars: parseProjectQualityBars(
          source.qualityBars,
          "mutation.qualityBars",
          true,
        ),
      };
    case "project.contextReview.set": {
      exactKeys(
        source,
        ["type", "projectId", "concerns"],
        ["note"],
        "mutation",
      );
      const note = normalizedOptionalProjectContextNote(
        source.note,
        "mutation.note",
      );
      return {
        type,
        projectId: boundedString(
          source.projectId,
          LIMITS.id,
          "mutation.projectId",
        ),
        concerns: parseProjectContextConcerns(
          source.concerns,
          "mutation.concerns",
        ),
        ...(note ? { note } : {}),
      };
    }
    case "project.contextReview.clear":
      exactKeys(source, ["type", "projectId"], [], "mutation");
      return {
        type,
        projectId: boundedString(
          source.projectId,
          LIMITS.id,
          "mutation.projectId",
        ),
      };
    case "project.reviewSchedule.set":
      exactKeys(
        source,
        ["type", "projectId", "nextReviewAt"],
        ["repeatEveryDays"],
        "mutation",
      );
      return {
        type,
        projectId: boundedString(
          source.projectId,
          LIMITS.id,
          "mutation.projectId",
        ),
        nextReviewAt: timestamp(source.nextReviewAt, "mutation.nextReviewAt"),
        ...(source.repeatEveryDays === undefined
          ? {}
          : {
              repeatEveryDays: projectReviewRepeatDays(
                source.repeatEveryDays,
                "mutation.repeatEveryDays",
              ),
            }),
      };
    case "project.reviewSchedule.complete":
    case "project.reviewSchedule.clear":
      exactKeys(source, ["type", "projectId"], [], "mutation");
      return {
        type,
        projectId: boundedString(
          source.projectId,
          LIMITS.id,
          "mutation.projectId",
        ),
      };
    case "projectDecision.record":
      exactKeys(
        source,
        ["type", "id", "projectId", "statement"],
        ["context"],
        "mutation",
      );
      return {
        type,
        id: structuralIdentifier(source.id, LIMITS.id, "mutation.id"),
        projectId: boundedString(
          source.projectId,
          LIMITS.id,
          "mutation.projectId",
        ),
        statement: meaningfulProjectDecisionText(
          source.statement,
          MAX_PROJECT_DECISION_STATEMENT_LENGTH,
          "mutation.statement",
        ),
        ...(source.context === undefined
          ? {}
          : {
              context: meaningfulProjectDecisionText(
                source.context,
                MAX_PROJECT_DECISION_CONTEXT_LENGTH,
                "mutation.context",
              ),
            }),
      };
    case "projectDecision.supersede":
      exactKeys(
        source,
        [
          "type",
          "id",
          "projectId",
          "supersedesId",
          "supersessionKind",
          "statement",
        ],
        ["context"],
        "mutation",
      );
      return {
        type,
        id: structuralIdentifier(source.id, LIMITS.id, "mutation.id"),
        projectId: boundedString(
          source.projectId,
          LIMITS.id,
          "mutation.projectId",
        ),
        supersedesId: structuralIdentifier(
          source.supersedesId,
          LIMITS.id,
          "mutation.supersedesId",
        ),
        supersessionKind: oneOf(
          source.supersessionKind,
          ["correction", "replacement"],
          "mutation.supersessionKind",
        ),
        statement: meaningfulProjectDecisionText(
          source.statement,
          MAX_PROJECT_DECISION_STATEMENT_LENGTH,
          "mutation.statement",
        ),
        ...(source.context === undefined
          ? {}
          : {
              context: meaningfulProjectDecisionText(
                source.context,
                MAX_PROJECT_DECISION_CONTEXT_LENGTH,
                "mutation.context",
              ),
            }),
      };
    case "projectDecision.withdraw":
      exactKeys(
        source,
        ["type", "id", "projectId", "supersedesId"],
        ["reason"],
        "mutation",
      );
      return {
        type,
        id: structuralIdentifier(source.id, LIMITS.id, "mutation.id"),
        projectId: boundedString(
          source.projectId,
          LIMITS.id,
          "mutation.projectId",
        ),
        supersedesId: structuralIdentifier(
          source.supersedesId,
          LIMITS.id,
          "mutation.supersedesId",
        ),
        ...(source.reason === undefined
          ? {}
          : {
              reason: meaningfulProjectDecisionText(
                source.reason,
                MAX_PROJECT_DECISION_CONTEXT_LENGTH,
                "mutation.reason",
              ),
            }),
      };
    case "objective.upsert":
      exactKeys(source, ["type", "projectId", "objective"], [], "mutation");
      return {
        type,
        projectId: boundedString(
          source.projectId,
          LIMITS.id,
          "mutation.projectId",
        ),
        objective: parseObjective(source.objective, "mutation.objective"),
      };
    case "objective.remove":
      exactKeys(source, ["type", "projectId", "objectiveId"], [], "mutation");
      return {
        type,
        projectId: boundedString(
          source.projectId,
          LIMITS.id,
          "mutation.projectId",
        ),
        objectiveId: boundedString(
          source.objectiveId,
          LIMITS.id,
          "mutation.objectiveId",
        ),
      };
    case "workItem.upsert":
      exactKeys(
        source,
        ["type", "projectId", "objectiveId", "workItem"],
        [],
        "mutation",
      );
      return {
        type,
        projectId: boundedString(
          source.projectId,
          LIMITS.id,
          "mutation.projectId",
        ),
        objectiveId: boundedString(
          source.objectiveId,
          LIMITS.id,
          "mutation.objectiveId",
        ),
        workItem: parseWorkItem(source.workItem, "mutation.workItem"),
      };
    case "workItem.definitionOfDone.set":
      exactKeys(
        source,
        ["type", "projectId", "objectiveId", "workItemId", "definitionOfDone"],
        [],
        "mutation",
      );
      return {
        type,
        projectId: boundedString(
          source.projectId,
          LIMITS.id,
          "mutation.projectId",
        ),
        objectiveId: boundedString(
          source.objectiveId,
          LIMITS.id,
          "mutation.objectiveId",
        ),
        workItemId: boundedString(
          source.workItemId,
          LIMITS.id,
          "mutation.workItemId",
        ),
        definitionOfDone: parseDefinitionOfDone(
          source.definitionOfDone,
          "mutation.definitionOfDone",
          true,
        ),
      };
    case "workItem.relationships.set":
      exactKeys(
        source,
        ["type", "projectId", "objectiveId", "workItemId", "relationships"],
        [],
        "mutation",
      );
      return {
        type,
        projectId: boundedString(
          source.projectId,
          LIMITS.id,
          "mutation.projectId",
        ),
        objectiveId: boundedString(
          source.objectiveId,
          LIMITS.id,
          "mutation.objectiveId",
        ),
        workItemId: boundedString(
          source.workItemId,
          LIMITS.id,
          "mutation.workItemId",
        ),
        relationships: parseWorkItemRelationships(
          source.relationships,
          "mutation.relationships",
          true,
        ),
      };
    case "workItem.remove":
      exactKeys(
        source,
        ["type", "projectId", "objectiveId", "workItemId"],
        [],
        "mutation",
      );
      return {
        type,
        projectId: boundedString(
          source.projectId,
          LIMITS.id,
          "mutation.projectId",
        ),
        objectiveId: boundedString(
          source.objectiveId,
          LIMITS.id,
          "mutation.objectiveId",
        ),
        workItemId: boundedString(
          source.workItemId,
          LIMITS.id,
          "mutation.workItemId",
        ),
      };
    case "workItem.reorder": {
      exactKeys(
        source,
        ["type", "projectId", "objectiveId", "orderedWorkItemIds"],
        [],
        "mutation",
      );
      const orderedWorkItemIds = boundedArray(
        source.orderedWorkItemIds,
        LIMITS.workItemsPerObjective,
        "mutation.orderedWorkItemIds",
      ).map((id, index) =>
        boundedString(id, LIMITS.id, `mutation.orderedWorkItemIds[${index}]`),
      );
      const uniqueWorkItemIds = new Set(orderedWorkItemIds);
      if (uniqueWorkItemIds.size !== orderedWorkItemIds.length) {
        fail("mutation.orderedWorkItemIds", "duplicate work item id");
      }
      return {
        type,
        projectId: boundedString(
          source.projectId,
          LIMITS.id,
          "mutation.projectId",
        ),
        objectiveId: boundedString(
          source.objectiveId,
          LIMITS.id,
          "mutation.objectiveId",
        ),
        orderedWorkItemIds,
      };
    }
    case "attempt.upsert":
      exactKeys(
        source,
        ["type", "projectId", "objectiveId", "workItemId", "attempt"],
        [],
        "mutation",
      );
      return {
        type,
        projectId: boundedString(
          source.projectId,
          LIMITS.id,
          "mutation.projectId",
        ),
        objectiveId: boundedString(
          source.objectiveId,
          LIMITS.id,
          "mutation.objectiveId",
        ),
        workItemId: boundedString(
          source.workItemId,
          LIMITS.id,
          "mutation.workItemId",
        ),
        attempt: parseAttempt(source.attempt, "mutation.attempt"),
      };
    case "taskLink.move":
      exactKeys(
        source,
        ["type", "codexTaskId", "from", "to", "movedAt"],
        ["baselineResultKey"],
        "mutation",
      );
      return {
        type,
        codexTaskId: structuralIdentifier(
          source.codexTaskId,
          LIMITS.id,
          "mutation.codexTaskId",
        ),
        from: parseTaskLinkLocation(source.from, "mutation.from"),
        to: parseTaskLinkLocation(source.to, "mutation.to"),
        movedAt: timestamp(source.movedAt, "mutation.movedAt"),
        ...(source.baselineResultKey === undefined
          ? {}
          : {
              baselineResultKey: parseResultKey(
                source.baselineResultKey,
                "mutation.baselineResultKey",
              ),
            }),
      };
    case "taskLink.unlink":
      exactKeys(
        source,
        ["type", "codexTaskId", "from", "unlinkedAt"],
        [],
        "mutation",
      );
      return {
        type,
        codexTaskId: structuralIdentifier(
          source.codexTaskId,
          LIMITS.id,
          "mutation.codexTaskId",
        ),
        from: parseTaskLinkLocation(source.from, "mutation.from"),
        unlinkedAt: timestamp(source.unlinkedAt, "mutation.unlinkedAt"),
      };
    case "result.upsert":
      exactKeys(
        source,
        [
          "type",
          "projectId",
          "objectiveId",
          "workItemId",
          "attemptId",
          "result",
        ],
        [],
        "mutation",
      );
      return {
        type,
        projectId: boundedString(
          source.projectId,
          LIMITS.id,
          "mutation.projectId",
        ),
        objectiveId: boundedString(
          source.objectiveId,
          LIMITS.id,
          "mutation.objectiveId",
        ),
        workItemId: boundedString(
          source.workItemId,
          LIMITS.id,
          "mutation.workItemId",
        ),
        attemptId: boundedString(
          source.attemptId,
          LIMITS.id,
          "mutation.attemptId",
        ),
        result: (() => {
          const result = parseResultCycle(source.result, "mutation.result");
          if (result.review) {
            fail(
              "mutation.result",
              "an observed result cannot include review state",
            );
          }
          return { key: result.key, observedAt: result.observedAt };
        })(),
      };
    case "result.review":
      exactKeys(
        source,
        [
          "type",
          "projectId",
          "objectiveId",
          "workItemId",
          "attemptId",
          "resultKey",
          "reviewedAt",
        ],
        [],
        "mutation",
      );
      return {
        type,
        projectId: boundedString(
          source.projectId,
          LIMITS.id,
          "mutation.projectId",
        ),
        objectiveId: boundedString(
          source.objectiveId,
          LIMITS.id,
          "mutation.objectiveId",
        ),
        workItemId: boundedString(
          source.workItemId,
          LIMITS.id,
          "mutation.workItemId",
        ),
        attemptId: boundedString(
          source.attemptId,
          LIMITS.id,
          "mutation.attemptId",
        ),
        resultKey: parseResultKey(source.resultKey, "mutation.resultKey"),
        reviewedAt: timestamp(source.reviewedAt, "mutation.reviewedAt"),
      };
    case "result.decide":
      exactKeys(
        source,
        [
          "type",
          "projectId",
          "objectiveId",
          "workItemId",
          "attemptId",
          "resultKey",
          "decision",
          "evidence",
        ],
        [],
        "mutation",
      );
      return {
        type,
        projectId: boundedString(
          source.projectId,
          LIMITS.id,
          "mutation.projectId",
        ),
        objectiveId: boundedString(
          source.objectiveId,
          LIMITS.id,
          "mutation.objectiveId",
        ),
        workItemId: boundedString(
          source.workItemId,
          LIMITS.id,
          "mutation.workItemId",
        ),
        attemptId: boundedString(
          source.attemptId,
          LIMITS.id,
          "mutation.attemptId",
        ),
        resultKey: parseResultKey(source.resultKey, "mutation.resultKey"),
        decision: parseDecision(source.decision, "mutation.decision"),
        evidence: parseEvidence(source.evidence, "mutation.evidence"),
      };
    case "evidence.append":
      exactKeys(source, ["type", "record"], [], "mutation");
      return { type, record: parseEvidence(source.record, "mutation.record") };
    case "attention.update":
    case "attention.replace":
      exactKeys(source, ["type", "state"], [], "mutation");
      return { type, state: parseAttention(source.state, "mutation.state") };
    case "attention.event":
      exactKeys(
        source,
        ["type", "eventKey", "disposition", "snoozedUntil"],
        [],
        "mutation",
      );
      const disposition =
        source.disposition === null
          ? null
          : parseAttentionDisposition(
              source.disposition,
              "mutation.disposition",
            );
      const snoozedUntil =
        source.snoozedUntil === null
          ? null
          : timestamp(source.snoozedUntil, "mutation.snoozedUntil");
      if (snoozedUntil && disposition?.kind !== "needs_review") {
        fail(
          "mutation.snoozedUntil",
          "a snooze requires a needs_review disposition",
        );
      }
      if (
        snoozedUntil &&
        disposition &&
        Date.parse(snoozedUntil) <= Date.parse(disposition.at)
      ) {
        fail(
          "mutation.snoozedUntil",
          "a snooze must end after its disposition",
        );
      }
      return {
        type,
        eventKey: boundedString(source.eventKey, 320, "mutation.eventKey"),
        disposition,
        snoozedUntil,
      };
    case "attention.import":
      exactKeys(source, ["type", "state", "importedAt"], [], "mutation");
      return {
        type,
        state: parseAttention(source.state, "mutation.state"),
        importedAt: timestamp(source.importedAt, "mutation.importedAt"),
      };
    case "assessment.set":
      exactKeys(source, ["type", "assessment"], [], "mutation");
      return {
        type,
        assessment: parseReviewAssessmentDraft(
          source.assessment,
          "mutation.assessment",
        ),
      };
    case "assessment.clear":
      exactKeys(source, ["type", "target"], [], "mutation");
      return {
        type,
        target: parseReviewAssessmentTarget(source.target, "mutation.target"),
      };
    case "decisionRequest.create":
      exactKeys(source, ["type", "request"], [], "mutation");
      return {
        type,
        request: parseDecisionRequestDraft(source.request, "mutation.request"),
      };
    case "decisionRequest.update":
      exactKeys(source, ["type", "id", "prompt"], [], "mutation");
      return {
        type,
        id: structuralIdentifier(source.id, LIMITS.id, "mutation.id"),
        prompt: meaningfulDecisionRequestText(source.prompt, "mutation.prompt"),
      };
    case "decisionRequest.resolve":
      exactKeys(source, ["type", "id"], ["resolution"], "mutation");
      return {
        type,
        id: structuralIdentifier(source.id, LIMITS.id, "mutation.id"),
        ...(source.resolution === undefined
          ? {}
          : {
              resolution: meaningfulDecisionRequestText(
                source.resolution,
                "mutation.resolution",
              ),
            }),
      };
    case "decisionRequest.reopen":
    case "decisionRequest.remove":
      exactKeys(source, ["type", "id"], [], "mutation");
      return {
        type,
        id: structuralIdentifier(source.id, LIMITS.id, "mutation.id"),
      };
    default:
      fail("mutation.type", `unsupported mutation ${type}`);
  }
}

export function serializeWorkspaceMutation(
  mutation: WorkspaceMutation,
): string {
  return JSON.stringify(stable(parseWorkspaceMutation(mutation)));
}

export function parseVerificationStartRequest(
  value: unknown,
): VerificationStartRequest {
  const source = record(value, "verificationStart");
  exactKeys(
    source,
    ["id", "idempotencyKey", "target", "profile", "checks"],
    [],
    "verificationStart",
  );
  const checks = uniqueIds(
    boundedArray(
      source.checks,
      LIMITS.checksPerVerification,
      "verificationStart.checks",
    ).map((entry, index) =>
      parseVerificationCheckRef(entry, `verificationStart.checks[${index}]`),
    ),
    "verificationStart.checks",
  );
  if (checks.length === 0) {
    fail("verificationStart.checks", "expected at least one check");
  }
  return {
    id: structuralIdentifier(source.id, LIMITS.id, "verificationStart.id"),
    idempotencyKey: structuralIdentifier(
      source.idempotencyKey,
      LIMITS.id,
      "verificationStart.idempotencyKey",
    ),
    target: parseVerificationTarget(source.target, "verificationStart.target"),
    profile: parseVerificationProfileRef(
      source.profile,
      "verificationStart.profile",
    ),
    checks,
  };
}

export function serializeVerificationStartRequest(
  request: VerificationStartRequest,
): string {
  const parsed = parseVerificationStartRequest(request);
  return JSON.stringify(
    stable({
      target: parsed.target,
      profile: parsed.profile,
      checks: parsed.checks,
    }),
  );
}

export function createVerificationReceipt(
  request: VerificationStartRequest,
  requestHash: string,
  now: string,
): VerificationReceipt {
  const parsed = parseVerificationStartRequest(request);
  const queuedAt = timestamp(now, "now");
  return parseVerificationReceipt(
    {
      id: parsed.id,
      idempotencyKey: parsed.idempotencyKey,
      requestHash,
      target: parsed.target,
      profile: parsed.profile,
      checks: parsed.checks.map((check) => ({
        ...check,
        state: "queued",
        queuedAt,
      })),
      state: "queued",
      queuedAt,
    },
    "verificationReceipt",
  );
}

export function transitionVerificationReceipt(
  receipt: VerificationReceipt,
  transition: VerificationCheckTransition,
  now: string,
): VerificationReceipt {
  const current = parseVerificationReceipt(receipt, "verificationReceipt");
  const at = timestamp(now, "now");
  const checkRef = parseVerificationCheckRef(
    transition.check,
    "verificationTransition.check",
  );
  const nextState = oneOf(
    transition.state,
    ["running", "passed", "failed", "unknown"],
    "verificationTransition.state",
  );
  const failureKind =
    transition.failureKind === undefined
      ? undefined
      : oneOf(
          transition.failureKind,
          ["exit", "timeout", "launch"],
          "verificationTransition.failureKind",
        );
  const exitCode = transition.exitCode;
  if (
    exitCode !== undefined &&
    (!Number.isSafeInteger(exitCode) ||
      exitCode < -2_147_483_648 ||
      exitCode > 2_147_483_647)
  ) {
    fail("verificationTransition.exitCode", "expected a signed 32-bit integer");
  }
  if (exitCode !== undefined && failureKind !== "exit") {
    fail(
      "verificationTransition",
      "exitCode is allowed only for an exit failure",
    );
  }
  if (exitCode === 0) {
    fail(
      "verificationTransition",
      "an exit failure cannot have exit code zero",
    );
  }
  if ((nextState === "failed") !== Boolean(failureKind)) {
    fail(
      "verificationTransition",
      "failureKind is required only for failed transitions",
    );
  }
  const index = current.checks.findIndex(
    (check) => check.id === checkRef.id && check.version === checkRef.version,
  );
  if (index < 0) {
    fail(
      "verificationTransition.check",
      `unknown check ${checkRef.id}@${checkRef.version}`,
    );
  }
  const selected = current.checks[index];
  if (
    selected.state === nextState &&
    selected.failureKind === failureKind &&
    selected.exitCode === exitCode
  ) {
    return current;
  }
  if (
    selected.state === "passed" ||
    selected.state === "failed" ||
    selected.state === "unknown"
  ) {
    fail("verificationTransition.state", "a terminal check cannot transition");
  }
  if (selected.state === "queued" && nextState === "passed") {
    fail(
      "verificationTransition.state",
      "a queued check must run before passing",
    );
  }
  if (selected.state === "running" && nextState === "running") {
    return current;
  }
  if (Date.parse(at) < Date.parse(selected.startedAt ?? selected.queuedAt)) {
    fail("verificationTransition", "timestamp cannot move backwards");
  }
  const terminal = nextState !== "running";
  let checks = current.checks.map((check, checkIndex) =>
    checkIndex === index
      ? {
          ...check,
          state: nextState,
          startedAt: check.startedAt ?? at,
          ...(terminal ? { completedAt: at } : {}),
          ...(failureKind ? { failureKind } : {}),
          ...(exitCode === undefined ? {} : { exitCode }),
        }
      : check,
  );
  if (nextState === "failed" || nextState === "unknown") {
    checks = checks.map((check) =>
      check.state === "queued" || check.state === "running"
        ? {
            ...check,
            state: "unknown" as const,
            startedAt: check.startedAt ?? at,
            completedAt: at,
          }
        : check,
    );
  }
  const state = expectedVerificationState(checks);
  const startedAt = checks
    .map((check) => check.startedAt)
    .filter((candidate): candidate is string => Boolean(candidate))
    .sort()[0];
  const completedAt =
    state === "passed" || state === "failed" || state === "unknown"
      ? checks
          .map((check) => check.completedAt)
          .filter((candidate): candidate is string => Boolean(candidate))
          .sort()
          .at(-1)
      : undefined;
  return parseVerificationReceipt(
    {
      ...current,
      checks,
      state,
      ...(startedAt ? { startedAt } : {}),
      ...(completedAt ? { completedAt } : {}),
    },
    "verificationReceipt",
  );
}

export function createEmptyCofficeWorkspace(now: string): CofficeWorkspace {
  const validNow = timestamp(now, "now");
  return {
    schemaVersion: COFFICE_WORKSPACE_SCHEMA_VERSION,
    revision: 0,
    createdAt: validNow,
    updatedAt: validNow,
    projects: [],
    projectDecisionEvents: [],
    attentionReview: createInitialAttentionReviewState(validNow),
    reviewAssessments: [],
    decisionRequests: [],
    evidence: [],
    migrations: {},
    mutationReceipts: [],
    verificationReceipts: [],
  };
}

function replaceById<T extends { id: string }>(items: T[], item: T): T[] {
  const index = items.findIndex((candidate) => candidate.id === item.id);
  return index < 0
    ? [...items, item]
    : items.map((candidate, candidateIndex) =>
        candidateIndex === index ? item : candidate,
      );
}

interface LocatedAttempt extends TaskLinkLocation {
  attempt: CodexTaskAttempt;
}

function locatedAttempts(workspace: CofficeWorkspace): LocatedAttempt[] {
  const attempts: LocatedAttempt[] = [];
  for (const project of workspace.projects) {
    for (const objective of project.objectives) {
      for (const workItem of objective.workItems) {
        for (const attempt of workItem.attempts) {
          attempts.push({
            projectId: project.id,
            objectiveId: objective.id,
            workItemId: workItem.id,
            attemptId: attempt.id,
            attempt,
          });
        }
      }
    }
  }
  return attempts;
}

function taskLinkLocationIdentity(location: TaskLinkLocation): string {
  return [
    location.projectId,
    location.objectiveId,
    location.workItemId,
    location.attemptId,
  ].join("\u001f");
}

function sameAttempt(left: CodexTaskAttempt, right: CodexTaskAttempt): boolean {
  return JSON.stringify(stable(left)) === JSON.stringify(stable(right));
}

function rejectGenericAttemptHistoryRewrite(
  current: CofficeWorkspace,
  next: CofficeWorkspace,
  allowInitialAttemptAppend = false,
) {
  const before = locatedAttempts(current);
  const after = locatedAttempts(next);
  const beforeByLocation = new Map(
    before.map((entry) => [taskLinkLocationIdentity(entry), entry.attempt]),
  );
  const afterByLocation = new Map(
    after.map((entry) => [taskLinkLocationIdentity(entry), entry.attempt]),
  );
  for (const [location, attempt] of beforeByLocation) {
    const candidate = afterByLocation.get(location);
    if (!candidate || !sameAttempt(attempt, candidate)) {
      fail(
        "mutation",
        "generic mutations cannot replace, remove, or reorder task-link history",
      );
    }
  }
  if (!allowInitialAttemptAppend) {
    for (const project of current.projects) {
      const nextProject = next.projects.find(
        (candidate) => candidate.id === project.id,
      );
      if (!nextProject) continue;
      for (const objective of project.objectives) {
        const nextObjective = nextProject.objectives.find(
          (candidate) => candidate.id === objective.id,
        );
        if (!nextObjective) continue;
        for (const workItem of objective.workItems) {
          const nextWorkItem = nextObjective.workItems.find(
            (candidate) => candidate.id === workItem.id,
          );
          if (!nextWorkItem) continue;
          if (
            JSON.stringify(workItem.attempts.map((attempt) => attempt.id)) !==
            JSON.stringify(nextWorkItem.attempts.map((attempt) => attempt.id))
          ) {
            fail(
              "mutation",
              "an existing work item cannot replace, remove, reorder, or append task links",
            );
          }
        }
      }
    }
  }
  const historicalTaskIds = new Set(
    before.map((entry) => entry.attempt.codexTaskId),
  );
  for (const entry of after) {
    if (beforeByLocation.has(taskLinkLocationIdentity(entry))) continue;
    if (historicalTaskIds.has(entry.attempt.codexTaskId)) {
      fail("mutation", "a task with prior link history requires taskLink.move");
    }
    if (
      entry.attempt.relationship === "continuation" ||
      entry.attempt.unlinkedAt ||
      entry.attempt.observeResultsAfterKey
    ) {
      fail(
        "mutation",
        "generic mutations can create only an initial open task link",
      );
    }
  }
}

function replaceAttemptAt(
  projects: WorkspaceProject[],
  location: TaskLinkLocation,
  attempt: CodexTaskAttempt,
  at: string,
): WorkspaceProject[] {
  return projects.map((project) =>
    project.id !== location.projectId
      ? project
      : {
          ...project,
          updatedAt: at,
          objectives: project.objectives.map((objective) =>
            objective.id !== location.objectiveId
              ? objective
              : {
                  ...objective,
                  updatedAt: at,
                  workItems: objective.workItems.map((workItem) =>
                    workItem.id !== location.workItemId
                      ? workItem
                      : {
                          ...workItem,
                          updatedAt: at,
                          attempts: workItem.attempts.map((candidate) =>
                            candidate.id === location.attemptId
                              ? attempt
                              : candidate,
                          ),
                        },
                  ),
                },
          ),
        },
  );
}

function appendAttemptAt(
  projects: WorkspaceProject[],
  location: TaskLinkLocation,
  attempt: CodexTaskAttempt,
  at: string,
): WorkspaceProject[] {
  return projects.map((project) =>
    project.id !== location.projectId
      ? project
      : {
          ...project,
          updatedAt: at,
          objectives: project.objectives.map((objective) =>
            objective.id !== location.objectiveId
              ? objective
              : {
                  ...objective,
                  updatedAt: at,
                  workItems: objective.workItems.map((workItem) =>
                    workItem.id !== location.workItemId
                      ? workItem
                      : {
                          ...workItem,
                          updatedAt: at,
                          attempts: [...workItem.attempts, attempt],
                        },
                  ),
                },
          ),
        },
  );
}

export function reduceCofficeWorkspace(
  workspace: CofficeWorkspace,
  mutation: WorkspaceMutation,
  now: string,
): CofficeWorkspace {
  const current = parseCofficeWorkspace(workspace);
  mutation = parseWorkspaceMutation(mutation);
  const at = timestamp(now, "now");
  const findProject = (id: string) => {
    const project = current.projects.find((candidate) => candidate.id === id);
    if (!project) fail("mutation.projectId", `unknown project ${id}`);
    return project;
  };
  const appendProjectDecisionEvent = (event: ProjectDecisionEvent) => {
    if (current.projectDecisionEvents.length >= LIMITS.projectDecisionEvents) {
      fail(
        "mutation",
        `project decision history is limited to ${LIMITS.projectDecisionEvents} events`,
      );
    }
    if (
      current.projectDecisionEvents.some(
        (candidate) => candidate.id === event.id,
      )
    ) {
      fail("mutation.id", `duplicate project decision event id ${event.id}`);
    }
    findProject(event.projectId);
    if (event.action !== "recorded") {
      if (event.id === event.supersedesId) {
        fail("mutation.supersedesId", "an event cannot supersede itself");
      }
      const target = current.projectDecisionEvents.find(
        (candidate) => candidate.id === event.supersedesId,
      );
      if (!target) {
        fail(
          "mutation.supersedesId",
          `unknown project decision event ${event.supersedesId}`,
        );
      }
      if (target.projectId !== event.projectId) {
        fail(
          "mutation.supersedesId",
          "must identify an event in the same project",
        );
      }
      const targetWasConsumed = current.projectDecisionEvents.some(
        (candidate) =>
          candidate.action !== "recorded" &&
          candidate.supersedesId === target.id,
      );
      if (target.action === "withdrawn" || targetWasConsumed) {
        fail("mutation.supersedesId", "must identify a current decision head");
      }
      if (Date.parse(event.recordedAt) < Date.parse(target.recordedAt)) {
        fail("mutation", "cannot precede the event it supersedes");
      }
    }
    return [
      ...current.projectDecisionEvents,
      parseProjectDecisionEvent(event, "mutation.event"),
    ];
  };
  const updateProject = (project: WorkspaceProject) =>
    current.projects.map((candidate) =>
      candidate.id === project.id ? project : candidate,
    );
  const findObjective = (project: WorkspaceProject, id: string) => {
    const objective = project.objectives.find(
      (candidate) => candidate.id === id,
    );
    if (!objective) fail("mutation.objectiveId", `unknown objective ${id}`);
    return objective;
  };
  const findWorkItem = (objective: Objective, id: string) => {
    const item = objective.workItems.find((candidate) => candidate.id === id);
    if (!item) fail("mutation.workItemId", `unknown work item ${id}`);
    return item;
  };
  const findAttemptAt = (location: TaskLinkLocation) => {
    const project = findProject(location.projectId);
    const objective = findObjective(project, location.objectiveId);
    const workItem = findWorkItem(objective, location.workItemId);
    const attempt = workItem.attempts.find(
      (candidate) => candidate.id === location.attemptId,
    );
    if (!attempt) {
      fail("mutation", `unknown attempt ${location.attemptId}`);
    }
    return { project, objective, workItem, attempt };
  };
  const assertReviewAssessmentTargetExists = (
    target: ReviewAssessmentTarget,
    path: string,
  ) => {
    const project = findProject(target.projectId);
    const objective = findObjective(project, target.objectiveId);
    const workItem = findWorkItem(objective, target.workItemId);
    if (!isResultReviewAssessmentTarget(target)) return;
    const attempt = workItem.attempts.find(
      (candidate) => candidate.id === target.attemptId,
    );
    if (!attempt) {
      fail(path, `unknown attempt ${target.attemptId}`);
    }
    if (
      !attempt.resultCycles.some((result) =>
        sameResultKey(result.key, target.resultKey),
      )
    ) {
      fail(path, `unknown result ${resultKeyIdentity(target.resultKey)}`);
    }
  };
  const findDecisionRequest = (id: string) => {
    const request = current.decisionRequests.find(
      (candidate) => candidate.id === id,
    );
    if (!request) fail("mutation.id", `unknown decision request ${id}`);
    return request;
  };
  const assertNoActiveVerification = (location: TaskLinkLocation) => {
    if (
      current.verificationReceipts.some(
        (receipt) =>
          (receipt.state === "queued" || receipt.state === "running") &&
          receipt.target.projectId === location.projectId &&
          receipt.target.objectiveId === location.objectiveId &&
          receipt.target.workItemId === location.workItemId &&
          receipt.target.attemptId === location.attemptId,
      )
    ) {
      fail(
        "mutation.from",
        "an active verification must finish or be cancelled first",
      );
    }
  };
  const assertWorkItemSequenceUnchanged = (
    existing: Objective,
    candidate: Objective,
    path: string,
  ) => {
    const existingIds = existing.workItems.map((workItem) => workItem.id);
    const candidateIds = candidate.workItems.map((workItem) => workItem.id);
    if (
      existingIds.length !== candidateIds.length ||
      existingIds.some((id, index) => candidateIds[index] !== id)
    ) {
      fail(
        path,
        "an existing objective's work-item sequence can change only through dedicated work-item mutations",
      );
    }
  };
  const preserveWorkItemContext = (
    existing: WorkItem | undefined,
    candidate: WorkItem,
  ): WorkItem => {
    if (!existing) return candidate;
    const preserved = { ...candidate };
    if (existing.definitionOfDone) {
      preserved.definitionOfDone = existing.definitionOfDone;
    } else {
      delete preserved.definitionOfDone;
    }
    if (existing.relationships) {
      preserved.relationships = existing.relationships;
    } else {
      delete preserved.relationships;
    }
    return preserved;
  };
  const preserveObjectiveDefinitions = (
    existing: Objective | undefined,
    candidate: Objective,
  ): Objective =>
    existing
      ? {
          ...candidate,
          workItems: candidate.workItems.map((workItem) =>
            preserveWorkItemContext(
              existing.workItems.find((item) => item.id === workItem.id),
              workItem,
            ),
          ),
        }
      : candidate;

  let next: CofficeWorkspace;
  switch (mutation.type) {
    case "project.upsert": {
      const candidate = parseProject(mutation.project, "mutation.project");
      const existing = current.projects.find(
        (project) => project.id === candidate.id,
      );
      const project: WorkspaceProject = existing
        ? {
            ...candidate,
            ...(existing.rules ? { rules: existing.rules } : {}),
            ...(existing.qualityBars
              ? { qualityBars: existing.qualityBars }
              : {}),
            ...(existing.contextReview
              ? { contextReview: existing.contextReview }
              : {}),
            ...(existing.reviewSchedule
              ? { reviewSchedule: existing.reviewSchedule }
              : {}),
            objectives: candidate.objectives.map((objective) =>
              preserveObjectiveDefinitions(
                existing.objectives.find((item) => item.id === objective.id),
                objective,
              ),
            ),
          }
        : candidate;
      if (existing && !existing.rules) delete project.rules;
      if (existing && !existing.qualityBars) delete project.qualityBars;
      if (existing && !existing.contextReview) delete project.contextReview;
      if (existing && !existing.reviewSchedule) delete project.reviewSchedule;
      next = {
        ...current,
        projects: replaceById(current.projects, project),
      };
      break;
    }
    case "project.rules.set": {
      const project = findProject(mutation.projectId);
      const updatedProject: WorkspaceProject = {
        ...project,
        updatedAt: at,
        ...(mutation.rules.length ? { rules: mutation.rules } : {}),
      };
      if (mutation.rules.length === 0) delete updatedProject.rules;
      next = {
        ...current,
        projects: updateProject(updatedProject),
      };
      break;
    }
    case "project.qualityBars.set": {
      const project = findProject(mutation.projectId);
      const updatedProject: WorkspaceProject = {
        ...project,
        updatedAt: at,
        ...(mutation.qualityBars.length
          ? { qualityBars: mutation.qualityBars }
          : {}),
      };
      if (mutation.qualityBars.length === 0) {
        delete updatedProject.qualityBars;
      }
      next = {
        ...current,
        projects: updateProject(updatedProject),
      };
      break;
    }
    case "project.contextReview.set": {
      const project = findProject(mutation.projectId);
      next = {
        ...current,
        projects: updateProject({
          ...project,
          updatedAt: at,
          contextReview: {
            concerns: mutation.concerns,
            ...(mutation.note ? { note: mutation.note } : {}),
            markedAt: at,
            authorship: "user",
          },
        }),
      };
      break;
    }
    case "project.contextReview.clear": {
      const project = findProject(mutation.projectId);
      const updatedProject = { ...project, updatedAt: at };
      delete updatedProject.contextReview;
      next = {
        ...current,
        projects: updateProject(updatedProject),
      };
      break;
    }
    case "project.reviewSchedule.set": {
      const project = findProject(mutation.projectId);
      next = {
        ...current,
        projects: updateProject({
          ...project,
          updatedAt: at,
          reviewSchedule: {
            nextReviewAt: mutation.nextReviewAt,
            ...(mutation.repeatEveryDays
              ? { repeatEveryDays: mutation.repeatEveryDays }
              : {}),
            configuredAt: at,
            ...(project.reviewSchedule?.lastReviewedAt
              ? { lastReviewedAt: project.reviewSchedule.lastReviewedAt }
              : {}),
            authorship: "user",
          },
        }),
      };
      break;
    }
    case "project.reviewSchedule.complete": {
      const project = findProject(mutation.projectId);
      if (!project.reviewSchedule) {
        fail("mutation.projectId", "project has no review schedule");
      }
      const updatedProject: WorkspaceProject = {
        ...project,
        updatedAt: at,
      };
      if (project.reviewSchedule.repeatEveryDays) {
        updatedProject.reviewSchedule = {
          ...project.reviewSchedule,
          nextReviewAt: new Date(
            Date.parse(at) +
              project.reviewSchedule.repeatEveryDays * 24 * 60 * 60 * 1_000,
          ).toISOString(),
          lastReviewedAt: at,
        };
      } else {
        delete updatedProject.reviewSchedule;
      }
      next = {
        ...current,
        projects: updateProject(updatedProject),
      };
      break;
    }
    case "project.reviewSchedule.clear": {
      const project = findProject(mutation.projectId);
      const updatedProject = { ...project, updatedAt: at };
      delete updatedProject.reviewSchedule;
      next = {
        ...current,
        projects: updateProject(updatedProject),
      };
      break;
    }
    case "project.remove":
      findProject(mutation.projectId);
      next = {
        ...current,
        projects: current.projects.filter(
          (project) => project.id !== mutation.projectId,
        ),
        projectDecisionEvents: current.projectDecisionEvents.filter(
          (event) => event.projectId !== mutation.projectId,
        ),
      };
      break;
    case "projectDecision.record":
      next = {
        ...current,
        projectDecisionEvents: appendProjectDecisionEvent({
          id: mutation.id,
          projectId: mutation.projectId,
          action: "recorded",
          statement: mutation.statement,
          ...(mutation.context ? { context: mutation.context } : {}),
          recordedAt: at,
          authorship: "user",
        }),
      };
      break;
    case "projectDecision.supersede":
      next = {
        ...current,
        projectDecisionEvents: appendProjectDecisionEvent({
          id: mutation.id,
          projectId: mutation.projectId,
          action: "superseded",
          supersedesId: mutation.supersedesId,
          supersessionKind: mutation.supersessionKind,
          statement: mutation.statement,
          ...(mutation.context ? { context: mutation.context } : {}),
          recordedAt: at,
          authorship: "user",
        }),
      };
      break;
    case "projectDecision.withdraw":
      next = {
        ...current,
        projectDecisionEvents: appendProjectDecisionEvent({
          id: mutation.id,
          projectId: mutation.projectId,
          action: "withdrawn",
          supersedesId: mutation.supersedesId,
          ...(mutation.reason ? { reason: mutation.reason } : {}),
          recordedAt: at,
          authorship: "user",
        }),
      };
      break;
    case "objective.upsert": {
      const project = findProject(mutation.projectId);
      const objective = parseObjective(
        mutation.objective,
        "mutation.objective",
      );
      const existingObjective = project.objectives.find(
        (item) => item.id === objective.id,
      );
      const preservedObjective = preserveObjectiveDefinitions(
        existingObjective,
        objective,
      );
      next = {
        ...current,
        projects: updateProject({
          ...project,
          updatedAt: at,
          objectives: replaceById(project.objectives, preservedObjective),
        }),
      };
      break;
    }
    case "objective.remove": {
      const project = findProject(mutation.projectId);
      findObjective(project, mutation.objectiveId);
      next = {
        ...current,
        projects: updateProject({
          ...project,
          updatedAt: at,
          objectives: project.objectives.filter(
            (objective) => objective.id !== mutation.objectiveId,
          ),
        }),
      };
      break;
    }
    case "workItem.upsert":
    case "workItem.remove": {
      const project = findProject(mutation.projectId);
      const objective = findObjective(project, mutation.objectiveId);
      if (mutation.type === "workItem.remove") {
        findWorkItem(objective, mutation.workItemId);
      }
      const workItems =
        mutation.type === "workItem.upsert"
          ? replaceById(
              objective.workItems,
              preserveWorkItemContext(
                objective.workItems.find(
                  (item) => item.id === mutation.workItem.id,
                ),
                parseWorkItem(mutation.workItem, "mutation.workItem"),
              ),
            )
          : objective.workItems.filter(
              (item) => item.id !== mutation.workItemId,
            );
      const updatedObjective = { ...objective, updatedAt: at, workItems };
      next = {
        ...current,
        projects: updateProject({
          ...project,
          updatedAt: at,
          objectives: replaceById(project.objectives, updatedObjective),
        }),
      };
      break;
    }
    case "workItem.definitionOfDone.set": {
      const project = findProject(mutation.projectId);
      const objective = findObjective(project, mutation.objectiveId);
      const item = findWorkItem(objective, mutation.workItemId);
      const updatedItem: WorkItem = {
        ...item,
        updatedAt: at,
        ...(mutation.definitionOfDone.length
          ? { definitionOfDone: mutation.definitionOfDone }
          : {}),
      };
      if (mutation.definitionOfDone.length === 0) {
        delete updatedItem.definitionOfDone;
      }
      const updatedObjective = {
        ...objective,
        updatedAt: at,
        workItems: replaceById(objective.workItems, updatedItem),
      };
      next = {
        ...current,
        projects: updateProject({
          ...project,
          updatedAt: at,
          objectives: replaceById(project.objectives, updatedObjective),
        }),
      };
      break;
    }
    case "workItem.relationships.set": {
      const project = findProject(mutation.projectId);
      const objective = findObjective(project, mutation.objectiveId);
      const item = findWorkItem(objective, mutation.workItemId);
      const updatedItem: WorkItem = {
        ...item,
        updatedAt: at,
        ...(mutation.relationships.length
          ? { relationships: mutation.relationships }
          : {}),
      };
      if (mutation.relationships.length === 0) {
        delete updatedItem.relationships;
      }
      const updatedObjective = {
        ...objective,
        updatedAt: at,
        workItems: replaceById(objective.workItems, updatedItem),
      };
      next = {
        ...current,
        projects: updateProject({
          ...project,
          updatedAt: at,
          objectives: replaceById(project.objectives, updatedObjective),
        }),
      };
      break;
    }
    case "workItem.reorder": {
      const project = findProject(mutation.projectId);
      const objective = findObjective(project, mutation.objectiveId);
      const workItemsById = new Map(
        objective.workItems.map((workItem) => [workItem.id, workItem]),
      );
      if (
        mutation.orderedWorkItemIds.length !== objective.workItems.length ||
        mutation.orderedWorkItemIds.some((id) => !workItemsById.has(id))
      ) {
        fail(
          "mutation.orderedWorkItemIds",
          "expected every work item in this objective exactly once",
        );
      }
      const updatedObjective = {
        ...objective,
        updatedAt: at,
        workItems: mutation.orderedWorkItemIds.map((id) =>
          workItemsById.get(id)!,
        ),
      };
      next = {
        ...current,
        projects: updateProject({
          ...project,
          updatedAt: at,
          objectives: replaceById(project.objectives, updatedObjective),
        }),
      };
      break;
    }
    case "attempt.upsert":
    case "result.upsert":
    case "result.review":
    case "result.decide": {
      const project = findProject(mutation.projectId);
      const objective = findObjective(project, mutation.objectiveId);
      const item = findWorkItem(objective, mutation.workItemId);
      let attempts: CodexTaskAttempt[];
      let addedResultCycle = false;
      if (mutation.type === "attempt.upsert") {
        attempts = replaceById(
          item.attempts,
          parseAttempt(mutation.attempt, "mutation.attempt"),
        );
      } else {
        const attempt = item.attempts.find(
          (candidate) => candidate.id === mutation.attemptId,
        );
        if (!attempt)
          fail("mutation.attemptId", `unknown attempt ${mutation.attemptId}`);
        if (mutation.type === "result.upsert") {
          if (attempt.unlinkedAt) {
            fail(
              "mutation.attemptId",
              "a closed task link cannot receive results",
            );
          }
          if (
            attempt.observeResultsAfterKey &&
            sameResultKey(mutation.result.key, attempt.observeResultsAfterKey)
          ) {
            fail(
              "mutation.result.key",
              "a continued task link cannot repeat its baseline result",
            );
          }
          const existing = attempt.resultCycles.find((candidate) =>
            sameResultKey(candidate.key, mutation.result.key),
          );
          if (
            !existing &&
            locatedAttempts(current).some(
              (entry) =>
                entry.attempt.codexTaskId === attempt.codexTaskId &&
                entry.attempt.resultCycles.some((result) =>
                  sameResultKey(result.key, mutation.result.key),
                ),
            )
          ) {
            fail(
              "mutation.result.key",
              "a Codex task result key can be recorded only once across links",
            );
          }
          if (existing && existing.observedAt !== mutation.result.observedAt) {
            fail(
              "mutation.result",
              "an existing result key cannot be assigned a different observation",
            );
          }
          addedResultCycle = !existing;
          attempts = replaceById(item.attempts, {
            ...attempt,
            resultCycles: existing
              ? attempt.resultCycles
              : [...attempt.resultCycles, mutation.result],
          });
        } else {
          const result = attempt.resultCycles.find((candidate) =>
            sameResultKey(candidate.key, mutation.resultKey),
          );
          if (!result) {
            fail(
              "mutation.resultKey",
              `unknown result ${resultKeyIdentity(mutation.resultKey)}`,
            );
          }
          let updatedResult: CodexResultCycle;
          if (mutation.type === "result.review") {
            if (result.review?.decision) {
              fail(
                "mutation.resultKey",
                "a decided result cannot be reviewed again",
              );
            }
            if (
              Date.parse(mutation.reviewedAt) < Date.parse(result.observedAt)
            ) {
              fail(
                "mutation.reviewedAt",
                "review cannot precede result observation",
              );
            }
            updatedResult = {
              ...result,
              review: { reviewedAt: mutation.reviewedAt },
            };
          } else {
            if (item.status === "accepted") {
              fail(
                "mutation.workItemId",
                "an accepted work item requires a new result before another decision",
              );
            }
            if (!result.review) {
              fail(
                "mutation.resultKey",
                "result must be reviewed before a decision",
              );
            }
            if (result.review.decision) {
              fail("mutation.resultKey", "result already has a decision");
            }
            if (
              Date.parse(mutation.decision.decidedAt) <
              Date.parse(result.review.reviewedAt)
            ) {
              fail("mutation.decision", "decision cannot precede review");
            }
            const evidence = mutation.evidence;
            if (
              evidence.kind !== "decision" ||
              evidence.outcome !== "neutral" ||
              evidence.decisionKind !== mutation.decision.kind ||
              evidence.projectId !== mutation.projectId ||
              evidence.objectiveId !== mutation.objectiveId ||
              evidence.workItemId !== mutation.workItemId ||
              evidence.attemptId !== mutation.attemptId ||
              !evidence.resultKey ||
              !sameResultKey(evidence.resultKey, mutation.resultKey)
            ) {
              fail(
                "mutation.evidence",
                "decision evidence must identify the exact result and use decision/neutral semantics",
              );
            }
            if (
              Date.parse(evidence.recordedAt) <
              Date.parse(mutation.decision.decidedAt)
            ) {
              fail(
                "mutation.evidence.recordedAt",
                "decision evidence cannot precede the decision",
              );
            }
            if (
              current.evidence.some((candidate) => candidate.id === evidence.id)
            ) {
              fail("mutation.evidence.id", `duplicate id ${evidence.id}`);
            }
            updatedResult = {
              ...result,
              review: {
                ...result.review,
                decision: mutation.decision,
              },
            };
          }
          attempts = replaceById(item.attempts, {
            ...attempt,
            resultCycles: attempt.resultCycles.map((candidate) =>
              sameResultKey(candidate.key, mutation.resultKey)
                ? updatedResult
                : candidate,
            ),
          });
        }
      }
      const status =
        mutation.type === "result.decide"
          ? mutation.decision.kind === "accepted"
            ? "accepted"
            : "in_progress"
          : mutation.type === "result.upsert" && addedResultCycle
            ? "ready_for_review"
            : item.status;
      const updatedItem: WorkItem = {
        ...item,
        status,
        updatedAt: at,
        attempts,
      };
      const updatedObjective = {
        ...objective,
        updatedAt: at,
        workItems: replaceById(objective.workItems, updatedItem),
      };
      next = {
        ...current,
        ...(mutation.type === "result.decide"
          ? { evidence: [...current.evidence, mutation.evidence] }
          : {}),
        projects: updateProject({
          ...project,
          updatedAt: at,
          objectives: replaceById(project.objectives, updatedObjective),
        }),
      };
      break;
    }
    case "taskLink.move": {
      const source = findAttemptAt(mutation.from);
      if (source.attempt.codexTaskId !== mutation.codexTaskId) {
        fail("mutation.codexTaskId", "source link belongs to another task");
      }
      assertNoActiveVerification(mutation.from);
      const segments = locatedAttempts(current)
        .filter((entry) => entry.attempt.codexTaskId === mutation.codexTaskId)
        .sort(
          (left, right) =>
            Date.parse(left.attempt.linkedAt) -
              Date.parse(right.attempt.linkedAt) ||
            left.attempt.id.localeCompare(right.attempt.id),
        );
      const open = segments.filter((entry) => !entry.attempt.unlinkedAt);
      if (source.attempt.unlinkedAt) {
        const latest = segments
          .filter((entry) => entry.attempt.unlinkedAt)
          .sort(
            (left, right) =>
              Date.parse(left.attempt.unlinkedAt!) -
                Date.parse(right.attempt.unlinkedAt!) ||
              Date.parse(left.attempt.linkedAt) -
                Date.parse(right.attempt.linkedAt) ||
              left.attempt.id.localeCompare(right.attempt.id),
          )
          .at(-1);
        if (
          open.length > 0 ||
          !latest ||
          taskLinkLocationIdentity(latest) !==
            taskLinkLocationIdentity(mutation.from)
        ) {
          fail(
            "mutation.from",
            "only the latest closed link can resume when no link is open",
          );
        }
        if (
          Date.parse(mutation.movedAt) < Date.parse(source.attempt.unlinkedAt)
        ) {
          fail("mutation.movedAt", "move cannot precede the closed source");
        }
      } else {
        if (
          open.length !== 1 ||
          taskLinkLocationIdentity(open[0]) !==
            taskLinkLocationIdentity(mutation.from)
        ) {
          fail("mutation.from", "source is not the active task link");
        }
        if (
          Date.parse(mutation.movedAt) < Date.parse(source.attempt.linkedAt)
        ) {
          fail("mutation.movedAt", "move cannot precede the source link");
        }
      }
      const destinationProject = findProject(mutation.to.projectId);
      const destinationObjective = findObjective(
        destinationProject,
        mutation.to.objectiveId,
      );
      const destinationWorkItem = findWorkItem(
        destinationObjective,
        mutation.to.workItemId,
      );
      if (
        destinationWorkItem.status !== "planned" &&
        destinationWorkItem.status !== "in_progress" &&
        destinationWorkItem.status !== "blocked"
      ) {
        fail("mutation.to.workItemId", "destination work item is not open");
      }
      if (
        locatedAttempts(current).some(
          (entry) => entry.attempt.id === mutation.to.attemptId,
        )
      ) {
        fail("mutation.to.attemptId", "destination attempt id is already used");
      }
      let projects = current.projects;
      if (!source.attempt.unlinkedAt) {
        projects = replaceAttemptAt(
          projects,
          mutation.from,
          { ...source.attempt, unlinkedAt: mutation.movedAt },
          mutation.movedAt,
        );
      }
      projects = appendAttemptAt(
        projects,
        mutation.to,
        {
          id: mutation.to.attemptId,
          codexTaskId: mutation.codexTaskId,
          relationship: "continuation",
          linkedAt: mutation.movedAt,
          ...(mutation.baselineResultKey
            ? { observeResultsAfterKey: mutation.baselineResultKey }
            : {}),
          resultCycles: [],
        },
        mutation.movedAt,
      );
      next = { ...current, projects };
      break;
    }
    case "taskLink.unlink": {
      const source = findAttemptAt(mutation.from);
      if (source.attempt.codexTaskId !== mutation.codexTaskId) {
        fail("mutation.codexTaskId", "source link belongs to another task");
      }
      if (source.attempt.unlinkedAt) {
        fail("mutation.from", "source link is already closed");
      }
      const open = locatedAttempts(current).filter(
        (entry) =>
          entry.attempt.codexTaskId === mutation.codexTaskId &&
          !entry.attempt.unlinkedAt,
      );
      if (
        open.length !== 1 ||
        taskLinkLocationIdentity(open[0]) !==
          taskLinkLocationIdentity(mutation.from)
      ) {
        fail("mutation.from", "source is not the active task link");
      }
      assertNoActiveVerification(mutation.from);
      if (
        Date.parse(mutation.unlinkedAt) < Date.parse(source.attempt.linkedAt)
      ) {
        fail("mutation.unlinkedAt", "unlink cannot precede the source link");
      }
      next = {
        ...current,
        projects: replaceAttemptAt(
          current.projects,
          mutation.from,
          { ...source.attempt, unlinkedAt: mutation.unlinkedAt },
          mutation.unlinkedAt,
        ),
      };
      break;
    }
    case "evidence.append":
      if (mutation.record.kind === "decision") {
        fail(
          "mutation.record",
          "decision evidence must be written atomically with result.decide",
        );
      }
      next = {
        ...current,
        evidence: [
          ...current.evidence,
          parseEvidence(mutation.record, "mutation.record"),
        ],
      };
      break;
    case "attention.update":
    case "attention.replace":
      next = {
        ...current,
        attentionReview: repairInvalidAttentionBaseline(
          parseAttention(mutation.state, "mutation.state"),
          at,
        ),
      };
      break;
    case "attention.event": {
      const repaired = repairInvalidAttentionBaseline(
        current.attentionReview,
        at,
      );
      const dispositions = { ...repaired.dispositions };
      const snoozedUntil = { ...repaired.snoozedUntil };
      if (mutation.disposition) {
        dispositions[mutation.eventKey] = mutation.disposition;
      } else {
        delete dispositions[mutation.eventKey];
      }
      if (mutation.snoozedUntil) {
        snoozedUntil[mutation.eventKey] = mutation.snoozedUntil;
      } else {
        delete snoozedUntil[mutation.eventKey];
      }
      next = {
        ...current,
        attentionReview: compactAttentionReviewState(
          {
            ...repaired,
            dispositions,
            snoozedUntil,
          },
          new Set(),
          new Set([mutation.eventKey]),
        ),
      };
      break;
    }
    case "attention.import":
      if (current.migrations.attentionReviewV2ImportedAt) {
        fail("mutation", "attention review state has already been imported");
      }
      next = {
        ...current,
        attentionReview: repairInvalidAttentionBaseline(
          parseAttention(mutation.state, "mutation.state"),
          mutation.importedAt,
        ),
        migrations: { attentionReviewV2ImportedAt: mutation.importedAt },
      };
      break;
    case "assessment.set": {
      assertReviewAssessmentTargetExists(
        mutation.assessment.target,
        "mutation.assessment.target",
      );
      const assessment = parseReviewAssessment(
        {
          ...mutation.assessment,
          authorship: "user",
          updatedAt: at,
        },
        "mutation.assessment",
      );
      const existing = selectReviewAssessment(
        current.reviewAssessments,
        assessment.target,
      );
      next = {
        ...current,
        reviewAssessments: existing
          ? current.reviewAssessments.map((candidate) =>
              sameReviewAssessmentTarget(candidate.target, assessment.target)
                ? assessment
                : candidate,
            )
          : [...current.reviewAssessments, assessment],
      };
      break;
    }
    case "assessment.clear":
      assertReviewAssessmentTargetExists(mutation.target, "mutation.target");
      next = {
        ...current,
        reviewAssessments: current.reviewAssessments.filter(
          (assessment) =>
            !sameReviewAssessmentTarget(assessment.target, mutation.target),
        ),
      };
      break;
    case "decisionRequest.create": {
      if (current.decisionRequests.length >= LIMITS.decisionRequests) {
        fail(
          "mutation",
          `decision requests are limited to ${LIMITS.decisionRequests} entries`,
        );
      }
      if (
        current.decisionRequests.some(
          (candidate) => candidate.id === mutation.request.id,
        )
      ) {
        fail(
          "mutation.request.id",
          `duplicate decision request id ${mutation.request.id}`,
        );
      }
      assertReviewAssessmentTargetExists(
        mutation.request.target,
        "mutation.request.target",
      );
      const request = parseDecisionRequest(
        {
          ...mutation.request,
          authorship: "user",
          createdAt: at,
          updatedAt: at,
        },
        "mutation.request",
      );
      next = {
        ...current,
        decisionRequests: [...current.decisionRequests, request],
      };
      break;
    }
    case "decisionRequest.update": {
      const request = findDecisionRequest(mutation.id);
      if (request.resolvedAt) {
        fail("mutation.id", "a resolved decision request cannot be rewritten");
      }
      next = {
        ...current,
        decisionRequests: current.decisionRequests.map((candidate) =>
          candidate.id === request.id
            ? { ...candidate, prompt: mutation.prompt, updatedAt: at }
            : candidate,
        ),
      };
      break;
    }
    case "decisionRequest.resolve": {
      const request = findDecisionRequest(mutation.id);
      if (request.resolvedAt) {
        fail("mutation.id", "decision request is already resolved");
      }
      next = {
        ...current,
        decisionRequests: current.decisionRequests.map((candidate) =>
          candidate.id === request.id
            ? {
                ...candidate,
                updatedAt: at,
                resolvedAt: at,
                ...(mutation.resolution
                  ? { resolution: mutation.resolution }
                  : {}),
              }
            : candidate,
        ),
      };
      break;
    }
    case "decisionRequest.reopen": {
      const request = findDecisionRequest(mutation.id);
      if (!request.resolvedAt) {
        fail("mutation.id", "decision request is already open");
      }
      next = {
        ...current,
        decisionRequests: current.decisionRequests.map((candidate) => {
          if (candidate.id !== request.id) return candidate;
          const reopened: DecisionRequest = {
            ...candidate,
            updatedAt: at,
          };
          delete reopened.resolvedAt;
          delete reopened.resolution;
          return reopened;
        }),
      };
      break;
    }
    case "decisionRequest.remove": {
      const request = findDecisionRequest(mutation.id);
      if (request.resolvedAt) {
        fail(
          "mutation.id",
          "resolved decision history cannot be removed; reopen it first",
        );
      }
      next = {
        ...current,
        decisionRequests: current.decisionRequests.filter(
          (candidate) => candidate.id !== request.id,
        ),
      };
      break;
    }
  }
  if (
    mutation.type === "project.upsert" ||
    mutation.type === "project.remove" ||
    mutation.type === "objective.upsert" ||
    mutation.type === "objective.remove" ||
    mutation.type === "workItem.upsert" ||
    mutation.type === "workItem.remove" ||
    mutation.type === "attempt.upsert"
  ) {
    if (
      current.reviewAssessments.some(
        (assessment) =>
          !reviewAssessmentTargetExists(next.projects, assessment.target),
      )
    ) {
      fail(
        "mutation",
        "clear a review assessment before removing or replacing its target",
      );
    }
    if (
      current.decisionRequests.some(
        (request) =>
          !reviewAssessmentTargetExists(next.projects, request.target),
      )
    ) {
      fail(
        "mutation",
        "remove decision requests before removing or replacing their target",
      );
    }
  }
  if (mutation.type === "project.upsert") {
    const existingProject = current.projects.find(
      (project) => project.id === mutation.project.id,
    );
    const updatedProject = next.projects.find(
      (project) => project.id === mutation.project.id,
    );
    if (existingProject && updatedProject) {
      updatedProject.objectives.forEach((objective, index) => {
        const existingObjective = existingProject.objectives.find(
          (candidate) => candidate.id === objective.id,
        );
        if (existingObjective) {
          assertWorkItemSequenceUnchanged(
            existingObjective,
            objective,
            `mutation.project.objectives[${index}].workItems`,
          );
        }
      });
    }
  }
  if (mutation.type === "objective.upsert") {
    const existingProject = current.projects.find(
      (project) => project.id === mutation.projectId,
    );
    const updatedProject = next.projects.find(
      (project) => project.id === mutation.projectId,
    );
    const existingObjective = existingProject?.objectives.find(
      (objective) => objective.id === mutation.objective.id,
    );
    const updatedObjective = updatedProject?.objectives.find(
      (objective) => objective.id === mutation.objective.id,
    );
    if (existingObjective && updatedObjective) {
      assertWorkItemSequenceUnchanged(
        existingObjective,
        updatedObjective,
        "mutation.objective.workItems",
      );
    }
  }
  if (
    mutation.type === "project.upsert" ||
    mutation.type === "project.remove" ||
    mutation.type === "objective.upsert" ||
    mutation.type === "objective.remove" ||
    mutation.type === "workItem.upsert" ||
    mutation.type === "workItem.remove" ||
    mutation.type === "attempt.upsert"
  ) {
    rejectGenericAttemptHistoryRewrite(
      current,
      next,
      mutation.type === "attempt.upsert",
    );
  }
  return parseCofficeWorkspace({
    ...next,
    revision: current.revision + 1,
    updatedAt: at,
  });
}
