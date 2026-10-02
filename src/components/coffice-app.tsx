"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type {
  EvidenceProvenance,
  NormalizedStatusValue,
  SourceHealth,
} from "@/lib/coffice";
import {
  MAX_REPOSITORY_ROOTS_PER_REFRESH,
  NORMALIZED_STATUS_VALUES,
} from "../lib/domain";
import {
  attentionEventKey,
  isPersistentCompletion,
  type AttentionDecisionRequest,
  type AttentionPlanLinkNotice,
  type AttentionVerificationReceipt,
} from "../lib/attention-inbox";
import {
  selectAttentionProjectProjection,
  type AttentionDigestCounts,
  type AttentionProjectProjection,
} from "../lib/attention-digest";
import { selectReviewedResultAttentionEventKeys } from "../lib/result-attention";
import { selectNextCodexOperationEvidence } from "../lib/codex-operation-evidence";
import type {
  CofficeWorkspace,
  VerificationTarget,
  WorkspaceMutation,
} from "../lib/coffice-workspace";
import {
  CAMPUS_PREFERENCES_STORAGE_KEY,
  compareCampusProjectsByAttention,
  DEFAULT_CAMPUS_PREFERENCES,
  parseCampusPreferences,
  serializeCampusPreferences,
  type CampusPreferences,
} from "../lib/campus-preferences";
import {
  sessionLivenessAriaLabel,
  sessionLivenessChipText,
  summarizeProjectSignals,
  type SessionLiveness,
} from "../lib/session-liveness";
import {
  EMPTY_PROJECT_TASK_COUNTS,
  formatVisibleProjectName,
  selectProjectCountsById,
  type ProjectTaskCounts,
} from "../lib/project-task-presentation";
import { PixelOffice } from "./pixel-office";
import { ActionableDigest, type DigestSourceState } from "./actionable-digest";
import { AttentionTransitionController } from "./attention-transition-controller";
import {
  useDesktopAlertSettings,
  type DesktopAlertSettingsController,
} from "./use-desktop-alert-settings";
import {
  selectActiveObjective,
  selectTaskWorkContext,
  selectWorkspaceProject,
} from "./work-planner";
import { selectOpenTaskWorkContext } from "./task-work-context";
import {
  useAttentionReviewState,
  type AttentionReviewController,
} from "./use-attention-review-state";
import {
  useCodexActions,
  type CodexActionsController,
} from "./use-codex-actions";
import {
  useCofficeWorkspace,
  type CofficeWorkspaceController,
} from "./use-coffice-workspace";
import {
  useVerifications,
  type VerificationsController,
} from "./use-verifications";

type StatusName = NormalizedStatusValue;
type EvidenceKind = EvidenceProvenance;

interface UiStatus {
  value: StatusName;
  evidence: EvidenceKind;
  source: string;
  timestamp: string | null;
  confidence?: number;
  stale?: boolean;
}

interface UiTokenUsage {
  contextTokens: number;
  contextWindow: number;
  cumulativeTokens?: number;
  source: string;
  timestamp: string;
  stale: boolean;
}

interface UiTask {
  id: string;
  projectId?: string;
  title: string;
  kind: "staff" | "temporary";
  assignmentEvidence:
    | "explicit_project"
    | "explicit_unassigned"
    | "explicit_unknown_project"
    | "cwd_fallback";
  assignmentSourceFresh?: boolean;
  agentName?: string;
  model?: string;
  modelStale?: boolean;
  startedAt?: string;
  updatedAt?: string;
  lastActivityAt?: string;
  status: UiStatus;
  tokenUsage?: UiTokenUsage;
}

type UiRepositoryAreaName =
  "Source" | "Tests" | "Docs" | "Config" | "Assets" | "Other";

interface UiRepositoryArea {
  area: UiRepositoryAreaName;
  files: number;
}

interface UiRepositoryDiffStats {
  trackedFiles: number;
  additions: number;
  deletions: number;
  binaryFiles: number;
  source: "git:diff-numstat";
}

interface UiUnavailableRepository {
  availability: "unavailable";
  source: "git";
  observedAt: string;
}

interface UiAvailableRepository {
  availability: "available";
  branch: string;
  headOid: string | null;
  headState: "commit" | "unborn";
  changedFiles: number;
  stagedFiles: number;
  untrackedFiles: number;
  conflictedFiles: number;
  ahead: number;
  behind: number;
  clean: boolean;
  source: "git:status-porcelain-v2";
  observedAt: string;
  changeAreas: {
    totalFiles: number;
    summarizedFiles: number;
    omittedFiles: number;
    areas: readonly UiRepositoryArea[];
  };
  diffStats?: UiRepositoryDiffStats;
}

type UiRepository = UiUnavailableRepository | UiAvailableRepository;

type UiRepositoryEvidenceState =
  "fresh" | "refreshing" | "stale" | "unavailable";

interface UiRepositoryRoot {
  role: "primary" | "additional";
  evidence?: UiRepository;
  evidenceState: UiRepositoryEvidenceState;
}

interface UiProject {
  id: string;
  name: string;
  order: number;
  path?: string;
  tasks: UiTask[];
  repositoryRootCount?: number;
  repositoryCollectionState?: "bounded_out";
  repository?: UiRepository;
  repositoryRoots?: UiRepositoryRoot[];
  repositoryEvidenceState?: UiRepositoryEvidenceState;
  holding?: boolean;
}

interface PendingResultObservation {
  guardKey: string;
  mutation: Extract<WorkspaceMutation, { type: "result.upsert" }>;
}

function verificationAttentionOutcomeKey(
  receipt: CofficeWorkspace["verificationReceipts"][number],
): string {
  const { target, profile } = receipt;
  return JSON.stringify([
    target.projectId,
    target.objectiveId,
    target.workItemId,
    target.attemptId,
    target.resultKey.kind,
    target.resultKey.id,
    profile.id,
    profile.version,
  ]);
}

export function selectVerificationAttentionReceipts(
  workspace: CofficeWorkspace | null,
  project: Pick<UiProject, "id" | "tasks">,
): AttentionVerificationReceipt[] {
  const workspaceProject = workspace?.projects.find(
    (candidate) => candidate.id === project.id,
  );
  if (!workspace || !workspaceProject) return [];
  const receipts: AttentionVerificationReceipt[] = [];
  const latestDecisive = new Map<
    string,
    {
      receipt: CofficeWorkspace["verificationReceipts"][number];
      index: number;
    }
  >();
  workspace.verificationReceipts.forEach((receipt, index) => {
    if (
      (receipt.state !== "passed" && receipt.state !== "failed") ||
      !receipt.completedAt
    ) {
      return;
    }
    const key = verificationAttentionOutcomeKey(receipt);
    const current = latestDecisive.get(key);
    const completedAt = Date.parse(receipt.completedAt);
    const currentCompletedAt = current
      ? Date.parse(current.receipt.completedAt!)
      : Number.NEGATIVE_INFINITY;
    if (
      !current ||
      completedAt > currentCompletedAt ||
      (completedAt === currentCompletedAt && index > current.index)
    ) {
      latestDecisive.set(key, { receipt, index });
    }
  });
  for (const { receipt } of latestDecisive.values()) {
    if (
      receipt.state !== "failed" ||
      receipt.target.projectId !== project.id ||
      !receipt.completedAt
    ) {
      continue;
    }
    const objective = workspaceProject.objectives.find(
      (candidate) => candidate.id === receipt.target.objectiveId,
    );
    const workItem = objective?.workItems.find(
      (candidate) => candidate.id === receipt.target.workItemId,
    );
    const attempt = workItem?.attempts.find(
      (candidate) => candidate.id === receipt.target.attemptId,
    );
    const result = attempt?.resultCycles.find(
      (candidate) =>
        candidate.key.kind === receipt.target.resultKey.kind &&
        candidate.key.id === receipt.target.resultKey.id,
    );
    if (!objective || !workItem || !attempt || !result) continue;
    const task = project.tasks.find(
      (candidate) => candidate.id === attempt.codexTaskId,
    );
    receipts.push({
      id: receipt.id,
      state: receipt.state,
      completedAt: receipt.completedAt,
      target: receipt.target,
      workItemTitle: workItem.title,
      resultObservedAt: result.observedAt,
      ...(task ? { taskId: task.id, taskTitle: task.title } : {}),
    });
  }
  return receipts;
}

export function selectDecisionRequestAttentionItems(
  workspace: CofficeWorkspace | null,
  project: Pick<UiProject, "id" | "tasks">,
): AttentionDecisionRequest[] {
  const workspaceProject = workspace?.projects.find(
    (candidate) => candidate.id === project.id,
  );
  if (!workspace || !workspaceProject) return [];
  return workspace.decisionRequests.flatMap((request) => {
    if (request.resolvedAt || request.target.projectId !== project.id)
      return [];
    const target = request.target;
    const objective = workspaceProject.objectives.find(
      (candidate) => candidate.id === target.objectiveId,
    );
    const workItem = objective?.workItems.find(
      (candidate) => candidate.id === target.workItemId,
    );
    if (!workItem) return [];
    const attempt =
      "attemptId" in target
        ? workItem.attempts.find(
            (candidate) => candidate.id === target.attemptId,
          )
        : undefined;
    const task = attempt
      ? project.tasks.find((candidate) => candidate.id === attempt.codexTaskId)
      : undefined;
    return [
      {
        id: request.id,
        createdAt: request.createdAt,
        workItemId: workItem.id,
        workItemTitle: workItem.title,
        ...(task ? { taskId: task.id } : {}),
        ...(attempt && "resultKey" in target
          ? {
              verificationTarget: {
                projectId: target.projectId,
                objectiveId: target.objectiveId,
                workItemId: target.workItemId,
                attemptId: target.attemptId,
                resultKey: target.resultKey,
              },
            }
          : {}),
      },
    ];
  });
}

export function selectPlanLinkAttentionNotices(
  workspace: CofficeWorkspace | null,
  project: Pick<UiProject, "id" | "tasks">,
): AttentionPlanLinkNotice[] {
  if (!workspace) return [];
  const notices: AttentionPlanLinkNotice[] = [];
  for (const task of project.tasks) {
    if (task.assignmentSourceFresh === false) continue;
    const link = selectOpenTaskWorkContext(workspace, task.id);
    if (!link) continue;
    const mismatch =
      task.assignmentEvidence === "explicit_project" &&
      link.project.id !== project.id;
    const orphaned = task.assignmentEvidence === "explicit_unassigned";
    if (!mismatch && !orphaned) continue;
    notices.push({
      kind: mismatch ? "plan_link_mismatch" : "plan_link_orphaned",
      taskId: task.id,
      taskTitle: task.title,
      attemptId: link.attempt.id,
      linkedProjectName: link.project.title,
      occurredAt: null,
    });
  }
  return notices;
}

export function selectNextResultObservation(
  workspace: CofficeWorkspace,
  projects: readonly UiProject[],
  pending: ReadonlySet<string>,
  fallbackObservedAt: string,
): PendingResultObservation | null {
  const visibleTasks = new Map<string, UiTask | null>();
  for (const project of projects) {
    for (const task of project.tasks) {
      visibleTasks.set(task.id, visibleTasks.has(task.id) ? null : task);
    }
  }
  const recordedResultKeys = new Set<string>();
  for (const project of workspace.projects) {
    for (const objective of project.objectives) {
      for (const workItem of objective.workItems) {
        for (const attempt of workItem.attempts) {
          for (const result of attempt.resultCycles) {
            recordedResultKeys.add(
              `${attempt.codexTaskId}:${result.key.kind}:${result.key.id}`,
            );
          }
        }
      }
    }
  }
  for (const managedProject of workspace.projects) {
    for (const objective of managedProject.objectives) {
      for (const workItem of objective.workItems) {
        for (const attempt of workItem.attempts) {
          if (attempt.unlinkedAt) continue;
          const task = visibleTasks.get(attempt.codexTaskId);
          const persistentCompletion = task
            ? isPersistentCompletion(task)
            : false;
          if (
            !task ||
            (task.status.value !== "completed" && !persistentCompletion) ||
            (task.status.stale && !persistentCompletion)
          ) {
            continue;
          }
          const resultKey = {
            kind: "revision" as const,
            id: attentionEventKey(task),
          };
          const observedAt = [
            task.status.timestamp,
            task.lastActivityAt,
            task.updatedAt,
          ].find(
            (value): value is string =>
              typeof value === "string" && Number.isFinite(Date.parse(value)),
          );
          const effectiveObservedAt = observedAt ?? fallbackObservedAt;
          if (
            attempt.observeResultsAfterKey &&
            attempt.observeResultsAfterKey.kind === resultKey.kind &&
            attempt.observeResultsAfterKey.id === resultKey.id
          ) {
            continue;
          }
          if (
            recordedResultKeys.has(
              `${attempt.codexTaskId}:${resultKey.kind}:${resultKey.id}`,
            )
          ) {
            continue;
          }
          const guardKey = `${attempt.id}:${resultKey.id}`;
          if (pending.has(guardKey)) continue;
          return {
            guardKey,
            mutation: {
              type: "result.upsert",
              projectId: managedProject.id,
              objectiveId: objective.id,
              workItemId: workItem.id,
              attemptId: attempt.id,
              result: {
                key: resultKey,
                observedAt: effectiveObservedAt,
              },
            },
          };
        }
      }
    }
  }
  return null;
}

interface UiSnapshot {
  generatedAt: string;
  pollIntervalMs: number;
  sourceHealth: SourceHealth;
  sourceFreshness: "fresh" | "stale";
  refreshState: "fresh" | "refreshing" | "stale" | "failed";
  cacheAgeMs: number;
  lastRefreshSuccessAt: string;
  projects: UiProject[];
  diagnostics: string[];
}

interface FeedState {
  snapshot: UiSnapshot | null;
  phase: "loading" | "ready" | "disconnected" | "parser-error";
  message?: string;
  lastRefresh?: Date;
}

const STATUS_NAMES = new Set<StatusName>(NORMALIZED_STATUS_VALUES);

const FETCH_TIMEOUT_MS = 30_000;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function nonNegativeInteger(value: unknown): number | undefined {
  const candidate = finite(value);
  return candidate !== undefined &&
    Number.isSafeInteger(candidate) &&
    candidate >= 0
    ? candidate
    : undefined;
}

function dateText(value: unknown): string | undefined {
  const candidate = text(value);
  return candidate && !Number.isNaN(Date.parse(candidate))
    ? candidate
    : undefined;
}

function recognizeStaff(
  title: string,
  explicit?: unknown,
): { kind: "staff" | "temporary"; name?: string } {
  const explicitKind = text(explicit);
  const match = /^\[AGENT\]\s+(.+)$/i.exec(title);
  if (explicitKind === "staff" || explicitKind === "named_agent" || match) {
    return { kind: "staff", name: match?.[1]?.trim() || undefined };
  }
  return { kind: "temporary" };
}

function decodeStatus(value: unknown): UiStatus {
  const sourceRecord = record(value);
  const rawValue =
    text(sourceRecord?.value) ?? text(sourceRecord?.status) ?? text(value);
  const normalizedValue = rawValue?.toLowerCase().replaceAll("-", "_") as
    StatusName | undefined;
  const recognizedStatus = Boolean(
    normalizedValue && STATUS_NAMES.has(normalizedValue),
  );
  const evidenceRaw =
    text(sourceRecord?.provenance) ??
    text(sourceRecord?.evidence) ??
    text(sourceRecord?.basis);

  return {
    value: recognizedStatus ? normalizedValue! : "unknown",
    evidence: evidenceRaw === "observed" ? "observed" : "inferred",
    source: text(sourceRecord?.source) ?? "normalized snapshot:unrecognized",
    timestamp:
      dateText(sourceRecord?.timestamp) ??
      dateText(sourceRecord?.observedAt) ??
      null,
    confidence: finite(sourceRecord?.confidence),
    stale: !recognizedStatus || sourceRecord?.stale !== false,
  };
}

function decodeTokenUsage(value: unknown): UiTokenUsage | undefined {
  const usage = record(value);
  const contextTokens = finite(usage?.contextTokens);
  const contextWindow = finite(usage?.contextWindow);
  const timestamp = dateText(usage?.timestamp);
  if (
    contextTokens === undefined ||
    contextWindow === undefined ||
    contextWindow <= 0 ||
    !timestamp
  )
    return undefined;
  return {
    contextTokens,
    contextWindow,
    cumulativeTokens: finite(usage?.cumulativeTokens),
    source: text(usage?.source) ?? "session token metadata",
    timestamp,
    stale: usage?.stale === true,
  };
}

function decodeTask(value: unknown): UiTask | null {
  const task = record(value);
  if (!task) return null;
  const id = text(task.id) ?? text(task.taskId) ?? text(task.threadId);
  const title = text(task.title) ?? text(task.name);
  if (!id || !title) return null;

  const staff = recognizeStaff(title, task.kind ?? task.type);
  const projectId = text(task.projectId);
  const decodedAssignmentEvidence =
    task.assignmentEvidence === "explicit_project" ||
    task.assignmentEvidence === "explicit_unassigned" ||
    task.assignmentEvidence === "explicit_unknown_project" ||
    task.assignmentEvidence === "cwd_fallback"
      ? task.assignmentEvidence
      : "cwd_fallback";
  const assignmentEvidence =
    (decodedAssignmentEvidence === "explicit_project" && !projectId) ||
    ((decodedAssignmentEvidence === "explicit_unassigned" ||
      decodedAssignmentEvidence === "explicit_unknown_project") &&
      projectId)
      ? "cwd_fallback"
      : decodedAssignmentEvidence;
  const updatedAt = dateText(task.updatedAt) ?? dateText(task.lastActivityAt);
  return {
    id,
    projectId,
    title,
    kind: staff.kind,
    assignmentEvidence,
    agentName: text(task.agentName) ?? text(task.displayName) ?? staff.name,
    model: text(task.model) ?? text(task.modelId),
    startedAt: dateText(task.startedAt) ?? dateText(task.createdAt),
    updatedAt,
    lastActivityAt: dateText(task.lastActivityAt) ?? updatedAt,
    status: decodeStatus(task.status),
    tokenUsage: decodeTokenUsage(task.tokenUsage),
  };
}

function decodeRepository(value: unknown): UiRepository | undefined {
  const repository = record(value);
  const observedAt = dateText(repository?.observedAt);
  if (!repository || !observedAt) return undefined;
  if (repository.availability === "unavailable") {
    if (repository.source !== "git") return undefined;
    return {
      availability: "unavailable",
      source: "git",
      observedAt,
    };
  }
  if (
    repository.availability !== "available" ||
    repository.source !== "git:status-porcelain-v2"
  ) {
    return undefined;
  }

  const branch = text(repository.branch);
  const headState = repository.headState;
  const headOid = repository.headOid;
  const changedFiles = nonNegativeInteger(repository.changedFiles);
  const stagedFiles = nonNegativeInteger(repository.stagedFiles);
  const untrackedFiles = nonNegativeInteger(repository.untrackedFiles);
  const conflictedFiles = nonNegativeInteger(repository.conflictedFiles);
  const ahead = nonNegativeInteger(repository.ahead);
  const behind = nonNegativeInteger(repository.behind);
  const changeAreas = record(repository.changeAreas);
  const totalFiles = nonNegativeInteger(changeAreas?.totalFiles);
  const summarizedFiles = nonNegativeInteger(changeAreas?.summarizedFiles);
  const omittedFiles = nonNegativeInteger(changeAreas?.omittedFiles);
  const rawAreas = Array.isArray(changeAreas?.areas) ? changeAreas.areas : null;
  const allowedAreas = new Set<UiRepositoryAreaName>([
    "Source",
    "Tests",
    "Docs",
    "Config",
    "Assets",
    "Other",
  ]);
  const areas = rawAreas?.map((value): UiRepositoryArea | null => {
    const area = record(value);
    const name = text(area?.area) as UiRepositoryAreaName | undefined;
    const files = nonNegativeInteger(area?.files);
    return name && allowedAreas.has(name) && files !== undefined && files > 0
      ? { area: name, files }
      : null;
  });
  const uniqueAreaNames = new Set(areas?.map((area) => area?.area));
  if (
    !branch ||
    branch.length > 96 ||
    (headState !== "commit" && headState !== "unborn") ||
    (headState === "commit" &&
      (typeof headOid !== "string" ||
        !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu.test(headOid))) ||
    (headState === "unborn" && headOid !== null) ||
    changedFiles === undefined ||
    stagedFiles === undefined ||
    untrackedFiles === undefined ||
    conflictedFiles === undefined ||
    ahead === undefined ||
    behind === undefined ||
    typeof repository.clean !== "boolean" ||
    totalFiles === undefined ||
    summarizedFiles === undefined ||
    omittedFiles === undefined ||
    !areas ||
    areas.some((area) => area === null) ||
    uniqueAreaNames.size !== areas.length ||
    areas.length > 6 ||
    totalFiles !== changedFiles ||
    summarizedFiles + omittedFiles !== totalFiles ||
    areas.reduce((sum, area) => sum + (area?.files ?? 0), 0) !==
      summarizedFiles ||
    repository.clean !== (changedFiles === 0) ||
    stagedFiles > changedFiles ||
    untrackedFiles > changedFiles ||
    conflictedFiles > changedFiles
  ) {
    return undefined;
  }

  const rawDiff = repository.diffStats;
  let diffStats: UiRepositoryDiffStats | undefined;
  if (rawDiff !== undefined) {
    const diff = record(rawDiff);
    const trackedFiles = nonNegativeInteger(diff?.trackedFiles);
    const additions = nonNegativeInteger(diff?.additions);
    const deletions = nonNegativeInteger(diff?.deletions);
    const binaryFiles = nonNegativeInteger(diff?.binaryFiles);
    const source = diff?.source;
    if (
      trackedFiles === undefined ||
      additions === undefined ||
      deletions === undefined ||
      binaryFiles === undefined ||
      source !== "git:diff-numstat" ||
      binaryFiles > trackedFiles ||
      trackedFiles > changedFiles
    ) {
      return undefined;
    }
    diffStats = { trackedFiles, additions, deletions, binaryFiles, source };
  }

  return {
    availability: "available",
    branch,
    headOid: headState === "commit" ? (headOid as string) : null,
    headState,
    changedFiles,
    stagedFiles,
    untrackedFiles,
    conflictedFiles,
    ahead,
    behind,
    clean: repository.clean,
    source: "git:status-porcelain-v2",
    observedAt,
    changeAreas: {
      totalFiles,
      summarizedFiles,
      omittedFiles,
      areas: areas as UiRepositoryArea[],
    },
    diffStats,
  };
}

function repositoryEvidenceState(
  repository: UiRepository | undefined,
  refreshState: UiSnapshot["refreshState"],
  sourceFreshness: UiSnapshot["sourceFreshness"],
): UiRepositoryEvidenceState {
  if (!repository) return "unavailable";
  if (repository.availability === "unavailable") {
    return refreshState === "refreshing" ? "refreshing" : "unavailable";
  }
  if (refreshState === "refreshing") return "refreshing";
  return refreshState === "stale" ||
    refreshState === "failed" ||
    sourceFreshness === "stale"
    ? "stale"
    : "fresh";
}

function decodeRepositoryRoots(
  value: unknown,
  refreshState: UiSnapshot["refreshState"],
  sourceFreshness: UiSnapshot["sourceFreshness"],
): UiRepositoryRoot[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map((candidate, index): UiRepositoryRoot => {
    const root = record(candidate);
    const expectedRole = index === 0 ? "primary" : "additional";
    const evidence =
      root?.role === expectedRole ? decodeRepository(root.evidence) : undefined;
    return evidence
      ? {
          role: expectedRole,
          evidence,
          evidenceState: repositoryEvidenceState(
            evidence,
            refreshState,
            sourceFreshness,
          ),
        }
      : {
          role: expectedRole,
          evidenceState:
            refreshState === "refreshing" ? "refreshing" : "unavailable",
        };
  });
}

function decodeProject(
  value: unknown,
  index: number,
  refreshState: UiSnapshot["refreshState"],
  sourceFreshness: UiSnapshot["sourceFreshness"],
): UiProject | null {
  const project = record(value);
  if (!project) return null;
  const id = text(project.id) ?? text(project.projectId) ?? `project-${index}`;
  const name =
    text(project.name) ?? text(project.displayName) ?? text(project.label);
  if (!name) return null;
  const tasksInput = Array.isArray(project.tasks)
    ? project.tasks
    : Array.isArray(project.sessions)
      ? project.sessions
      : [];
  const tasks = tasksInput
    .map(decodeTask)
    .filter((task): task is UiTask => task !== null)
    .sort((a, b) => a.id.localeCompare(b.id));

  const legacyRepository = decodeRepository(project.repository);
  const rawRepositoryRootCount = Array.isArray(project.repositoryRoots)
    ? project.repositoryRoots.length
    : undefined;
  const rawRepositoryRootsBoundedOut =
    rawRepositoryRootCount !== undefined &&
    rawRepositoryRootCount > MAX_REPOSITORY_ROOTS_PER_REFRESH;
  const boundedCollectionMarkerPresent =
    project.repositoryCollectionState === "bounded_out";
  const reportedRepositoryRootCount = nonNegativeInteger(
    project.repositoryRootCount,
  );
  const boundedRepositoryRootCount =
    reportedRepositoryRootCount && reportedRepositoryRootCount >= 1
      ? reportedRepositoryRootCount
      : undefined;
  const declaredRepositoryCollectionBoundedOut =
    boundedCollectionMarkerPresent && boundedRepositoryRootCount !== undefined;
  const repositoryCollectionState =
    rawRepositoryRootsBoundedOut || declaredRepositoryCollectionBoundedOut
      ? "bounded_out"
      : undefined;
  const repositoryRootsPresent = Object.hasOwn(project, "repositoryRoots");
  const decodedRepositoryRoots = rawRepositoryRootsBoundedOut
    ? undefined
    : decodeRepositoryRoots(
        project.repositoryRoots,
        refreshState,
        sourceFreshness,
      );
  const repositoryRoots =
    repositoryCollectionState || boundedCollectionMarkerPresent
      ? undefined
      : repositoryRootsPresent
        ? (decodedRepositoryRoots ?? [])
        : legacyRepository
          ? [
              {
                role: "primary" as const,
                evidence: legacyRepository,
                evidenceState: repositoryEvidenceState(
                  legacyRepository,
                  refreshState,
                  sourceFreshness,
                ),
              },
            ]
          : undefined;
  const repository = repositoryRoots?.[0]?.evidence;
  const primaryRepositoryEvidenceState =
    repositoryRoots?.[0]?.evidenceState ??
    repositoryEvidenceState(repository, refreshState, sourceFreshness);

  return {
    id,
    name,
    order: typeof project.order === "number" ? project.order : index,
    path: text(project.path) ?? text(project.workspacePath),
    tasks,
    repositoryRootCount:
      repositoryCollectionState === "bounded_out"
        ? declaredRepositoryCollectionBoundedOut
          ? boundedRepositoryRootCount
          : rawRepositoryRootCount
        : repositoryRoots?.length
          ? repositoryRoots.length
          : undefined,
    repositoryCollectionState,
    repository,
    repositoryRoots,
    repositoryEvidenceState: primaryRepositoryEvidenceState,
  };
}

export function decodeSnapshot(value: unknown): UiSnapshot {
  const envelope = record(value);
  const candidate = record(envelope?.snapshot) ?? envelope;
  if (!candidate || !Array.isArray(candidate.projects)) {
    throw new Error(
      "The local source returned an unrecognized snapshot shape.",
    );
  }

  const source = record(candidate.source);
  const sourceHealth =
    source?.health === "connected" ||
    source?.health === "degraded" ||
    source?.health === "disconnected"
      ? source.health
      : "disconnected";
  const reportedSourceFreshness =
    source?.freshness === "fresh" ? "fresh" : "stale";
  const sourceFreshness =
    sourceHealth === "disconnected" ? "stale" : reportedSourceFreshness;
  const reportedRefreshState =
    source?.refreshState === "fresh" ||
    source?.refreshState === "refreshing" ||
    source?.refreshState === "stale" ||
    source?.refreshState === "failed"
      ? source.refreshState
      : "failed";
  const refreshState =
    sourceHealth === "disconnected" && reportedRefreshState === "fresh"
      ? "failed"
      : reportedRefreshState;
  const projects = candidate.projects
    .map((project, index) =>
      decodeProject(project, index, refreshState, sourceFreshness),
    )
    .filter((project): project is UiProject => project !== null)
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  if (Array.isArray(candidate.tasks)) {
    const decodedTopLevelTasks = candidate.tasks
      .map(decodeTask)
      .filter((task): task is UiTask => task !== null);
    const projectIds = new Set(projects.map((project) => project.id));
    const topLevelTasks = decodedTopLevelTasks.map((task) =>
      task.assignmentEvidence === "explicit_project" &&
      task.projectId &&
      !projectIds.has(task.projectId)
        ? {
            ...task,
            projectId: undefined,
            assignmentEvidence: "explicit_unknown_project" as const,
          }
        : task,
    );
    for (const project of projects) {
      project.tasks = topLevelTasks
        .filter((task) => task.projectId === project.id)
        .sort((a, b) => a.id.localeCompare(b.id));
    }
    const unassignedTasks = topLevelTasks.filter(
      (task) => !task.projectId || !projectIds.has(task.projectId),
    );
    if (unassignedTasks.length) {
      projects.push({
        id: "__unassigned__",
        name: "Unassigned sessions",
        order: Number.MAX_SAFE_INTEGER,
        tasks: unassignedTasks,
        repositoryEvidenceState: "unavailable",
        holding: true,
      });
    }
  }
  const diagnostics = Array.isArray(candidate.diagnostics)
    ? candidate.diagnostics
        .map((item) => {
          if (typeof item === "string") return item;
          const diagnostic = record(item);
          return text(diagnostic?.message) ?? text(diagnostic?.code);
        })
        .filter((item): item is string => Boolean(item))
    : [];
  const sourceEvidenceIsStale =
    refreshState === "stale" ||
    refreshState === "failed" ||
    (sourceFreshness === "stale" && refreshState !== "refreshing");
  const projectsWithAssignmentFreshness = projects.map((item) => ({
    ...item,
    tasks: item.tasks.map((task) => ({
      ...task,
      assignmentSourceFresh: !sourceEvidenceIsStale,
    })),
  }));
  const visibleProjects = sourceEvidenceIsStale
    ? markProjectsStale(projectsWithAssignmentFreshness)
    : projectsWithAssignmentFreshness;

  return {
    generatedAt:
      dateText(candidate.generatedAt) ??
      dateText(candidate.timestamp) ??
      new Date().toISOString(),
    pollIntervalMs: Math.min(
      60_000,
      Math.max(
        2_000,
        finite(source?.pollIntervalMs) ??
          finite(candidate.pollIntervalMs) ??
          5_000,
      ),
    ),
    sourceHealth,
    sourceFreshness,
    refreshState,
    cacheAgeMs: Math.max(0, finite(source?.cacheAgeMs) ?? 0),
    lastRefreshSuccessAt:
      dateText(source?.lastRefreshSuccessAt) ??
      dateText(candidate.generatedAt) ??
      new Date().toISOString(),
    projects: visibleProjects,
    diagnostics,
  };
}

export function markProjectsStale(projects: readonly UiProject[]): UiProject[] {
  return projects.map((project) => ({
    ...project,
    repositoryEvidenceState:
      project.repository?.availability === "available"
        ? "stale"
        : "unavailable",
    repositoryRoots: project.repositoryRoots?.map((root) => ({
      ...root,
      evidenceState:
        root.evidence?.availability === "available" ? "stale" : "unavailable",
    })),
    tasks: project.tasks.map((task) => ({
      ...task,
      status: { ...task.status, stale: true },
      modelStale: Boolean(task.model),
      tokenUsage: task.tokenUsage
        ? { ...task.tokenUsage, stale: true }
        : undefined,
    })),
  }));
}

export function retainLastKnownModels(
  previousProjects: readonly UiProject[] | undefined,
  nextProjects: readonly UiProject[],
): UiProject[] {
  if (!previousProjects?.length) return [...nextProjects];
  const previousTasks = new Map(
    previousProjects.flatMap((project) =>
      project.tasks.map((task) => [task.id, task] as const),
    ),
  );

  return nextProjects.map((project) => ({
    ...project,
    tasks: project.tasks.map((task) => {
      if (task.model) return { ...task, modelStale: false };
      const previous = previousTasks.get(task.id);
      if (!previous?.model) return task;
      return { ...task, model: previous.model, modelStale: true };
    }),
  }));
}

function useSnapshotFeed(fallbackIntervalMs = 5_000): FeedState {
  const [state, setState] = useState<FeedState>({
    snapshot: null,
    phase: "loading",
  });

  const refresh = useCallback(
    async (signal: AbortSignal): Promise<number> => {
      const requestController = new AbortController();
      const forwardAbort = () => requestController.abort();
      signal.addEventListener("abort", forwardAbort, { once: true });
      const timeout = window.setTimeout(
        () => requestController.abort(),
        FETCH_TIMEOUT_MS,
      );

      try {
        const response = await fetch("/api/snapshot", {
          cache: "no-store",
          headers: { Accept: "application/json" },
          signal: requestController.signal,
        });
        if (!response.ok)
          throw new Error(`Local source unavailable (${response.status})`);
        const decodedSnapshot = decodeSnapshot(await response.json());
        const degraded =
          decodedSnapshot.sourceHealth === "degraded" ||
          decodedSnapshot.diagnostics.length > 0;
        setState((current) => {
          const snapshot = {
            ...decodedSnapshot,
            projects: retainLastKnownModels(
              current.snapshot?.projects,
              decodedSnapshot.projects,
            ),
          };
          const shouldRetainProjects =
            snapshot.sourceHealth === "disconnected" &&
            Boolean(current.snapshot?.projects.length);
          const visibleSnapshot = shouldRetainProjects
            ? {
                ...snapshot,
                projects: markProjectsStale(current.snapshot?.projects ?? []),
              }
            : snapshot;

          return {
            snapshot: visibleSnapshot,
            phase:
              snapshot.sourceHealth === "disconnected"
                ? "disconnected"
                : degraded
                  ? "parser-error"
                  : "ready",
            message: snapshot.diagnostics.length
              ? `${snapshot.diagnostics.length} source record${snapshot.diagnostics.length === 1 ? "" : "s"} could not be read.`
              : degraded
                ? "The local adapter reported a degraded read. Available metadata remains visible."
                : snapshot.sourceHealth === "disconnected"
                  ? shouldRetainProjects
                    ? "The local adapter could not refresh Codex metadata. The last available office remains visible."
                    : "The local adapter could not refresh Codex metadata."
                  : undefined,
            lastRefresh: new Date(),
          };
        });
        return decodedSnapshot.pollIntervalMs;
      } catch (error) {
        if (signal.aborted) return fallbackIntervalMs;
        const message = requestController.signal.aborted
          ? "The local source did not respond within 30 seconds."
          : error instanceof Error
            ? error.message
            : "The local source is unavailable.";
        setState((current) => ({
          ...current,
          snapshot: current.snapshot
            ? {
                ...current.snapshot,
                sourceHealth: "disconnected",
                sourceFreshness: "stale",
                refreshState: "failed",
                cacheAgeMs: Math.max(
                  current.snapshot.cacheAgeMs,
                  Date.now() -
                    Date.parse(current.snapshot.lastRefreshSuccessAt),
                ),
                projects: markProjectsStale(current.snapshot.projects),
              }
            : null,
          phase: "disconnected",
          message,
        }));
        return fallbackIntervalMs;
      } finally {
        window.clearTimeout(timeout);
        signal.removeEventListener("abort", forwardAbort);
      }
    },
    [fallbackIntervalMs],
  );

  useEffect(() => {
    let stopped = false;
    let timer: number | undefined;
    let controller: AbortController | undefined;

    const scheduleRefresh = async () => {
      controller = new AbortController();
      const nextInterval = await refresh(controller.signal);
      if (!stopped) {
        timer = window.setTimeout(() => void scheduleRefresh(), nextInterval);
      }
    };

    timer = window.setTimeout(() => void scheduleRefresh(), 0);
    return () => {
      stopped = true;
      controller?.abort();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [refresh]);

  return state;
}

function ageText(milliseconds: number): string {
  if (milliseconds < 60_000) return "under a minute";
  if (milliseconds < 3_600_000)
    return `${Math.floor(milliseconds / 60_000)} minutes`;
  return `${Math.floor(milliseconds / 3_600_000)} hours`;
}

function SessionLivenessCue({
  liveness,
  compact = false,
}: {
  liveness: SessionLiveness;
  compact?: boolean;
}) {
  return (
    <span
      className={`session-liveness session-liveness-${liveness.tone} ${compact ? "session-liveness-compact" : ""}`}
      aria-label={sessionLivenessAriaLabel(liveness)}
    >
      <i aria-hidden="true" />
      {sessionLivenessChipText(liveness)}
    </span>
  );
}

function SystemNotice({
  feed,
  referenceTime,
}: {
  feed: FeedState;
  referenceTime: number;
}) {
  const refreshState = feed.snapshot?.refreshState;
  const sourceAgeMs = feed.snapshot
    ? Math.max(
        feed.snapshot.cacheAgeMs,
        referenceTime - Date.parse(feed.snapshot.lastRefreshSuccessAt),
      )
    : 0;
  // A routine background refresh keeps the last complete snapshot usable. Keep
  // that transient state in the fixed-size header indicator so the office does
  // not move when the refresh starts and finishes. Reserve this notice for the
  // initial load and states that genuinely need the user's attention.
  if (
    feed.phase === "ready" &&
    (refreshState === "fresh" || refreshState === "refreshing")
  )
    return null;
  const title =
    feed.phase === "loading"
      ? "Opening the local office"
      : refreshState === "refreshing"
        ? "Refreshing Codex metadata"
        : refreshState === "failed" && feed.phase !== "disconnected"
          ? "Latest metadata refresh failed"
          : refreshState === "stale" && feed.phase !== "disconnected"
            ? "Showing an older local snapshot"
            : feed.phase === "parser-error"
              ? "Some records were skipped"
              : feed.snapshot
                ? "Live connection interrupted"
                : "Coffice cannot reach the local source";
  return (
    <div
      className={`system-notice notice-${feed.phase} notice-refresh-${refreshState ?? "none"}`}
      role={
        feed.phase === "loading" || refreshState === "refreshing"
          ? "status"
          : "alert"
      }
    >
      <span className="notice-sprite" aria-hidden="true">
        !
      </span>
      <div>
        <strong>{title}</strong>
        <p>
          {feed.phase === "loading"
            ? "Preparing a metadata-only view."
            : refreshState === "refreshing"
              ? `The last complete snapshot remains visible during refresh (${ageText(sourceAgeMs)} old).`
              : refreshState === "stale" || refreshState === "failed"
                ? feed.message
                  ? `${feed.message} The last good metadata is ${ageText(sourceAgeMs)} old.`
                  : `The visible metadata is ${ageText(sourceAgeMs)} old.`
                : (feed.message ??
                  "The last valid snapshot remains visible while Coffice retries.")}
        </p>
      </div>
    </div>
  );
}

function repositoryMoodText(
  repository: UiRepository | undefined,
  repositoryRoots: readonly UiRepositoryRoot[] | undefined,
  repositoryRootCount?: number,
  repositoryCollectionState?: "bounded_out",
): string {
  if (
    repositoryCollectionState === "bounded_out" &&
    repositoryRootCount !== undefined
  ) {
    return `${repositoryRootCount} Git roots · evidence unavailable`;
  }
  if (repositoryRoots && repositoryRoots.length > 1) {
    return `${repositoryRoots.length} Git roots · inspect separately`;
  }
  if (!repository || repository.availability === "unavailable") {
    return "No Git signal";
  }
  if (repository.conflictedFiles) {
    return `Storm · ${repository.conflictedFiles} conflict`;
  }
  if (repository.clean) return "Clear skies · clean";
  return `Breezy · ${repository.changedFiles} changed`;
}

function RepoMood({
  repository,
  repositoryRoots,
  repositoryRootCount,
  repositoryCollectionState,
}: {
  repository?: UiRepository;
  repositoryRoots?: readonly UiRepositoryRoot[];
  repositoryRootCount?: number;
  repositoryCollectionState?: "bounded_out";
}) {
  const mood = repositoryMoodText(
    repository,
    repositoryRoots,
    repositoryRootCount,
    repositoryCollectionState,
  );
  if (repositoryCollectionState === "bounded_out")
    return <span className="repo-mood repo-unknown">{mood}</span>;
  if (repositoryRoots && repositoryRoots.length > 1)
    return <span className="repo-mood repo-unknown">{mood}</span>;
  if (!repository || repository.availability === "unavailable")
    return <span className="repo-mood repo-unknown">{mood}</span>;
  if (repository.conflictedFiles)
    return <span className="repo-mood repo-storm">{mood}</span>;
  if (repository.clean)
    return <span className="repo-mood repo-clean">{mood}</span>;
  return <span className="repo-mood repo-breezy">{mood}</span>;
}

const EMPTY_ATTENTION_COUNTS: Readonly<AttentionDigestCounts> = Object.freeze({
  needsReply: 0,
  needsDecision: 0,
  unreadResults: 0,
  otherActions: 0,
  total: 0,
});

function countLabel(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

function repliesNeededLabel(count: number): string {
  return `${count} ${count === 1 ? "reply" : "replies"} needed`;
}

function decisionsNeededLabel(count: number): string {
  return `${count} ${count === 1 ? "decision" : "decisions"} needed`;
}

export function describeWorkspacePersistence(
  workspace: Pick<
    CofficeWorkspaceController,
    "ready" | "persistent" | "recovery" | "recoveryAcknowledged"
  >,
): { state: "loading" | "recovery" | "saved" | "unavailable"; label: string } {
  if (!workspace.ready) {
    return { state: "loading", label: "Coffice workspace is loading" };
  }
  if (
    workspace.recovery?.kind === "backup" &&
    !workspace.recoveryAcknowledged
  ) {
    return { state: "recovery", label: "Recovered workspace needs review" };
  }
  if (workspace.persistent) {
    return { state: "saved", label: "Coffice workspace saved locally" };
  }
  return { state: "unavailable", label: "Coffice workspace unavailable" };
}

export function Campus({
  projects,
  onEnter,
  referenceTime,
  projectCountsById,
  workspace,
  review,
  attentionProjection,
  digestSourceState,
  onOpenReviewTask,
  onOpenStoredResult,
  onOpenProjectPlan,
  desktopAlerts,
}: {
  projects: UiProject[];
  onEnter: (id: string) => void;
  referenceTime: number;
  projectCountsById: ReadonlyMap<string, ProjectTaskCounts>;
  workspace: CofficeWorkspaceController;
  review: AttentionReviewController;
  attentionProjection: AttentionProjectProjection;
  digestSourceState: DigestSourceState;
  onOpenReviewTask: (projectId: string, taskId: string) => void;
  onOpenStoredResult: (target: VerificationTarget) => void;
  onOpenProjectPlan?: (projectId: string) => void;
  desktopAlerts: DesktopAlertSettingsController;
}) {
  const [preferences, setPreferences] = useState<CampusPreferences>(() => {
    if (typeof window === "undefined") return DEFAULT_CAMPUS_PREFERENCES;
    try {
      return parseCampusPreferences(
        window.localStorage.getItem(CAMPUS_PREFERENCES_STORAGE_KEY),
      );
    } catch {
      return DEFAULT_CAMPUS_PREFERENCES;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(
        CAMPUS_PREFERENCES_STORAGE_KEY,
        serializeCampusPreferences(preferences),
      );
    } catch {
      // The arrangement still works for this visit when storage is unavailable.
    }
  }, [preferences]);

  if (!projects.length) {
    return (
      <section className="empty-world" aria-labelledby="empty-heading">
        <div className="empty-island" aria-hidden="true">
          <i />
          <b />
          <em />
        </div>
        <h1 id="empty-heading">The campus is quiet</h1>
        <p>
          No saved Codex projects are visible yet. Keep Codex installed for this
          local account, then open or create a top-level task assigned to a
          local project. Coffice refreshes automatically.
        </p>
      </section>
    );
  }

  const totalWorkers = projects.reduce(
    (sum, project) => sum + project.tasks.length,
    0,
  );
  const totalActive = projects.reduce(
    (sum, project) =>
      sum +
      (projectCountsById.get(project.id) ?? EMPTY_PROJECT_TASK_COUNTS).active,
    0,
  );
  const savedProjectCount = projects.filter(
    (project) => !project.holding,
  ).length;
  const projectSignals = projects.map((project) => {
    const counts =
      projectCountsById.get(project.id) ?? EMPTY_PROJECT_TASK_COUNTS;
    const attentionCounts =
      attentionProjection.byProjectId.get(project.id)?.counts ??
      EMPTY_ATTENTION_COUNTS;
    return {
      project,
      counts,
      attentionCounts,
      summary: summarizeProjectSignals(project.tasks, referenceTime),
    };
  });
  const totalLive = projectSignals.reduce(
    (sum, item) => sum + item.summary.liveCount,
    0,
  );
  const quietWingCount = review.ready
    ? projectSignals.filter(
        ({ project, attentionCounts }) =>
          !project.holding &&
          project.tasks.length === 0 &&
          attentionCounts.total === 0,
      ).length
    : 0;
  const orderedProjects = [...projectSignals];
  if (review.ready && preferences.attentionFirst) {
    orderedProjects.sort((a, b) =>
      compareCampusProjectsByAttention(
        {
          order: a.project.order,
          holding: a.project.holding,
          signals: {
            attentionCount: a.attentionCounts.total,
            liveCount: a.summary.liveCount,
          },
        },
        {
          order: b.project.order,
          holding: b.project.holding,
          signals: {
            attentionCount: b.attentionCounts.total,
            liveCount: b.summary.liveCount,
          },
        },
      ),
    );
  }
  const visibleProjects = preferences.hideQuietWings
    ? orderedProjects.filter(
        ({ project, attentionCounts }) =>
          !review.ready ||
          project.holding ||
          project.tasks.length > 0 ||
          attentionCounts.total > 0,
      )
    : orderedProjects;
  const { digest } = attentionProjection;
  return (
    <section className="campus" aria-labelledby="campus-heading">
      <header className="campus-hero">
        <div>
          <p className="eyebrow">Workspace overview</p>
          <h1 id="campus-heading">Your project offices</h1>
          <p className="hero-copy">
            See live agents, define outcomes, review results, and steer Codex
            from one local command center.
          </p>
        </div>
        <div className="campus-scoreboard" aria-label="Campus summary">
          <span>
            <b>{savedProjectCount}</b>
            <small>saved projects</small>
          </span>
          <span>
            <b>{totalWorkers}</b>
            <small>sessions</small>
          </span>
          <span>
            <b>{totalActive}</b>
            <small>status active</small>
          </span>
        </div>
      </header>

      <div className="campus-operations" aria-label="Campus attention summary">
        <div className="campus-attention-rollup">
          <span className={digest.counts.needsReply ? "rollup-reply" : ""}>
            <b>{review.ready ? digest.counts.needsReply : "—"}</b> needs reply
          </span>
          <span
            className={digest.counts.needsDecision ? "rollup-decision" : ""}
          >
            <b>{review.ready ? digest.counts.needsDecision : "—"}</b> needs
            decision
          </span>
          <span className={digest.counts.unreadResults ? "rollup-unread" : ""}>
            <b>{review.ready ? digest.counts.unreadResults : "—"}</b> unread
            results
          </span>
          <span className={digest.counts.otherActions ? "rollup-actions" : ""}>
            <b>{review.ready ? digest.counts.otherActions : "—"}</b> other
            actions
          </span>
          <span className={totalLive ? "rollup-live" : ""}>
            <b>{totalLive}</b> session-live
          </span>
        </div>
        <div className="campus-view-controls" aria-label="Campus view controls">
          <ActionableDigest
            ready={review.ready}
            digest={digest}
            referenceTime={referenceTime}
            sourceState={digestSourceState}
            persistent={review.persistent}
            onMarkSeen={review.markSeen}
            onOpenTask={onOpenReviewTask}
            onOpenStoredResult={onOpenStoredResult}
            onOpenProjectPlan={onOpenProjectPlan}
            desktopAlerts={desktopAlerts}
            desktopAlertProjects={projects.map((item) => ({
              ...item,
              name: formatVisibleProjectName(item),
            }))}
          />
          <button
            type="button"
            aria-pressed={preferences.attentionFirst}
            aria-label={
              review.ready
                ? undefined
                : "Attention order unavailable while Attention is loading"
            }
            disabled={!review.ready}
            onClick={() =>
              setPreferences((current) => ({
                ...current,
                attentionFirst: !current.attentionFirst,
              }))
            }
          >
            {!review.ready
              ? "Order unavailable"
              : preferences.attentionFirst
                ? "Attention order"
                : "Saved order"}
          </button>
          {quietWingCount > 0 && (
            <button
              type="button"
              aria-expanded={!preferences.hideQuietWings}
              onClick={() =>
                setPreferences((current) => ({
                  ...current,
                  hideQuietWings: !current.hideQuietWings,
                }))
              }
            >
              {preferences.hideQuietWings
                ? `Show ${quietWingCount} quiet wing${quietWingCount === 1 ? "" : "s"}`
                : "Hide quiet wings"}
            </button>
          )}
        </div>
      </div>

      <div className="campus-map">
        {visibleProjects.map(
          ({ project, counts, attentionCounts, summary }, index) => {
            const displayName = formatVisibleProjectName(project);
            const objective = selectActiveObjective(
              selectWorkspaceProject(workspace.workspace, project.id),
            );
            const attentionSummary = review.ready
              ? `${countLabel(attentionCounts.total, "current action")}: ${repliesNeededLabel(attentionCounts.needsReply)}, ${decisionsNeededLabel(attentionCounts.needsDecision)}, ${countLabel(attentionCounts.unreadResults, "unread result")}, ${countLabel(attentionCounts.otherActions, "other action")}.`
              : "Current actions not ready.";
            return (
              <button
                className={`project-building building-${index % 3} ${project.holding ? "building-holding" : ""}`}
                key={project.id}
                data-project-id={project.id}
                data-repository-root-count={
                  project.repositoryRootCount ??
                  project.repositoryRoots?.length ??
                  (project.repository ? 1 : 0)
                }
                data-repository-collection-state={
                  project.repositoryCollectionState
                }
                data-attention-count={
                  review.ready ? attentionCounts.total : "—"
                }
                data-needs-reply-count={
                  review.ready ? attentionCounts.needsReply : "—"
                }
                data-needs-decision-count={
                  review.ready ? attentionCounts.needsDecision : "—"
                }
                data-unread-result-count={
                  review.ready ? attentionCounts.unreadResults : "—"
                }
                onClick={() => onEnter(project.id)}
                aria-label={`${project.holding ? "Open holding area" : `Enter ${displayName}`}. ${counts.active} status active. ${attentionSummary}${project.repositoryCollectionState === "bounded_out" && project.repositoryRootCount !== undefined ? ` ${project.repositoryRootCount} saved Git roots; evidence unavailable.` : project.repositoryRoots && project.repositoryRoots.length > 1 ? ` ${project.repositoryRoots.length} saved Git roots; inspect separately.` : ""} ${sessionLivenessAriaLabel(summary.liveness)}.${summary.maxContextPercent === null ? " Context not reported." : ` Peak context ${summary.maxContextPercent}%${summary.maxContextStale ? ", stale token evidence" : ""}.`}`}
              >
                <span className="project-monogram" aria-hidden="true">
                  {displayName.slice(0, 2).toLocaleUpperCase()}
                </span>
                <span className="building-content">
                  <span className="building-number">
                    {project.holding
                      ? "Unassigned sessions"
                      : `Project ${String(project.order + 1).padStart(2, "0")}`}
                  </span>
                  <strong title={project.name}>{displayName}</strong>
                  <RepoMood
                    repository={project.repository}
                    repositoryRoots={project.repositoryRoots}
                    repositoryRootCount={project.repositoryRootCount}
                    repositoryCollectionState={
                      project.repositoryCollectionState
                    }
                  />
                  <span
                    className={`building-objective${objective ? "" : " building-objective-empty"}`}
                    title={objective?.title}
                  >
                    {project.holding
                      ? "Current unassigned work"
                      : (objective?.title ?? "No project objective yet")}
                  </span>
                  <span className="building-signals">
                    <SessionLivenessCue liveness={summary.liveness} compact />
                    <span
                      className={`building-context context-${summary.maxContextPercent === null ? "unknown" : summary.maxContextPercent >= 80 ? "high" : summary.maxContextPercent >= 55 ? "medium" : "low"}`}
                    >
                      {summary.maxContextPercent === null
                        ? "Context —"
                        : `Peak context ${summary.maxContextPercent}%${summary.maxContextStale ? " · stale" : ""}`}
                    </span>
                  </span>
                  <span className="building-stats">
                    <span>
                      <b>{counts.active}</b> active
                    </span>
                    <span
                      className={
                        review.ready && attentionCounts.total > 0
                          ? "stat-alert"
                          : undefined
                      }
                    >
                      <b>{review.ready ? attentionCounts.total : "—"}</b>{" "}
                      {review.ready && attentionCounts.total === 1
                        ? "action"
                        : "actions"}
                    </span>
                    {review.ready && attentionCounts.needsReply > 0 ? (
                      <span className="stat-reply">
                        <b>{attentionCounts.needsReply}</b>{" "}
                        {attentionCounts.needsReply === 1
                          ? "reply needed"
                          : "replies needed"}
                      </span>
                    ) : null}
                    {review.ready && attentionCounts.needsDecision > 0 ? (
                      <span className="stat-decision">
                        <b>{attentionCounts.needsDecision}</b>{" "}
                        {attentionCounts.needsDecision === 1
                          ? "decision needed"
                          : "decisions needed"}
                      </span>
                    ) : null}
                    {review.ready && attentionCounts.unreadResults > 0 ? (
                      <span className="stat-unread">
                        <b>{attentionCounts.unreadResults}</b>{" "}
                        {attentionCounts.unreadResults === 1
                          ? "unread result"
                          : "unread results"}
                      </span>
                    ) : null}
                  </span>
                  <span className="enter-building">
                    {project.holding ? "Review sessions" : "Open office"}{" "}
                    <b>→</b>
                  </span>
                </span>
              </button>
            );
          },
        )}
      </div>
    </section>
  );
}

function Office({
  project,
  projects,
  onExit,
  onEnterProject,
  referenceTime,
  projectCountsById,
  review,
  attentionProjection,
  requestedReviewTask,
  requestedPlanTarget,
  requestedPlanProjectId,
  onOpenReviewTask,
  onReviewRequestHandled,
  onPlanRequestHandled,
  workspace,
  codexActions,
  verifications,
}: {
  project: UiProject;
  projects: UiProject[];
  onExit: () => void;
  onEnterProject: (id: string) => void;
  referenceTime: number;
  projectCountsById: ReadonlyMap<string, ProjectTaskCounts>;
  review: AttentionReviewController;
  attentionProjection: AttentionProjectProjection;
  requestedReviewTask: { projectId: string; taskId: string } | null;
  requestedPlanTarget: VerificationTarget | null;
  requestedPlanProjectId: string | null;
  onOpenReviewTask: (projectId: string, taskId: string) => void;
  onReviewRequestHandled: (taskId: string) => void;
  onPlanRequestHandled: (projectId: string) => void;
  workspace: CofficeWorkspaceController;
  codexActions: CodexActionsController;
  verifications: VerificationsController;
}) {
  const attentionGroup = attentionProjection.byProjectId.get(project.id);
  const visibleAttentionItems = useMemo(
    () => attentionGroup?.items.map((entry) => entry.item) ?? [],
    [attentionGroup],
  );
  const reviewWorkspace = useMemo(
    () => ({
      controller: review,
      visibleAttentionItems,
      verificationProjectScoped: true,
      verifications,
      requestedTask: requestedReviewTask,
      requestedPlanTarget,
      requestedPlanProjectId,
      onOpenTask: onOpenReviewTask,
      onRequestHandled: onReviewRequestHandled,
      onPlanRequestHandled,
    }),
    [
      onOpenReviewTask,
      onPlanRequestHandled,
      onReviewRequestHandled,
      requestedPlanTarget,
      requestedPlanProjectId,
      requestedReviewTask,
      review,
      verifications,
      visibleAttentionItems,
    ],
  );

  return (
    <PixelOffice
      key={project.id}
      project={project}
      projects={projects}
      onExit={onExit}
      onEnterProject={onEnterProject}
      referenceTime={referenceTime}
      projectCountsById={projectCountsById}
      attentionProjectGroupsById={attentionProjection.byProjectId}
      reviewWorkspace={reviewWorkspace}
      workspace={workspace}
      codexActions={codexActions}
    />
  );
}

function VerificationProjectMonitor({
  projectId,
  onReceiptChanged,
}: {
  projectId: string;
  onReceiptChanged: () => void | Promise<void>;
}) {
  useVerifications(projectId, onReceiptChanged);
  return null;
}

export function CofficeApp() {
  const feed = useSnapshotFeed();
  const workspace = useCofficeWorkspace();
  const codexActions = useCodexActions();
  const desktopAlertProjectIds = useMemo(
    () => (feed.snapshot?.projects ?? []).map((item) => item.id),
    [feed.snapshot?.projects],
  );
  const desktopAlerts = useDesktopAlertSettings(desktopAlertProjectIds);
  const brandRef = useRef<HTMLButtonElement>(null);
  const evidenceWrites = useRef(new Set<string>());
  const resultObservationWrites = useRef(new Set<string>());
  const [projectId, setProjectId] = useState<string | null | undefined>(
    undefined,
  );
  const [clockTime, setClockTime] = useState(() => Date.now());
  const [reviewObservationStartedAt] = useState(() => Date.now());
  const project = useMemo(() => {
    if (projectId === null) return null;
    if (!feed.snapshot?.projects.length) return null;
    if (projectId !== undefined) {
      return (
        feed.snapshot.projects.find((item) => item.id === projectId) ?? null
      );
    }

    return (
      feed.snapshot.projects.find((item) => item.tasks.length > 0) ??
      feed.snapshot.projects[0]
    );
  }, [feed.snapshot, projectId]);
  const referenceTime = clockTime;
  const attentionProjects = useMemo(
    () =>
      (feed.snapshot?.projects ?? []).map((item) => ({
        ...item,
        name: formatVisibleProjectName(item),
        verificationReceipts: selectVerificationAttentionReceipts(
          workspace.workspace,
          item,
        ),
        planLinkNotices: selectPlanLinkAttentionNotices(
          workspace.workspace,
          item,
        ),
        decisionRequests: selectDecisionRequestAttentionItems(
          workspace.workspace,
          item,
        ),
        reviewSchedule: selectWorkspaceProject(workspace.workspace, item.id)
          ?.reviewSchedule,
      })),
    [feed.snapshot?.projects, workspace.workspace],
  );
  const reviewStateAuthoritative = Boolean(
    feed.snapshot?.sourceFreshness === "fresh" &&
    feed.snapshot?.refreshState === "fresh",
  );
  const resolvedCompletionEventKeys = useMemo(
    () => selectReviewedResultAttentionEventKeys(workspace.workspace),
    [workspace.workspace],
  );
  const review = useAttentionReviewState(
    attentionProjects,
    referenceTime,
    reviewStateAuthoritative,
    reviewObservationStartedAt,
    {
      state: workspace.workspace?.attentionReview ?? null,
      ready: workspace.ready,
      persistent: workspace.persistent,
      updateEvent: workspace.updateAttentionEvent,
    },
    resolvedCompletionEventKeys,
  );
  const attentionProjection = useMemo(
    () =>
      selectAttentionProjectProjection(
        review.items,
        feed.snapshot?.projects ?? [],
        review.dispositionFor,
      ),
    [feed.snapshot?.projects, review.dispositionFor, review.items],
  );
  const verifications = useVerifications(
    project?.id ?? null,
    workspace.refresh,
  );
  const activeVerificationProjectIds = useMemo(
    () =>
      [
        ...new Set(
          (workspace.workspace?.verificationReceipts ?? [])
            .filter(
              (receipt) =>
                receipt.state === "queued" || receipt.state === "running",
            )
            .map((receipt) => receipt.target.projectId),
        ),
      ].filter((activeProjectId) => activeProjectId !== project?.id),
    [project?.id, workspace.workspace?.verificationReceipts],
  );
  const durableWorkspace = workspace.workspace;
  const workspacePersistent = workspace.persistent;
  const mutateWorkspace = workspace.mutate;
  useEffect(() => {
    const snapshot = feed.snapshot;
    if (!durableWorkspace || !workspacePersistent || !snapshot) return;
    const recordedReferences = new Set(
      durableWorkspace.evidence
        .map((record) => record.provenance.reference)
        .filter((reference): reference is string => Boolean(reference)),
    );
    const pendingEvidence = selectNextCodexOperationEvidence(
      codexActions.operations,
      snapshot.projects,
      recordedReferences,
      evidenceWrites.current,
    );
    if (!pendingEvidence) return;
    const { operation } = pendingEvidence;
    const projectWithTask = snapshot.projects.find(
      (candidate) => candidate.id === pendingEvidence.projectId,
    );
    if (!projectWithTask) return;
    const context = selectTaskWorkContext(
      durableWorkspace,
      projectWithTask.id,
      operation.taskId,
    );
    const summary =
      operation.state === "completed"
        ? operation.kind === "request_review"
          ? "Codex review completed; no verdict was reported."
          : "Codex follow-up completed."
        : operation.state === "failed"
          ? "Codex action failed."
          : operation.state === "interrupted"
            ? "Codex action was interrupted."
            : "Coffice could not confirm whether the Codex action completed.";
    evidenceWrites.current.add(operation.id);
    void mutateWorkspace({
      type: "evidence.append",
      record: {
        id: `codex-operation-${operation.id}`,
        kind: "action",
        outcome: operation.state === "failed" ? "failed" : "neutral",
        summary,
        recordedAt: operation.updatedAt,
        projectId: projectWithTask.id,
        ...(context
          ? {
              objectiveId: context.objective.id,
              workItemId: context.workItem.id,
              attemptId: context.attempt.id,
            }
          : {}),
        provenance: {
          source: "codex",
          reference: `codex-operation:${operation.id}`,
        },
      },
    }).finally(() => evidenceWrites.current.delete(operation.id));
  }, [
    codexActions.operations,
    durableWorkspace,
    feed.snapshot,
    mutateWorkspace,
    workspacePersistent,
  ]);
  useEffect(() => {
    const snapshot = feed.snapshot;
    if (
      !durableWorkspace ||
      !workspacePersistent ||
      !snapshot ||
      snapshot.sourceFreshness !== "fresh" ||
      snapshot.refreshState !== "fresh"
    ) {
      return;
    }
    const next = selectNextResultObservation(
      durableWorkspace,
      snapshot.projects,
      resultObservationWrites.current,
      new Date().toISOString(),
    );
    if (!next) return;
    resultObservationWrites.current.add(next.guardKey);
    void mutateWorkspace(next.mutation).finally(() =>
      resultObservationWrites.current.delete(next.guardKey),
    );
  }, [durableWorkspace, feed.snapshot, mutateWorkspace, workspacePersistent]);
  const [requestedReviewTask, setRequestedReviewTask] = useState<{
    projectId: string;
    taskId: string;
  } | null>(null);
  const [requestedPlanTarget, setRequestedPlanTarget] =
    useState<VerificationTarget | null>(null);
  const [requestedPlanProjectId, setRequestedPlanProjectId] = useState<
    string | null
  >(null);
  const openReviewTask = useCallback(
    (nextProjectId: string, taskId: string) => {
      setRequestedPlanTarget(null);
      setRequestedPlanProjectId(null);
      setRequestedReviewTask({ projectId: nextProjectId, taskId });
      setProjectId(nextProjectId);
    },
    [],
  );
  const openStoredResult = useCallback((target: VerificationTarget) => {
    setRequestedReviewTask(null);
    setRequestedPlanProjectId(null);
    setRequestedPlanTarget(target);
    setProjectId(target.projectId);
  }, []);
  const openProjectPlan = useCallback((nextProjectId: string) => {
    setRequestedReviewTask(null);
    setRequestedPlanTarget(null);
    setRequestedPlanProjectId(nextProjectId);
    setProjectId(nextProjectId);
  }, []);
  const handleReviewRequest = useCallback((taskId: string) => {
    setRequestedReviewTask((current) =>
      current?.taskId === taskId ? null : current,
    );
  }, []);
  const handlePlanRequest = useCallback((nextProjectId: string) => {
    setRequestedPlanTarget((current) =>
      current?.projectId === nextProjectId ? null : current,
    );
    setRequestedPlanProjectId((current) =>
      current === nextProjectId ? null : current,
    );
  }, []);
  const showCampus = useCallback(() => {
    setRequestedReviewTask(null);
    setRequestedPlanTarget(null);
    setRequestedPlanProjectId(null);
    setProjectId(null);
  }, []);
  const focusBrand = useCallback(() => brandRef.current?.focus(), []);
  const projectCountsById = useMemo(
    () => selectProjectCountsById(feed.snapshot?.projects ?? []),
    [feed.snapshot?.projects],
  );
  const sourceStale =
    feed.phase === "disconnected" ||
    feed.snapshot?.refreshState === "stale" ||
    feed.snapshot?.refreshState === "failed" ||
    (feed.snapshot?.sourceFreshness === "stale" &&
      feed.snapshot?.refreshState !== "refreshing");
  const digestSourceState: DigestSourceState =
    feed.phase === "disconnected"
      ? "unavailable"
      : feed.snapshot?.refreshState === "refreshing"
        ? "refreshing"
        : sourceStale
          ? "stale"
          : "fresh";
  const workspacePersistence = describeWorkspacePersistence(workspace);

  useEffect(() => {
    const timer = window.setInterval(() => setClockTime(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [projectId]);

  return (
    <main className={`app-shell${project ? " app-shell-office" : ""}`}>
      {activeVerificationProjectIds.map((activeProjectId) => (
        <VerificationProjectMonitor
          key={activeProjectId}
          projectId={activeProjectId}
          onReceiptChanged={workspace.refresh}
        />
      ))}
      <header className="app-bar">
        <button
          ref={brandRef}
          className="brand"
          onClick={showCampus}
          aria-label="Coffice campus map"
        >
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 36 36" focusable="false">
              <rect
                className="brand-desk"
                x="5"
                y="6"
                width="26"
                height="12"
                rx="4"
              />
              <rect
                className="brand-screen"
                x="11"
                y="9"
                width="14"
                height="6"
                rx="2"
              />
              <rect
                className="brand-chair"
                x="12"
                y="20"
                width="12"
                height="4"
                rx="2"
              />
              <circle className="brand-agent" cx="18" cy="29" r="5" />
            </svg>
          </span>
          <span>
            <b>Coffice</b>
            <small>Local agent workspace</small>
          </span>
        </button>
        <div className="connection-summary">
          <Link href="/" className="companion-return">
            Little office ↗
          </Link>
          <span className="read-only-badge">
            <i aria-hidden="true" /> Review &amp; act
          </span>
          <span
            className={`connection-state connection-${feed.phase} connection-refresh-${feed.snapshot?.refreshState ?? "none"}`}
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            <i aria-hidden="true" />
            {feed.phase === "loading"
              ? "Opening"
              : feed.phase === "disconnected"
                ? "Disconnected"
                : feed.snapshot?.refreshState === "refreshing"
                  ? "Refreshing"
                  : sourceStale
                    ? "Stale local"
                    : "Live local"}
          </span>
          <span className="source-caption">Codex metadata</span>
          <span className="refresh-time">
            {feed.lastRefresh
              ? feed.lastRefresh.toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })
              : "—"}
          </span>
        </div>
      </header>

      <AttentionTransitionController
        admissionReady={review.ready && reviewStateAuthoritative}
        items={review.items}
        dispositionFor={review.dispositionFor}
        sourceState={digestSourceState}
        desktopAlerts={desktopAlerts}
        onMarkSeen={review.markSeen}
        onOpenTask={openReviewTask}
        onOpenStoredResult={openStoredResult}
        onOpenProjectPlan={openProjectPlan}
        onRequestFallbackFocus={focusBrand}
      />

      <div
        className="app-notices"
        role={project ? "region" : undefined}
        aria-label={project ? "Workspace notices" : undefined}
        tabIndex={project ? 0 : undefined}
      >
        <SystemNotice feed={feed} referenceTime={referenceTime} />
        {(sourceStale ||
          feed.snapshot?.projects.some((item) =>
            item.tasks.some((task) => task.status.stale),
          )) && (
          <div className="stale-banner" role="status">
            <i aria-hidden="true" /> Some status evidence is dusty. Check
            timestamps before acting.
          </div>
        )}
        {workspace.recovery?.kind === "backup" &&
        !workspace.recoveryAcknowledged ? (
          <div className="workspace-recovery-banner" role="alert">
            <span>
              <b>Workspace recovered from backup.</b> Review the plan before
              saving new decisions or Attention changes.
            </span>
            <button type="button" onClick={workspace.acknowledgeRecovery}>
              I reviewed the recovered plan
            </button>
          </div>
        ) : null}
      </div>

      <div className="content-shell">
        {!feed.snapshot ? (
          feed.phase === "loading" ? (
            <div
              className="loading-world"
              aria-label="Loading projects"
              aria-busy="true"
            >
              <span className="loading-building">
                <i />
                <b />
                <em />
              </span>
              <span className="loading-character" />
              <p>Waking up the office…</p>
            </div>
          ) : (
            <section className="empty-world source-empty">
              <div className="disconnected-island" aria-hidden="true">
                <i />
                <b />
              </div>
              <h1>Local view unavailable</h1>
              <p>
                Coffice will reconnect automatically. Confirm Codex is installed
                for this local account and restart Coffice if the source stays
                unavailable. Coffice has not changed Codex data.
              </p>
            </section>
          )
        ) : project ? (
          <Office
            project={project}
            projects={feed.snapshot.projects}
            onExit={showCampus}
            onEnterProject={setProjectId}
            referenceTime={referenceTime}
            projectCountsById={projectCountsById}
            review={review}
            attentionProjection={attentionProjection}
            requestedReviewTask={requestedReviewTask}
            requestedPlanTarget={requestedPlanTarget}
            requestedPlanProjectId={requestedPlanProjectId}
            onOpenReviewTask={openReviewTask}
            onReviewRequestHandled={handleReviewRequest}
            onPlanRequestHandled={handlePlanRequest}
            workspace={workspace}
            codexActions={codexActions}
            verifications={verifications}
          />
        ) : (
          <Campus
            projects={feed.snapshot.projects}
            onEnter={setProjectId}
            referenceTime={referenceTime}
            projectCountsById={projectCountsById}
            workspace={workspace}
            review={review}
            attentionProjection={attentionProjection}
            digestSourceState={digestSourceState}
            onOpenReviewTask={openReviewTask}
            onOpenStoredResult={openStoredResult}
            onOpenProjectPlan={openProjectPlan}
            desktopAlerts={desktopAlerts}
          />
        )}
      </div>

      <footer className="app-footer">
        <span data-workspace-state={workspacePersistence.state}>
          <i aria-hidden="true" /> {workspacePersistence.label}
        </span>
        <span>·</span>
        <span>Codex metadata stays read only</span>
        <span>·</span>
        <span>Prompts and responses stay private</span>
      </footer>
    </main>
  );
}
