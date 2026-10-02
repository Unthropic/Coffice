"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import {
  MAX_DEFINITION_OF_DONE_ENTRIES,
  MAX_DEFINITION_OF_DONE_ENTRY_LENGTH,
  MAX_DEFINITION_OF_DONE_TOTAL_LENGTH,
  MAX_PROJECT_RULES_ENTRIES,
  MAX_PROJECT_RULE_ENTRY_LENGTH,
  MAX_PROJECT_RULES_TOTAL_LENGTH,
  PROJECT_QUALITY_BAR_PROFILE_IDS,
  PROJECT_CONTEXT_CONCERNS,
  type CofficeWorkspace,
  type Objective,
  type ProjectQualityBar,
  type ProjectQualityBarProfileId,
  type ProjectContextConcern,
  type ProjectReviewSchedule,
  type WorkItem,
  type WorkItemRelationship,
  type WorkItemRelationshipKind,
  type WorkspaceProject,
  type VerificationTarget,
} from "../lib/coffice-workspace";
import { PROJECT_QUALITY_BAR_LABELS } from "../lib/project-quality-bars";
import { DecisionRequestsCard } from "./decision-requests";
import { ReviewAssessmentCard } from "./review-assessment";
import { ProjectDecisionLog } from "./project-decision-log";
import {
  selectOpenTaskWorkContext,
  type TaskWorkContext,
} from "./task-work-context";
export {
  selectLatestClosedTaskWorkContext,
  selectOpenTaskWorkContext,
  selectTaskWorkContexts,
  type TaskWorkContext,
} from "./task-work-context";
import type { CofficeWorkspaceController } from "./use-coffice-workspace";
import { useDialogKeyboard } from "./review-workspace";
import styles from "./work-planner.module.css";

export interface PlannerProject {
  id: string;
  name: string;
  holding?: boolean;
  liveTaskIds?: readonly string[];
  liveTaskLocations?: ReadonlyMap<string, string>;
}

export function selectWorkspaceProject(
  workspace: CofficeWorkspace | null,
  projectId: string,
): WorkspaceProject | null {
  return (
    workspace?.projects.find((project) => project.id === projectId) ?? null
  );
}

export function selectActiveObjective(
  project: WorkspaceProject | null,
): Objective | null {
  return (
    project?.objectives.find((objective) => objective.status === "active") ??
    null
  );
}

export function selectTaskWorkContext(
  workspace: CofficeWorkspace | null,
  projectId: string,
  taskId: string,
): TaskWorkContext | null {
  const context = selectOpenTaskWorkContext(workspace, taskId);
  return context?.project.id === projectId ? context : null;
}

function newId(prefix: string): string {
  const suffix =
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${suffix}`;
}

function now(): string {
  return new Date().toISOString();
}

interface DefinitionOfDoneRow {
  key: string;
  text: string;
}

interface DefinitionOfDoneDraft {
  projectId: string;
  objectiveId: string;
  workItemId: string;
  openedFingerprint: string;
  rows: DefinitionOfDoneRow[];
  confirmingClear: boolean;
  confirmingReload: boolean;
  message: string | null;
}

interface ProjectRuleRow {
  key: string;
  text: string;
}

interface ProjectRulesDraft {
  projectId: string;
  openedFingerprint: string;
  rows: ProjectRuleRow[];
  confirmingClear: boolean;
  confirmingReload: boolean;
  conflictLocked: boolean;
  message: string | null;
}

interface ProjectQualityBarsDraft {
  projectId: string;
  openedFingerprint: string;
  selectedProfileIds: ProjectQualityBarProfileId[];
  confirmingClear: boolean;
  confirmingReload: boolean;
  conflictLocked: boolean;
  message: string | null;
}

interface ProjectContextReviewDraft {
  openedFingerprint: string;
  concerns: ProjectContextConcern[];
  note: string;
  confirmingClear: boolean;
  conflictLocked: boolean;
  message: string | null;
}

interface ProjectReviewScheduleDraft {
  openedFingerprint: string;
  nextReviewLocal: string;
  repeatEnabled: boolean;
  repeatEveryDays: string;
  mode: "edit" | "confirm-complete" | "confirm-clear";
  conflictLocked: boolean;
  message: string | null;
}

interface WorkItemRelationshipRow {
  key: string;
  kind: WorkItemRelationshipKind;
  targetKey: string;
}

interface WorkItemRelationshipsDraft {
  openedFingerprint: string;
  rows: WorkItemRelationshipRow[];
  confirmingClear: boolean;
  conflictLocked: boolean;
  message: string | null;
}

function definitionOfDoneFingerprint(entries: readonly string[] | undefined) {
  return JSON.stringify(entries ?? []);
}

function definitionOfDoneRows(
  entries: readonly string[] | undefined,
): DefinitionOfDoneRow[] {
  return (entries ?? []).map((text) => ({
    key: newId("criterion-row"),
    text,
  }));
}

function normalizedDefinitionOfDone(rows: readonly DefinitionOfDoneRow[]): {
  entries?: string[];
  error?: string;
} {
  const entries = rows.map((row) =>
    row.text.replace(/\r\n?|\n/gu, "\n").trim(),
  );
  if (entries.some((entry) => !entry)) {
    return { error: "Enter criterion text or remove the empty row." };
  }
  if (entries.length > MAX_DEFINITION_OF_DONE_ENTRIES) {
    return { error: "This Definition of Done is too large to save safely." };
  }
  if (
    entries.some((entry) => entry.length > MAX_DEFINITION_OF_DONE_ENTRY_LENGTH)
  ) {
    return { error: "One criterion is too long to save safely." };
  }
  if (
    entries.reduce((total, entry) => total + entry.length, 0) >
    MAX_DEFINITION_OF_DONE_TOTAL_LENGTH
  ) {
    return { error: "This Definition of Done is too large to save safely." };
  }
  return { entries };
}

function projectRulesFingerprint(project: WorkspaceProject | null): string {
  return project ? `present:${JSON.stringify(project.rules ?? [])}` : "missing";
}

function projectQualityBarsFingerprint(
  project: WorkspaceProject | null,
): string {
  return project
    ? `present:${JSON.stringify(project.qualityBars ?? [])}`
    : "missing";
}

function projectContextReviewFingerprint(
  project: WorkspaceProject | null,
): string {
  return project
    ? `present:${JSON.stringify(project.contextReview ?? null)}`
    : "missing";
}

function projectReviewScheduleFingerprint(
  project: WorkspaceProject | null,
): string {
  return project
    ? `present:${JSON.stringify(project.reviewSchedule ?? null)}`
    : "missing";
}

function localDateTimeValue(value: string | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function projectReviewScheduleSummary(schedule: ProjectReviewSchedule): string {
  return schedule.repeatEveryDays
    ? `Repeats every ${schedule.repeatEveryDays} ${schedule.repeatEveryDays === 1 ? "day" : "days"}`
    : "One-time review";
}

function projectQualityBars(
  profileIds: readonly ProjectQualityBarProfileId[],
): ProjectQualityBar[] {
  const selected = new Set(profileIds);
  return PROJECT_QUALITY_BAR_PROFILE_IDS.filter((profileId) =>
    selected.has(profileId),
  ).map((profileId) => ({ profileId, profileVersion: "1" }));
}

function workItemRelationshipsFingerprint(
  relationships: readonly WorkItemRelationship[] | undefined,
): string {
  return JSON.stringify(relationships ?? []);
}

function workItemRelationshipTargetKey(
  objectiveId: string,
  workItemId: string,
): string {
  return JSON.stringify([objectiveId, workItemId]);
}

function parseWorkItemRelationshipTargetKey(value: string): {
  objectiveId: string;
  workItemId: string;
} | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) &&
      parsed.length === 2 &&
      parsed.every((entry) => typeof entry === "string")
      ? { objectiveId: parsed[0], workItemId: parsed[1] }
      : null;
  } catch {
    return null;
  }
}

function projectRuleRows(
  entries: readonly string[] | undefined,
): ProjectRuleRow[] {
  return (entries ?? []).map((text) => ({
    key: newId("project-rule-row"),
    text,
  }));
}

function normalizedProjectRules(rows: readonly ProjectRuleRow[]): {
  entries?: string[];
  error?: string;
} {
  const entries = rows.map((row) =>
    row.text.replace(/\r\n?|\n/gu, "\n").trim(),
  );
  if (entries.some((entry) => !entry)) {
    return { error: "Enter rule text or remove the empty row." };
  }
  if (entries.length > MAX_PROJECT_RULES_ENTRIES) {
    return { error: "These project rules are too large to save safely." };
  }
  if (entries.some((entry) => entry.length > MAX_PROJECT_RULE_ENTRY_LENGTH)) {
    return { error: "One project rule is too long to save safely." };
  }
  if (
    entries.reduce((total, entry) => total + entry.length, 0) >
    MAX_PROJECT_RULES_TOTAL_LENGTH
  ) {
    return { error: "These project rules are too large to save safely." };
  }
  return { entries };
}

function itemStateLabel(item: WorkItem): string {
  switch (item.status) {
    case "in_progress":
      return "In progress";
    case "ready_for_review":
      return "Ready for review";
    case "accepted":
      return "Accepted";
    default:
      return item.status
        .replaceAll("_", " ")
        .replace(/^./u, (letter) => letter.toLocaleUpperCase());
  }
}

function verificationProfileLabel(id: string): string {
  const labels: Readonly<Record<string, string>> = {
    test: "Tests",
    typecheck: "Type check",
    lint: "Lint",
    build: "Production build",
  };
  return labels[id] ?? id.replaceAll("-", " ");
}

function verificationFailureLabel(
  failureKind: "exit" | "timeout" | "launch" | undefined,
  exitCode: number | undefined,
): string {
  if (failureKind === "timeout") return "Timed out";
  if (failureKind === "launch") return "Could not start";
  if (failureKind === "exit") {
    return exitCode === undefined
      ? "Failed · project script"
      : `Failed · exit ${exitCode}`;
  }
  return "Failed";
}

function verificationStateLabel(
  state: "queued" | "running" | "passed" | "unknown",
): string {
  if (state === "unknown") return "Outcome unknown";
  return `${state.charAt(0).toUpperCase()}${state.slice(1)}`;
}

function compactTimestamp(value: string): string {
  return `${value.slice(0, 16).replace("T", " ")} UTC`;
}

function verificationTargetIdentity(
  target: VerificationTarget | null | undefined,
): string | null {
  return target
    ? [
        target.projectId,
        target.objectiveId,
        target.workItemId,
        target.attemptId,
        target.resultKey.kind,
        target.resultKey.id,
      ].join("\u001f")
    : null;
}

function WorkItemRelationshipsSection({
  project,
  objective,
  item,
  controller,
  locked,
  onBeginEditing,
  onEditingChange,
}: {
  project: WorkspaceProject;
  objective: Objective;
  item: WorkItem;
  controller: CofficeWorkspaceController;
  locked: boolean;
  onBeginEditing: () => void;
  onEditingChange: (editing: boolean) => void;
}) {
  const [draft, setDraft] = useState<WorkItemRelationshipsDraft | null>(null);
  const [disclosureOpen, setDisclosureOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const conflictRef = useRef<HTMLDivElement>(null);
  const generationRef = useRef(0);
  const currentFingerprint = workItemRelationshipsFingerprint(
    item.relationships,
  );
  const changedElsewhere = Boolean(
    draft &&
    (draft.conflictLocked || draft.openedFingerprint !== currentFingerprint),
  );
  const targetOptions = project.objectives.flatMap((candidateObjective) =>
    candidateObjective.workItems
      .filter(
        (candidate) =>
          candidateObjective.id !== objective.id || candidate.id !== item.id,
      )
      .map((candidate) => ({
        key: workItemRelationshipTargetKey(candidateObjective.id, candidate.id),
        label:
          candidateObjective.id === objective.id
            ? candidate.title
            : `${candidateObjective.title} — ${candidate.title}`,
      })),
  );

  const focusTrigger = () => {
    window.requestAnimationFrame(() =>
      triggerRef.current?.focus({ preventScroll: true }),
    );
  };

  const closeEditor = () => {
    generationRef.current += 1;
    setDraft(null);
    setSaving(false);
    onEditingChange(false);
    focusTrigger();
  };

  const rowsFromCurrent = (): WorkItemRelationshipRow[] =>
    (item.relationships ?? []).map((relationship) => ({
      key: newId("work-link-row"),
      kind: relationship.kind,
      targetKey: workItemRelationshipTargetKey(
        relationship.targetObjectiveId,
        relationship.targetWorkItemId,
      ),
    }));

  const beginEditing = () => {
    if (locked) return;
    onBeginEditing();
    onEditingChange(true);
    setDisclosureOpen(true);
    setStatus("");
    setDraft({
      openedFingerprint: currentFingerprint,
      rows: rowsFromCurrent(),
      confirmingClear: false,
      conflictLocked: false,
      message: null,
    });
    window.requestAnimationFrame(() => addRef.current?.focus());
  };

  const addRow = () => {
    if (!draft || locked || saving || changedElsewhere || !targetOptions[0])
      return;
    setDraft({
      ...draft,
      rows: [
        ...draft.rows,
        {
          key: newId("work-link-row"),
          kind: "depends_on",
          targetKey: targetOptions[0].key,
        },
      ],
      confirmingClear: false,
      message: null,
    });
  };

  const relationshipsFromRows = (
    rows: readonly WorkItemRelationshipRow[],
  ): WorkItemRelationship[] | null => {
    const relationships: WorkItemRelationship[] = [];
    for (const row of rows) {
      const target = parseWorkItemRelationshipTargetKey(row.targetKey);
      if (!target) return null;
      relationships.push({
        kind: row.kind,
        targetObjectiveId: target.objectiveId,
        targetWorkItemId: target.workItemId,
      });
    }
    return relationships;
  };

  const persist = async (relationships: WorkItemRelationship[]) => {
    if (!draft || locked || saving || changedElsewhere) return;
    const generation = ++generationRef.current;
    setSaving(true);
    const result = await controller.mutate({
      type: "workItem.relationships.set",
      projectId: project.id,
      objectiveId: objective.id,
      workItemId: item.id,
      relationships,
    });
    if (generationRef.current !== generation) return;
    setSaving(false);
    if (!result.ok) {
      setDraft((current) =>
        current
          ? {
              ...current,
              confirmingClear: false,
              conflictLocked: result.reason === "conflict",
              message:
                result.reason === "conflict"
                  ? null
                  : "Work links were not saved. Check for duplicate or circular links; your draft was preserved.",
            }
          : current,
      );
      return;
    }
    setDraft(null);
    setStatus(
      relationships.length ? "Work links saved." : "Work links cleared.",
    );
    onEditingChange(false);
    focusTrigger();
  };

  const save = () => {
    if (!draft) return;
    const relationships = relationshipsFromRows(draft.rows);
    if (!relationships) {
      setDraft({ ...draft, message: "Choose a target for every work link." });
      return;
    }
    if (!relationships.length && item.relationships?.length) {
      setDraft({ ...draft, confirmingClear: true, message: null });
      return;
    }
    if (!relationships.length) {
      setDraft({
        ...draft,
        message: "Add a dependency or handoff before saving, or cancel.",
      });
      return;
    }
    void persist(relationships);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape" || !draft || saving) return;
    event.preventDefault();
    event.stopPropagation();
    if (draft.confirmingClear) {
      setDraft({ ...draft, confirmingClear: false });
      window.requestAnimationFrame(() => addRef.current?.focus());
      return;
    }
    closeEditor();
  };

  useEffect(
    () => () => {
      generationRef.current += 1;
    },
    [],
  );

  return (
    <section
      className={styles.workRelationships}
      data-work-item-relationships="true"
      onKeyDown={handleKeyDown}
    >
      {draft ? (
        <fieldset className={styles.relationshipEditor}>
          <legend>Edit work links</legend>
          <p>
            Record advisory dependencies and handoffs. Coffice does not infer
            readiness, change status, or run Codex from these links.
          </p>
          {changedElsewhere ? (
            <div ref={conflictRef} role="alert" tabIndex={-1}>
              <strong>Work links changed elsewhere</strong>
              <p>
                Your draft was preserved. Review it before replacing the latest
                links.
              </p>
              <div className={styles.relationshipActions}>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      openedFingerprint: currentFingerprint,
                      conflictLocked: false,
                      message:
                        "Your preserved draft will replace the latest work links if you save.",
                    })
                  }
                >
                  Use my draft
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() =>
                    setDraft({
                      openedFingerprint: currentFingerprint,
                      rows: rowsFromCurrent(),
                      confirmingClear: false,
                      conflictLocked: false,
                      message: "Latest work links loaded.",
                    })
                  }
                >
                  Load latest links
                </button>
                <button type="button" disabled={saving} onClick={closeEditor}>
                  Cancel
                </button>
              </div>
            </div>
          ) : draft.confirmingClear ? (
            <div role="group" aria-label="Confirm clearing work links">
              <strong>Clear all work links?</strong>
              <p>This does not change work status, saved results, or Codex.</p>
              <div className={styles.relationshipActions}>
                <button
                  type="button"
                  autoFocus
                  disabled={saving}
                  onClick={() => {
                    setDraft({ ...draft, confirmingClear: false });
                    window.requestAnimationFrame(() =>
                      addRef.current?.focus({ preventScroll: true }),
                    );
                  }}
                >
                  Back
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void persist([])}
                >
                  Clear work links
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className={styles.relationshipRows}>
                {draft.rows.map((row, index) => (
                  <div key={row.key} className={styles.relationshipRow}>
                    <label>
                      Link {index + 1}
                      <select
                        value={row.kind}
                        disabled={locked || saving}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            rows: draft.rows.map((candidate) =>
                              candidate.key === row.key
                                ? {
                                    ...candidate,
                                    kind: event.currentTarget
                                      .value as WorkItemRelationshipKind,
                                  }
                                : candidate,
                            ),
                            message: null,
                          })
                        }
                      >
                        <option value="depends_on">Depends on</option>
                        <option value="hands_off_to">Hands off to</option>
                      </select>
                    </label>
                    <label>
                      Target work item
                      <select
                        value={row.targetKey}
                        disabled={locked || saving}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            rows: draft.rows.map((candidate) =>
                              candidate.key === row.key
                                ? {
                                    ...candidate,
                                    targetKey: event.currentTarget.value,
                                  }
                                : candidate,
                            ),
                            message: null,
                          })
                        }
                      >
                        {targetOptions.map((target) => (
                          <option key={target.key} value={target.key}>
                            {target.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      disabled={locked || saving}
                      aria-label={`Remove work link ${index + 1}`}
                      onClick={() =>
                        setDraft({
                          ...draft,
                          rows: draft.rows.filter(
                            (candidate) => candidate.key !== row.key,
                          ),
                          message: null,
                        })
                      }
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
              <div className={styles.relationshipActions}>
                <button
                  ref={addRef}
                  type="button"
                  disabled={locked || saving || !targetOptions.length}
                  onClick={addRow}
                >
                  Add work link
                </button>
                <button
                  type="button"
                  disabled={locked || saving}
                  onClick={save}
                >
                  {saving ? "Saving…" : "Save work links"}
                </button>
                <button type="button" disabled={saving} onClick={closeEditor}>
                  Cancel
                </button>
              </div>
            </>
          )}
          <p role="status" aria-live="polite">
            {draft.message ?? ""}
          </p>
        </fieldset>
      ) : item.relationships?.length ? (
        <details
          open={disclosureOpen}
          onToggle={(event) => setDisclosureOpen(event.currentTarget.open)}
        >
          <summary>Work links · {item.relationships.length}</summary>
          <ol>
            {item.relationships.map((relationship, index) => {
              const target = project.objectives
                .find(
                  (candidate) =>
                    candidate.id === relationship.targetObjectiveId,
                )
                ?.workItems.find(
                  (candidate) => candidate.id === relationship.targetWorkItemId,
                );
              return (
                <li key={`${relationship.kind}-${index}`}>
                  <strong>
                    {relationship.kind === "depends_on"
                      ? "Depends on"
                      : "Hands off to"}
                  </strong>{" "}
                  {target?.title ?? "Unavailable work item"}
                </li>
              );
            })}
          </ol>
          <button
            ref={triggerRef}
            type="button"
            disabled={locked}
            onClick={beginEditing}
          >
            Edit work links
          </button>
        </details>
      ) : (
        <div className={styles.relationshipEmpty}>
          <div>
            <strong>Work links</strong>
            <p>No dependencies or handoffs recorded.</p>
          </div>
          <button
            ref={triggerRef}
            type="button"
            disabled={locked || !targetOptions.length}
            onClick={beginEditing}
          >
            Add work links
          </button>
        </div>
      )}
      <p role="status" aria-live="polite" className={styles.relationshipStatus}>
        {status}
      </p>
    </section>
  );
}

function ProjectContextReviewSection({
  project,
  controller,
  locked,
  onBeginEditing,
  onEditingChange,
}: {
  project: WorkspaceProject;
  controller: CofficeWorkspaceController;
  locked: boolean;
  onBeginEditing: () => void;
  onEditingChange: (editing: boolean) => void;
}) {
  const [draft, setDraft] = useState<ProjectContextReviewDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const firstConcernRef = useRef<HTMLInputElement>(null);
  const conflictRef = useRef<HTMLDivElement>(null);
  const generationRef = useRef(0);
  const currentProject = selectWorkspaceProject(
    controller.workspace,
    project.id,
  );
  const currentFingerprint = projectContextReviewFingerprint(currentProject);
  const changedElsewhere = Boolean(
    draft &&
    (draft.conflictLocked || draft.openedFingerprint !== currentFingerprint),
  );

  const focusTrigger = () => {
    window.requestAnimationFrame(() =>
      triggerRef.current?.focus({ preventScroll: true }),
    );
  };
  const focusFirstConcern = () => {
    window.requestAnimationFrame(() =>
      firstConcernRef.current?.focus({ preventScroll: true }),
    );
  };
  const closeEditor = () => {
    generationRef.current += 1;
    setDraft(null);
    setSaving(false);
    onEditingChange(false);
    focusTrigger();
  };
  const beginEditing = (confirmingClear = false) => {
    if (locked) return;
    onBeginEditing();
    onEditingChange(true);
    setStatus("");
    setDraft({
      openedFingerprint: currentFingerprint,
      concerns: [...(project.contextReview?.concerns ?? [])],
      note: project.contextReview?.note ?? "",
      confirmingClear,
      conflictLocked: false,
      message: null,
    });
    if (!confirmingClear) focusFirstConcern();
  };
  const toggleConcern = (concern: ProjectContextConcern) => {
    if (!draft || locked || saving || changedElsewhere) return;
    const selected = new Set(draft.concerns);
    if (selected.has(concern)) selected.delete(concern);
    else selected.add(concern);
    setDraft({
      ...draft,
      concerns: PROJECT_CONTEXT_CONCERNS.filter((candidate) =>
        selected.has(candidate),
      ),
      message: null,
    });
  };
  const persist = async () => {
    if (!draft || locked || saving || changedElsewhere) return;
    if (!draft.concerns.length) {
      setDraft({
        ...draft,
        message: "Select stale, contradictory, or both before saving.",
      });
      focusFirstConcern();
      return;
    }
    const note = draft.note.replace(/\r\n?/gu, "\n").trim();
    if (note.length > 2_000) {
      setDraft({
        ...draft,
        message: "The context note is too long to save safely.",
      });
      return;
    }
    const generation = ++generationRef.current;
    setSaving(true);
    const result = await controller.mutate({
      type: "project.contextReview.set",
      projectId: project.id,
      concerns: draft.concerns,
      ...(note ? { note } : {}),
    });
    if (generationRef.current !== generation) return;
    setSaving(false);
    if (!result.ok) {
      setDraft((current) =>
        current
          ? {
              ...current,
              conflictLocked: result.reason === "conflict",
              message:
                result.reason === "conflict"
                  ? null
                  : "The context flag was not saved. Your draft was preserved.",
            }
          : current,
      );
      return;
    }
    setDraft(null);
    setStatus("Project context flagged for review.");
    onEditingChange(false);
    focusTrigger();
  };
  const clear = async () => {
    if (!draft || locked || saving || changedElsewhere) return;
    const generation = ++generationRef.current;
    setSaving(true);
    const result = await controller.mutate({
      type: "project.contextReview.clear",
      projectId: project.id,
    });
    if (generationRef.current !== generation) return;
    setSaving(false);
    if (!result.ok) {
      setDraft((current) =>
        current
          ? {
              ...current,
              confirmingClear: false,
              conflictLocked: result.reason === "conflict",
              message:
                result.reason === "conflict"
                  ? null
                  : "The context flag was not cleared.",
            }
          : current,
      );
      return;
    }
    setDraft(null);
    setStatus("Project context marked reviewed.");
    onEditingChange(false);
    focusTrigger();
  };
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape" || !draft || saving) return;
    event.preventDefault();
    event.stopPropagation();
    if (draft.confirmingClear) {
      setDraft({ ...draft, confirmingClear: false });
      focusFirstConcern();
      return;
    }
    closeEditor();
  };

  useEffect(
    () => () => {
      generationRef.current += 1;
    },
    [],
  );

  return (
    <section
      className={styles.projectContextReview}
      data-project-context-review="true"
      onKeyDown={handleKeyDown}
    >
      <div className={styles.projectRulesTopline}>
        <div>
          <span>Trust check</span>
          <h3>Context review</h3>
        </div>
        <span>
          {draft
            ? "Editing flag"
            : project.contextReview
              ? "Flagged"
              : "Current"}
        </span>
      </div>
      <p className={styles.projectRulesHelper}>
        Flag current project context only when you know it needs review. Coffice
        never guesses staleness or contradiction.
      </p>
      {draft ? (
        <div className={styles.contextReviewEditor}>
          {changedElsewhere ? (
            <div ref={conflictRef} role="alert" tabIndex={-1}>
              <strong>Context flag changed elsewhere</strong>
              <p>Your draft was preserved.</p>
              <div className={styles.contextReviewActions}>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => {
                    setDraft({
                      ...draft,
                      openedFingerprint: currentFingerprint,
                      conflictLocked: false,
                      message:
                        "Your draft will replace the latest context flag if you save.",
                    });
                    focusFirstConcern();
                  }}
                >
                  Use my draft
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => {
                    setDraft({
                      openedFingerprint: currentFingerprint,
                      concerns: [
                        ...(currentProject?.contextReview?.concerns ?? []),
                      ],
                      note: currentProject?.contextReview?.note ?? "",
                      confirmingClear: false,
                      conflictLocked: false,
                      message: "Latest context flag loaded.",
                    });
                    focusFirstConcern();
                  }}
                >
                  Load latest flag
                </button>
                <button type="button" disabled={saving} onClick={closeEditor}>
                  Cancel
                </button>
              </div>
            </div>
          ) : draft.confirmingClear ? (
            <div role="group" aria-label="Confirm context reviewed">
              <strong>Mark current context reviewed?</strong>
              <p>
                This clears the user-declared flag. It does not rewrite project
                rules, decisions, milestones, or Codex work.
              </p>
              <div className={styles.contextReviewActions}>
                <button
                  type="button"
                  autoFocus
                  disabled={saving}
                  onClick={() => {
                    setDraft({ ...draft, confirmingClear: false });
                    focusFirstConcern();
                  }}
                >
                  Back
                </button>
                <button
                  type="button"
                  disabled={locked || saving}
                  onClick={() => void clear()}
                >
                  Mark reviewed
                </button>
              </div>
            </div>
          ) : (
            <>
              <fieldset
                className={styles.contextConcernOptions}
                disabled={locked || saving}
              >
                <legend>Known concern</legend>
                {PROJECT_CONTEXT_CONCERNS.map((concern, index) => (
                  <label key={concern}>
                    <input
                      ref={index === 0 ? firstConcernRef : undefined}
                      type="checkbox"
                      checked={draft.concerns.includes(concern)}
                      onChange={() => toggleConcern(concern)}
                    />
                    <span>
                      {concern === "stale" ? "Stale" : "Contradictory"}
                    </span>
                  </label>
                ))}
              </fieldset>
              <label className={styles.contextReviewNote}>
                Review note <span>optional</span>
                <textarea
                  rows={3}
                  value={draft.note}
                  disabled={locked || saving}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      note: event.currentTarget.value,
                      message: null,
                    })
                  }
                />
              </label>
              <div className={styles.contextReviewActions}>
                <button
                  type="button"
                  disabled={locked || saving}
                  onClick={() => void persist()}
                >
                  {saving ? "Saving…" : "Save context flag"}
                </button>
                <button type="button" disabled={saving} onClick={closeEditor}>
                  Cancel
                </button>
              </div>
            </>
          )}
          <p role="status" aria-live="polite">
            {draft.message ?? ""}
          </p>
        </div>
      ) : project.contextReview ? (
        <div className={styles.contextReviewFlag} role="status">
          <div>
            <strong>
              Needs context review ·{" "}
              {project.contextReview.concerns
                .map((concern) =>
                  concern === "stale" ? "Stale" : "Contradictory",
                )
                .join(" + ")}
            </strong>
            {project.contextReview.note ? (
              <p>{project.contextReview.note}</p>
            ) : null}
            <small>
              Flagged {compactTimestamp(project.contextReview.markedAt)} by you.
            </small>
          </div>
          <div className={styles.contextReviewActions}>
            <button
              ref={triggerRef}
              type="button"
              disabled={locked}
              onClick={() => beginEditing()}
            >
              Edit flag
            </button>
            <button
              type="button"
              disabled={locked}
              onClick={() => beginEditing(true)}
            >
              Mark context reviewed
            </button>
          </div>
        </div>
      ) : (
        <div className={styles.projectRulesEmpty}>
          <div>
            <strong>No context concerns flagged.</strong>
          </div>
          <button
            ref={triggerRef}
            type="button"
            disabled={locked}
            onClick={() => beginEditing()}
          >
            Flag context
          </button>
        </div>
      )}
      <p className={styles.projectRulesStatus} role="status" aria-live="polite">
        {status}
      </p>
    </section>
  );
}

function ProjectReviewScheduleSection({
  project,
  workspaceProject,
  controller,
  locked,
  onBeginEditing,
  onEditingChange,
}: {
  project: PlannerProject;
  workspaceProject: WorkspaceProject | null;
  controller: CofficeWorkspaceController;
  locked: boolean;
  onBeginEditing: () => void;
  onEditingChange: (editing: boolean) => void;
}) {
  const [draft, setDraft] = useState<ProjectReviewScheduleDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dueRef = useRef<HTMLInputElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  const generationRef = useRef(0);
  const currentProject = selectWorkspaceProject(
    controller.workspace,
    project.id,
  );
  const currentFingerprint = projectReviewScheduleFingerprint(currentProject);
  const changedElsewhere = Boolean(
    draft &&
    (draft.conflictLocked || draft.openedFingerprint !== currentFingerprint),
  );
  const removedWhileEditing = Boolean(
    draft?.openedFingerprint.startsWith("present:") && !currentProject,
  );

  const focusTrigger = () => {
    window.requestAnimationFrame(() =>
      triggerRef.current?.focus({ preventScroll: true }),
    );
  };
  const focusDue = () => {
    window.requestAnimationFrame(() =>
      dueRef.current?.focus({ preventScroll: true }),
    );
  };
  const close = () => {
    generationRef.current += 1;
    setDraft(null);
    setSaving(false);
    onEditingChange(false);
    focusTrigger();
  };
  const draftFrom = (
    candidate: WorkspaceProject | null,
  ): ProjectReviewScheduleDraft => ({
    openedFingerprint: projectReviewScheduleFingerprint(candidate),
    nextReviewLocal: localDateTimeValue(
      candidate?.reviewSchedule?.nextReviewAt,
    ),
    repeatEnabled: Boolean(candidate?.reviewSchedule?.repeatEveryDays),
    repeatEveryDays: candidate?.reviewSchedule?.repeatEveryDays
      ? String(candidate.reviewSchedule.repeatEveryDays)
      : "7",
    mode: "edit",
    conflictLocked: false,
    message: null,
  });
  const begin = (mode: ProjectReviewScheduleDraft["mode"] = "edit") => {
    if (locked) return;
    onBeginEditing();
    onEditingChange(true);
    setStatus("");
    setDraft({ ...draftFrom(currentProject), mode });
    if (mode === "edit") focusDue();
  };
  const persist = async () => {
    if (!draft || locked || saving || changedElsewhere) return;
    const due = new Date(draft.nextReviewLocal);
    if (!draft.nextReviewLocal || !Number.isFinite(due.getTime())) {
      setDraft({
        ...draft,
        message: "Choose a valid next review date and time.",
      });
      focusDue();
      return;
    }
    const repeatEveryDays = Number(draft.repeatEveryDays);
    if (
      draft.repeatEnabled &&
      (!Number.isSafeInteger(repeatEveryDays) ||
        repeatEveryDays < 1 ||
        repeatEveryDays > 3_650)
    ) {
      setDraft({
        ...draft,
        message: "Enter a whole repeat interval from 1 to 3650 days.",
      });
      return;
    }
    if (
      projectReviewScheduleFingerprint(currentProject) !==
      draft.openedFingerprint
    ) {
      setDraft({ ...draft, conflictLocked: true, message: null });
      window.requestAnimationFrame(() => alertRef.current?.focus());
      return;
    }
    const generation = ++generationRef.current;
    setSaving(true);
    const nextReviewAt = due.toISOString();
    const now = new Date().toISOString();
    const result = currentProject
      ? await controller.mutate({
          type: "project.reviewSchedule.set",
          projectId: project.id,
          nextReviewAt,
          ...(draft.repeatEnabled ? { repeatEveryDays } : {}),
        })
      : await controller.mutate({
          type: "project.upsert",
          project: {
            id: project.id,
            title: project.name,
            reviewSchedule: {
              nextReviewAt,
              ...(draft.repeatEnabled ? { repeatEveryDays } : {}),
              configuredAt: now,
              authorship: "user",
            },
            createdAt: now,
            updatedAt: now,
            objectives: [],
          },
        });
    if (generationRef.current !== generation) return;
    setSaving(false);
    if (!result.ok) {
      setDraft((current) =>
        current
          ? {
              ...current,
              conflictLocked: result.reason === "conflict",
              message:
                result.reason === "conflict"
                  ? null
                  : "The review schedule was not saved. Your draft was preserved.",
            }
          : current,
      );
      return;
    }
    setDraft(null);
    setStatus("Project review scheduled.");
    onEditingChange(false);
    focusTrigger();
  };
  const complete = async () => {
    if (
      !draft ||
      locked ||
      saving ||
      changedElsewhere ||
      !currentProject?.reviewSchedule
    )
      return;
    const generation = ++generationRef.current;
    setSaving(true);
    const result = await controller.mutate({
      type: "project.reviewSchedule.complete",
      projectId: project.id,
    });
    if (generationRef.current !== generation) return;
    setSaving(false);
    if (!result.ok) {
      setDraft((current) =>
        current
          ? {
              ...current,
              mode: "edit",
              conflictLocked: result.reason === "conflict",
              message:
                result.reason === "conflict"
                  ? null
                  : "The completed review was not saved.",
            }
          : current,
      );
      return;
    }
    setDraft(null);
    setStatus(
      currentProject.reviewSchedule.repeatEveryDays
        ? "Project reviewed. The next reminder was scheduled."
        : "Project reviewed. The one-time reminder was cleared.",
    );
    onEditingChange(false);
    focusTrigger();
  };
  const clear = async () => {
    if (
      !draft ||
      locked ||
      saving ||
      changedElsewhere ||
      !currentProject?.reviewSchedule
    )
      return;
    const generation = ++generationRef.current;
    setSaving(true);
    const result = await controller.mutate({
      type: "project.reviewSchedule.clear",
      projectId: project.id,
    });
    if (generationRef.current !== generation) return;
    setSaving(false);
    if (!result.ok) {
      setDraft((current) =>
        current
          ? {
              ...current,
              mode: "edit",
              conflictLocked: result.reason === "conflict",
              message:
                result.reason === "conflict"
                  ? null
                  : "The review schedule was not removed.",
            }
          : current,
      );
      return;
    }
    setDraft(null);
    setStatus("Project review schedule removed.");
    onEditingChange(false);
    focusTrigger();
  };
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape" || !draft || saving) return;
    event.preventDefault();
    event.stopPropagation();
    if (draft.mode !== "edit") {
      setDraft({ ...draft, mode: "edit" });
      focusDue();
      return;
    }
    close();
  };

  useEffect(
    () => () => {
      generationRef.current += 1;
    },
    [],
  );

  const schedule = workspaceProject?.reviewSchedule;
  return (
    <section
      className={styles.projectReviewSchedule}
      data-project-review-schedule="true"
      onKeyDown={handleKeyDown}
    >
      <div className={styles.projectRulesTopline}>
        <div>
          <span>Reminder</span>
          <h3>Scheduled review</h3>
        </div>
        <span>{draft ? "Editing" : schedule ? "Scheduled" : "Off"}</span>
      </div>
      <p className={styles.projectRulesHelper}>
        Choose when Coffice should remind you to review this project. Checks
        remain manual and never run on a timer.
      </p>
      {draft ? (
        <div className={styles.reviewScheduleEditor}>
          {changedElsewhere ? (
            <div ref={alertRef} role="alert" tabIndex={-1}>
              <strong>
                {removedWhileEditing
                  ? "This saved project was removed elsewhere"
                  : draft.openedFingerprint === currentFingerprint
                    ? "Workspace changed elsewhere"
                    : "Review schedule changed elsewhere"}
              </strong>
              <p>Your schedule draft was preserved.</p>
              {removedWhileEditing ? (
                <>
                  <p>
                    Next review: {draft.nextReviewLocal || "Not selected"}
                    {draft.repeatEnabled
                      ? ` · every ${draft.repeatEveryDays} days`
                      : " · one time"}
                  </p>
                  <button type="button" disabled={saving} onClick={close}>
                    Cancel
                  </button>
                </>
              ) : (
                <div className={styles.reviewScheduleActions}>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => {
                      setDraft({
                        ...draft,
                        openedFingerprint: currentFingerprint,
                        conflictLocked: false,
                        message:
                          "Your draft will replace the latest schedule if you save.",
                      });
                      focusDue();
                    }}
                  >
                    Use my draft
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => {
                      setDraft({
                        ...draftFrom(currentProject),
                        message: "Latest schedule loaded.",
                      });
                      focusDue();
                    }}
                  >
                    Load latest schedule
                  </button>
                  <button type="button" disabled={saving} onClick={close}>
                    Cancel
                  </button>
                </div>
              )}
            </div>
          ) : draft.mode === "confirm-complete" ? (
            <div role="group" aria-label="Confirm project review complete">
              <strong>Mark this project reviewed?</strong>
              <p>
                {schedule?.repeatEveryDays
                  ? "Coffice will schedule the next reminder from today."
                  : "This clears the one-time reminder."}{" "}
                No quality check runs automatically.
              </p>
              <div className={styles.reviewScheduleActions}>
                <button
                  type="button"
                  autoFocus
                  disabled={saving}
                  onClick={() => {
                    setDraft({ ...draft, mode: "edit" });
                    focusDue();
                  }}
                >
                  Back
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void complete()}
                >
                  {saving ? "Saving…" : "Mark project reviewed"}
                </button>
              </div>
            </div>
          ) : draft.mode === "confirm-clear" ? (
            <div role="group" aria-label="Confirm remove review schedule">
              <strong>Remove the review schedule?</strong>
              <p>
                This removes the reminder only. It does not change project work
                or checks.
              </p>
              <div className={styles.reviewScheduleActions}>
                <button
                  type="button"
                  autoFocus
                  disabled={saving}
                  onClick={() => {
                    setDraft({ ...draft, mode: "edit" });
                    focusDue();
                  }}
                >
                  Back
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void clear()}
                >
                  {saving ? "Removing…" : "Remove schedule"}
                </button>
              </div>
            </div>
          ) : (
            <>
              <label>
                Next review <span>your local time</span>
                <input
                  ref={dueRef}
                  type="datetime-local"
                  value={draft.nextReviewLocal}
                  disabled={locked || saving}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      nextReviewLocal: event.currentTarget.value,
                      message: null,
                    })
                  }
                />
              </label>
              <label className={styles.reviewScheduleRepeatToggle}>
                <input
                  type="checkbox"
                  checked={draft.repeatEnabled}
                  disabled={locked || saving}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      repeatEnabled: event.currentTarget.checked,
                      message: null,
                    })
                  }
                />
                Repeat after each completed review
              </label>
              {draft.repeatEnabled ? (
                <label>
                  Repeat every <span>days</span>
                  <input
                    type="number"
                    min={1}
                    max={3_650}
                    step={1}
                    value={draft.repeatEveryDays}
                    disabled={locked || saving}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        repeatEveryDays: event.currentTarget.value,
                        message: null,
                      })
                    }
                  />
                </label>
              ) : null}
              <div className={styles.reviewScheduleActions}>
                <button
                  type="button"
                  disabled={locked || saving}
                  onClick={() => void persist()}
                >
                  {saving ? "Saving…" : "Save schedule"}
                </button>
                {schedule ? (
                  <>
                    <button
                      type="button"
                      disabled={locked || saving}
                      onClick={() =>
                        setDraft({ ...draft, mode: "confirm-complete" })
                      }
                    >
                      Mark reviewed
                    </button>
                    <button
                      type="button"
                      disabled={locked || saving}
                      onClick={() =>
                        setDraft({ ...draft, mode: "confirm-clear" })
                      }
                    >
                      Remove schedule
                    </button>
                  </>
                ) : null}
                <button type="button" disabled={saving} onClick={close}>
                  Cancel
                </button>
              </div>
            </>
          )}
          <p role="status" aria-live="polite">
            {draft.message ?? ""}
          </p>
        </div>
      ) : schedule ? (
        <div className={styles.reviewScheduleRead}>
          <div>
            <strong>
              Next review · {compactTimestamp(schedule.nextReviewAt)}
            </strong>
            <p>{projectReviewScheduleSummary(schedule)}</p>
            {schedule.lastReviewedAt ? (
              <small>
                Last reviewed {compactTimestamp(schedule.lastReviewedAt)}.
              </small>
            ) : null}
          </div>
          <button
            ref={triggerRef}
            type="button"
            disabled={locked}
            onClick={() => begin()}
          >
            Edit schedule
          </button>
        </div>
      ) : (
        <div className={styles.projectRulesEmpty}>
          <div>
            <strong>No project review scheduled.</strong>
          </div>
          <button
            ref={triggerRef}
            type="button"
            disabled={locked}
            onClick={() => begin()}
          >
            Schedule review
          </button>
        </div>
      )}
      <p className={styles.projectRulesStatus} role="status" aria-live="polite">
        {status}
      </p>
    </section>
  );
}

function ProjectQualityBarsSection({
  project,
  workspaceProject,
  controller,
  parentBusy,
  recoveryLocked,
  onBeginEditing,
  onEditingChange,
}: {
  project: PlannerProject;
  workspaceProject: WorkspaceProject | null;
  controller: CofficeWorkspaceController;
  parentBusy: boolean;
  recoveryLocked: boolean;
  onBeginEditing: () => void;
  onEditingChange: (editing: boolean) => void;
}) {
  const [draft, setDraft] = useState<ProjectQualityBarsDraft | null>(null);
  const [disclosureOpen, setDisclosureOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const conflictRef = useRef<HTMLDivElement>(null);
  const firstOptionRef = useRef<HTMLInputElement>(null);
  const generationRef = useRef(0);
  const currentFingerprint = projectQualityBarsFingerprint(workspaceProject);
  const draftMatchesProject = draft?.projectId === project.id;
  const planRemovedWhileEditing = Boolean(
    draftMatchesProject &&
    draft &&
    draft.openedFingerprint !== "missing" &&
    !workspaceProject,
  );
  const changedElsewhere = Boolean(
    draftMatchesProject &&
    draft &&
    (draft.conflictLocked || draft.openedFingerprint !== currentFingerprint),
  );
  const unsafeReason = recoveryLocked
    ? "Review and acknowledge the recovered workspace before changing quality bars."
    : !controller.persistent
      ? "The local Coffice workspace is unavailable. Quality bars cannot be changed."
      : "";
  const locked =
    !controller.persistent ||
    recoveryLocked ||
    parentBusy ||
    saving ||
    Boolean(project.holding);
  const announcement = changedElsewhere
    ? workspaceProject
      ? draft?.conflictLocked && draft.openedFingerprint === currentFingerprint
        ? "The workspace changed elsewhere. Your quality-bar selection was not overwritten."
        : "Quality bars changed elsewhere. Your selection was not overwritten."
      : "This project plan was removed elsewhere. Your quality-bar selection was not overwritten."
    : unsafeReason || draft?.message || status;
  const bars = workspaceProject?.qualityBars ?? [];

  const focusTrigger = () => {
    window.requestAnimationFrame(() => {
      const trigger = triggerRef.current;
      if (
        trigger?.isConnected &&
        !trigger.disabled &&
        trigger.getClientRects().length > 0
      ) {
        trigger.focus({ preventScroll: true });
      } else {
        document
          .querySelector<HTMLButtonElement>(
            '#work-planner-dialog [aria-label="Close project plan"]',
          )
          ?.focus({ preventScroll: true });
      }
    });
  };

  const focusFirstOption = () => {
    window.requestAnimationFrame(() =>
      firstOptionRef.current?.focus({ preventScroll: true }),
    );
  };

  const closeEditor = () => {
    generationRef.current += 1;
    setDraft(null);
    onEditingChange(false);
    focusTrigger();
  };

  const beginEditing = () => {
    if (locked) return;
    generationRef.current += 1;
    onBeginEditing();
    onEditingChange(true);
    setDisclosureOpen(true);
    setStatus("");
    setDraft({
      projectId: project.id,
      openedFingerprint: currentFingerprint,
      selectedProfileIds: bars.map((bar) => bar.profileId),
      confirmingClear: false,
      confirmingReload: false,
      conflictLocked: false,
      message: null,
    });
    focusFirstOption();
  };

  const toggleProfile = (profileId: ProjectQualityBarProfileId) => {
    setDraft((current) => {
      if (!current || locked || changedElsewhere) return current;
      const selected = new Set(current.selectedProfileIds);
      if (selected.has(profileId)) selected.delete(profileId);
      else selected.add(profileId);
      return {
        ...current,
        selectedProfileIds: PROJECT_QUALITY_BAR_PROFILE_IDS.filter((id) =>
          selected.has(id),
        ),
        confirmingClear: false,
        confirmingReload: false,
        message: null,
      };
    });
  };

  const persistBars = async (qualityBars: ProjectQualityBar[]) => {
    const currentWorkspaceProject = selectWorkspaceProject(
      controller.workspace,
      project.id,
    );
    if (
      !draft ||
      locked ||
      changedElsewhere ||
      draft.openedFingerprint !==
        projectQualityBarsFingerprint(currentWorkspaceProject)
    ) {
      return;
    }
    const generation = ++generationRef.current;
    const projectAtDispatch = currentWorkspaceProject;
    const at = now();
    setSaving(true);
    const result = projectAtDispatch
      ? await controller.mutate({
          type: "project.qualityBars.set",
          projectId: project.id,
          qualityBars,
        })
      : await controller.mutate({
          type: "project.upsert",
          project: {
            id: project.id,
            title: project.name,
            ...(qualityBars.length ? { qualityBars } : {}),
            createdAt: at,
            updatedAt: at,
            objectives: [],
          },
        });
    if (generationRef.current !== generation) return;
    setSaving(false);
    if (!result.ok) {
      setDraft((current) =>
        current
          ? {
              ...current,
              confirmingClear: false,
              confirmingReload: false,
              conflictLocked: result.reason === "conflict",
              message:
                result.reason === "conflict"
                  ? null
                  : "Quality bars were not saved. Your selection was not overwritten.",
            }
          : current,
      );
      window.requestAnimationFrame(() =>
        (result.reason === "conflict"
          ? conflictRef.current
          : statusRef.current
        )?.focus({ preventScroll: true }),
      );
      return;
    }
    setDraft(null);
    setStatus(
      qualityBars.length ? "Quality bars saved." : "Quality bars cleared.",
    );
    onEditingChange(false);
    focusTrigger();
  };

  const saveBars = () => {
    if (!draft || changedElsewhere) return;
    const selected = projectQualityBars(draft.selectedProfileIds);
    if (selected.length === 0 && bars.length) {
      setDraft({
        ...draft,
        confirmingClear: true,
        confirmingReload: false,
        message: null,
      });
      return;
    }
    if (selected.length === 0) {
      setDraft({
        ...draft,
        message:
          "Select at least one quality check before saving, or cancel this editor.",
      });
      focusFirstOption();
      return;
    }
    void persistBars(selected);
  };

  const useDraft = () => {
    if (!draft) return;
    setDraft({
      ...draft,
      openedFingerprint: currentFingerprint,
      confirmingClear: false,
      confirmingReload: false,
      conflictLocked: false,
      message: workspaceProject
        ? "Your preserved selection will replace the latest quality bars if you save. Review it first."
        : "Your preserved selection will create quality bars if you save. Review it first.",
    });
    focusFirstOption();
  };

  const loadLatest = () => {
    if (!draft) return;
    setDraft({
      projectId: project.id,
      openedFingerprint: currentFingerprint,
      selectedProfileIds: bars.map((bar) => bar.profileId),
      confirmingClear: false,
      confirmingReload: false,
      conflictLocked: false,
      message: "Latest quality bars loaded.",
    });
    focusFirstOption();
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape" || !draft) return;
    event.preventDefault();
    event.stopPropagation();
    if (saving) return;
    if (draft.confirmingReload) {
      setDraft({ ...draft, confirmingReload: false });
      window.requestAnimationFrame(() =>
        conflictRef.current?.focus({ preventScroll: true }),
      );
      return;
    }
    if (draft.confirmingClear) {
      setDraft({ ...draft, confirmingClear: false });
      focusFirstOption();
      return;
    }
    closeEditor();
  };

  useEffect(() => {
    if (
      !changedElsewhere ||
      (draft?.confirmingReload && !planRemovedWhileEditing)
    ) {
      return;
    }
    const frame = window.requestAnimationFrame(() =>
      conflictRef.current?.focus({ preventScroll: true }),
    );
    return () => window.cancelAnimationFrame(frame);
  }, [changedElsewhere, draft?.confirmingReload, planRemovedWhileEditing]);

  useEffect(
    () => () => {
      generationRef.current += 1;
    },
    [project.id],
  );

  if (project.holding) return null;

  return (
    <section
      className={styles.projectRules}
      aria-labelledby="project-quality-bars-heading"
      onKeyDown={handleKeyDown}
      data-project-quality-bars="true"
    >
      <div className={styles.projectRulesTopline}>
        <div>
          <span>Project standard</span>
          <h3 id="project-quality-bars-heading">Quality bars</h3>
        </div>
        <span>{draft ? "Editing selection" : `${bars.length} selected`}</span>
      </div>
      <p className={styles.projectRulesHelper}>
        Select the checks expected for every result in this project. Coffice
        summarizes readiness but never runs checks automatically or blocks
        acceptance.
      </p>

      {draft ? (
        <form
          className={styles.projectRulesEditor}
          onSubmit={(event) => {
            event.preventDefault();
            saveBars();
          }}
        >
          {draft.confirmingReload && !planRemovedWhileEditing ? (
            <div
              className={styles.projectRulesConfirmation}
              role="group"
              aria-label="Confirm loading latest quality bars"
            >
              <strong>Load the latest quality bars?</strong>
              <p>
                Loading the latest selection discards your preserved draft. No
                result or verification receipt changes.
              </p>
              <div className={styles.projectRuleActions}>
                <button
                  type="button"
                  autoFocus
                  disabled={saving}
                  onClick={() =>
                    setDraft({ ...draft, confirmingReload: false })
                  }
                >
                  Keep my selection
                </button>
                <button type="button" disabled={saving} onClick={loadLatest}>
                  Load latest quality bars
                </button>
              </div>
            </div>
          ) : changedElsewhere ? (
            <div
              ref={conflictRef}
              className={styles.projectRulesConflict}
              role="alert"
              tabIndex={-1}
            >
              <strong>
                {workspaceProject
                  ? draft.conflictLocked &&
                    draft.openedFingerprint === currentFingerprint
                    ? "Workspace changed elsewhere"
                    : "Quality bars changed elsewhere"
                  : "Project plan removed elsewhere"}
              </strong>
              <p>{announcement}</p>
              {draft.selectedProfileIds.length ? (
                <ol aria-label="Preserved quality-bar selection">
                  {draft.selectedProfileIds.map((profileId) => (
                    <li key={profileId}>
                      {PROJECT_QUALITY_BAR_LABELS[profileId]}
                    </li>
                  ))}
                </ol>
              ) : (
                <p>The preserved selection has no quality bars.</p>
              )}
              <div className={styles.projectRuleActions}>
                {!planRemovedWhileEditing ? (
                  <button type="button" disabled={saving} onClick={useDraft}>
                    Use my selection
                  </button>
                ) : null}
                {!planRemovedWhileEditing ? (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        confirmingReload: true,
                        confirmingClear: false,
                      })
                    }
                  >
                    Review latest quality bars
                  </button>
                ) : null}
                <button type="button" disabled={saving} onClick={closeEditor}>
                  Cancel
                </button>
              </div>
            </div>
          ) : draft.confirmingClear ? (
            <div
              className={styles.projectRulesConfirmation}
              role="group"
              aria-label="Confirm clearing quality bars"
            >
              <strong>Clear all project quality bars?</strong>
              <p>
                This removes the current project standard. Results, receipts,
                work status, and Codex tasks are unchanged.
              </p>
              <div className={styles.projectRuleActions}>
                <button
                  type="button"
                  autoFocus
                  disabled={saving}
                  onClick={() => {
                    setDraft({ ...draft, confirmingClear: false });
                    focusFirstOption();
                  }}
                >
                  Back
                </button>
                <button
                  type="button"
                  disabled={locked}
                  onClick={() => void persistBars([])}
                >
                  Clear quality bars
                </button>
              </div>
            </div>
          ) : (
            <>
              <fieldset className={styles.qualityBarOptions} disabled={locked}>
                <legend>Required checks</legend>
                {PROJECT_QUALITY_BAR_PROFILE_IDS.map((profileId, index) => (
                  <label key={profileId}>
                    <input
                      ref={index === 0 ? firstOptionRef : undefined}
                      type="checkbox"
                      aria-label={PROJECT_QUALITY_BAR_LABELS[profileId]}
                      checked={draft.selectedProfileIds.includes(profileId)}
                      onChange={() => toggleProfile(profileId)}
                    />
                    <span>
                      <strong>{PROJECT_QUALITY_BAR_LABELS[profileId]}</strong>
                      <small>
                        {profileId === "test"
                          ? "The project test profile must pass."
                          : profileId === "typecheck"
                            ? "The project type-check profile must pass."
                            : profileId === "lint"
                              ? "The project lint profile must pass."
                              : "The project production-build profile must pass."}
                      </small>
                    </span>
                  </label>
                ))}
              </fieldset>
              <div className={styles.projectRuleActions}>
                <button type="submit" disabled={locked}>
                  {saving ? "Saving…" : "Save quality bars"}
                </button>
                {bars.length ? (
                  <button
                    type="button"
                    disabled={locked}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        confirmingClear: true,
                        confirmingReload: false,
                        message: null,
                      })
                    }
                  >
                    Clear quality bars
                  </button>
                ) : null}
                <button type="button" disabled={saving} onClick={closeEditor}>
                  Cancel
                </button>
              </div>
            </>
          )}
          {unsafeReason ? (
            <p className={styles.projectRulesLocked} role="note">
              {unsafeReason}
            </p>
          ) : null}
        </form>
      ) : bars.length ? (
        <details
          className={styles.projectRulesRead}
          open={disclosureOpen}
          onToggle={(event) => setDisclosureOpen(event.currentTarget.open)}
        >
          <summary aria-label={`${bars.length} current project quality bars`}>
            Quality bars · {bars.length}
          </summary>
          <ol>
            {bars.map((bar) => (
              <li key={bar.profileId}>
                {PROJECT_QUALITY_BAR_LABELS[bar.profileId]}
              </li>
            ))}
          </ol>
          <button
            ref={triggerRef}
            type="button"
            disabled={locked}
            onClick={beginEditing}
          >
            Edit quality bars
          </button>
        </details>
      ) : (
        <div className={styles.projectRulesEmpty}>
          <div>
            <strong>No quality bars selected.</strong>
            {!workspaceProject ? (
              <small>
                Saving the first selection also creates this project&apos;s
                local Coffice plan.
              </small>
            ) : null}
          </div>
          <button
            ref={triggerRef}
            type="button"
            disabled={locked}
            onClick={beginEditing}
          >
            Set quality bars
          </button>
        </div>
      )}
      <p
        ref={statusRef}
        className={styles.projectRulesStatus}
        role="status"
        aria-live="polite"
        tabIndex={-1}
        data-project-quality-bars-status="true"
      >
        {announcement}
      </p>
    </section>
  );
}

function ProjectRulesSection({
  project,
  workspaceProject,
  controller,
  parentBusy,
  recoveryLocked,
  onBeginEditing,
  onEditingChange,
}: {
  project: PlannerProject;
  workspaceProject: WorkspaceProject | null;
  controller: CofficeWorkspaceController;
  parentBusy: boolean;
  recoveryLocked: boolean;
  onBeginEditing: () => void;
  onEditingChange: (editing: boolean) => void;
}) {
  const [draft, setDraft] = useState<ProjectRulesDraft | null>(null);
  const [disclosureOpen, setDisclosureOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const conflictRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<string, HTMLTextAreaElement>());
  const generationRef = useRef(0);
  const currentFingerprint = projectRulesFingerprint(workspaceProject);
  const draftMatchesProject = draft?.projectId === project.id;
  const planRemovedWhileEditing = Boolean(
    draftMatchesProject &&
    draft &&
    draft.openedFingerprint !== "missing" &&
    !workspaceProject,
  );
  const changedElsewhere = Boolean(
    draftMatchesProject &&
    draft &&
    (draft.conflictLocked || draft.openedFingerprint !== currentFingerprint),
  );
  const unsafeReason = recoveryLocked
    ? "Review and acknowledge the recovered workspace before changing project rules."
    : !controller.persistent
      ? "The local Coffice workspace is unavailable. Project rules cannot be changed."
      : "";
  const locked =
    !controller.persistent ||
    recoveryLocked ||
    parentBusy ||
    saving ||
    Boolean(project.holding);
  const announcement = changedElsewhere
    ? workspaceProject
      ? draft?.conflictLocked && draft.openedFingerprint === currentFingerprint
        ? "The workspace changed elsewhere. Your project-rules draft was not overwritten."
        : "Project rules changed elsewhere. Your draft was not overwritten."
      : "This project plan was removed elsewhere. Your project-rules draft was not overwritten."
    : unsafeReason || draft?.message || status;

  const focusTrigger = () => {
    window.requestAnimationFrame(() => {
      const trigger = triggerRef.current;
      if (
        trigger?.isConnected &&
        !trigger.disabled &&
        trigger.getClientRects().length > 0
      ) {
        trigger.focus({ preventScroll: true });
      } else {
        document
          .querySelector<HTMLButtonElement>(
            '#work-planner-dialog [aria-label="Close project plan"]',
          )
          ?.focus({ preventScroll: true });
      }
    });
  };

  const focusRow = (rowKey: string) => {
    window.requestAnimationFrame(() => {
      rowRefs.current.get(rowKey)?.focus({ preventScroll: true });
    });
  };

  const focusAdd = () => {
    window.requestAnimationFrame(() => {
      addRef.current?.focus({ preventScroll: true });
    });
  };

  const closeEditor = () => {
    generationRef.current += 1;
    setDraft(null);
    onEditingChange(false);
    focusTrigger();
  };

  const beginEditing = () => {
    if (locked) return;
    generationRef.current += 1;
    const rows = projectRuleRows(workspaceProject?.rules);
    onBeginEditing();
    onEditingChange(true);
    setDisclosureOpen(true);
    setStatus("");
    setDraft({
      projectId: project.id,
      openedFingerprint: currentFingerprint,
      rows,
      confirmingClear: false,
      confirmingReload: false,
      conflictLocked: false,
      message: null,
    });
    if (rows[0]) focusRow(rows[0].key);
    else focusAdd();
  };

  const addRow = () => {
    if (!draft || locked || changedElsewhere) return;
    if (draft.rows.length >= MAX_PROJECT_RULES_ENTRIES) {
      setDraft({
        ...draft,
        message: "These project rules are too large to save safely.",
      });
      window.requestAnimationFrame(() =>
        statusRef.current?.focus({ preventScroll: true }),
      );
      return;
    }
    const row = { key: newId("project-rule-row"), text: "" };
    setDraft({
      ...draft,
      rows: [...draft.rows, row],
      confirmingClear: false,
      confirmingReload: false,
      message: null,
    });
    focusRow(row.key);
  };

  const changeRow = (rowKey: string, text: string) => {
    setDraft((current) =>
      current
        ? {
            ...current,
            rows: current.rows.map((row) =>
              row.key === rowKey ? { ...row, text } : row,
            ),
            message: null,
          }
        : current,
    );
  };

  const removeRow = (rowKey: string) => {
    if (!draft || locked || changedElsewhere) return;
    const index = draft.rows.findIndex((row) => row.key === rowKey);
    if (index < 0) return;
    const rows = draft.rows.filter((row) => row.key !== rowKey);
    const nextFocusKey = rows[index]?.key ?? rows.at(-1)?.key;
    setDraft({
      ...draft,
      rows,
      confirmingClear: false,
      confirmingReload: false,
      message: null,
    });
    if (nextFocusKey) focusRow(nextFocusKey);
    else focusAdd();
  };

  const moveRow = (rowKey: string, direction: "earlier" | "later") => {
    if (!draft || locked || changedElsewhere) return;
    const index = draft.rows.findIndex((row) => row.key === rowKey);
    const destination = index + (direction === "earlier" ? -1 : 1);
    if (index < 0 || destination < 0 || destination >= draft.rows.length)
      return;
    const rows = [...draft.rows];
    [rows[index], rows[destination]] = [rows[destination], rows[index]];
    setDraft({
      ...draft,
      rows,
      message: `Moved project rule ${index + 1} to ${destination + 1} of ${rows.length}.`,
    });
    window.requestAnimationFrame(() => {
      const row = [
        ...(document.querySelectorAll<HTMLElement>(
          "[data-project-rule-row-key]",
        ) ?? []),
      ].find((candidate) => candidate.dataset.projectRuleRowKey === rowKey);
      const control = row?.querySelector<HTMLButtonElement>(
        "button[data-project-rule-move]:not(:disabled)",
      );
      (control ?? rowRefs.current.get(rowKey))?.focus({ preventScroll: true });
    });
  };

  const persistRules = async (rules: string[]) => {
    const currentWorkspaceProject = selectWorkspaceProject(
      controller.workspace,
      project.id,
    );
    if (
      !draft ||
      locked ||
      changedElsewhere ||
      draft.openedFingerprint !==
        projectRulesFingerprint(currentWorkspaceProject)
    )
      return;
    const generation = ++generationRef.current;
    const projectAtDispatch = currentWorkspaceProject;
    const at = now();
    setSaving(true);
    const result = projectAtDispatch
      ? await controller.mutate({
          type: "project.rules.set",
          projectId: project.id,
          rules,
        })
      : await controller.mutate({
          type: "project.upsert",
          project: {
            id: project.id,
            title: project.name,
            ...(rules.length ? { rules } : {}),
            createdAt: at,
            updatedAt: at,
            objectives: [],
          },
        });
    if (generationRef.current !== generation) return;
    setSaving(false);
    if (!result.ok) {
      setDraft((current) =>
        current
          ? {
              ...current,
              confirmingClear: false,
              confirmingReload: false,
              conflictLocked: result.reason === "conflict",
              message:
                result.reason === "conflict"
                  ? null
                  : "Project rules were not saved. Your draft was not overwritten.",
            }
          : current,
      );
      window.requestAnimationFrame(() =>
        (result.reason === "conflict"
          ? conflictRef.current
          : statusRef.current
        )?.focus({ preventScroll: true }),
      );
      return;
    }
    setDraft(null);
    setStatus(rules.length ? "Project rules saved." : "Project rules cleared.");
    onEditingChange(false);
    focusTrigger();
  };

  const saveRules = () => {
    if (!draft || changedElsewhere) return;
    const normalized = normalizedProjectRules(draft.rows);
    if (!normalized.entries) {
      setDraft({
        ...draft,
        message: normalized.error ?? "Review the project rules before saving.",
      });
      const invalidRow = draft.rows.find(
        (row) => !row.text.replace(/\r\n?|\n/gu, "\n").trim(),
      );
      if (invalidRow) focusRow(invalidRow.key);
      else
        window.requestAnimationFrame(() =>
          statusRef.current?.focus({ preventScroll: true }),
        );
      return;
    }
    if (normalized.entries.length === 0 && workspaceProject?.rules?.length) {
      setDraft({
        ...draft,
        confirmingClear: true,
        confirmingReload: false,
        message: null,
      });
      return;
    }
    if (normalized.entries.length === 0) {
      setDraft({
        ...draft,
        message: "Add a project rule before saving, or cancel this editor.",
      });
      focusAdd();
      return;
    }
    void persistRules(normalized.entries);
  };

  const useDraft = () => {
    if (!draft) return;
    setDraft({
      ...draft,
      openedFingerprint: currentFingerprint,
      confirmingClear: false,
      confirmingReload: false,
      conflictLocked: false,
      message: workspaceProject
        ? "Your preserved draft will replace the latest rules if you save. Review it first."
        : "Your preserved draft will create current project rules if you save. Review it first.",
    });
    if (draft.rows[0]) focusRow(draft.rows[0].key);
    else focusAdd();
  };

  const loadLatest = () => {
    if (!draft) return;
    const rows = projectRuleRows(workspaceProject?.rules);
    setDraft({
      projectId: project.id,
      openedFingerprint: currentFingerprint,
      rows,
      confirmingClear: false,
      confirmingReload: false,
      conflictLocked: false,
      message: "Latest project rules loaded.",
    });
    if (rows[0]) focusRow(rows[0].key);
    else focusAdd();
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape" || !draft) return;
    event.preventDefault();
    event.stopPropagation();
    if (saving) return;
    if (draft.confirmingReload) {
      setDraft({ ...draft, confirmingReload: false });
      window.requestAnimationFrame(() =>
        conflictRef.current?.focus({ preventScroll: true }),
      );
      return;
    }
    if (draft.confirmingClear) {
      setDraft({ ...draft, confirmingClear: false });
      focusAdd();
      return;
    }
    closeEditor();
  };

  useEffect(() => {
    if (
      !changedElsewhere ||
      (draft?.confirmingReload && !planRemovedWhileEditing)
    )
      return;
    const frame = window.requestAnimationFrame(() =>
      conflictRef.current?.focus({ preventScroll: true }),
    );
    return () => window.cancelAnimationFrame(frame);
  }, [changedElsewhere, draft?.confirmingReload, planRemovedWhileEditing]);

  useEffect(
    () => () => {
      generationRef.current += 1;
    },
    [project.id],
  );

  if (project.holding) return null;

  const rules = workspaceProject?.rules ?? [];
  return (
    <section
      className={styles.projectRules}
      data-project-rules="true"
      onKeyDown={handleKeyDown}
    >
      <div className={styles.projectRulesTopline}>
        <div>
          <span>Project context</span>
          <h3>Project rules</h3>
        </div>
        <span>
          {draft
            ? "Editing draft"
            : rules.length
              ? `${rules.length} current`
              : "Not recorded"}
        </span>
      </div>
      <p className={styles.projectRulesHelper}>
        Current user-authored guidance for this project. Coffice does not
        enforce these rules or treat them as evidence.
      </p>

      {draft ? (
        <form
          className={styles.projectRulesEditor}
          data-project-rules-editor="true"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            saveRules();
          }}
        >
          {changedElsewhere ? (
            draft.confirmingReload && !planRemovedWhileEditing ? (
              <div
                className={styles.projectRulesConfirmation}
                role="group"
                aria-label="Confirm loading latest project rules"
              >
                <strong>Load latest project rules?</strong>
                <p>
                  Loading the latest rules will replace this preserved draft.
                </p>
                <div className={styles.projectRuleActions}>
                  <button
                    type="button"
                    autoFocus
                    onClick={() => {
                      setDraft({ ...draft, confirmingReload: false });
                      window.requestAnimationFrame(() =>
                        conflictRef.current?.focus({ preventScroll: true }),
                      );
                    }}
                  >
                    Keep my draft
                  </button>
                  <button type="button" onClick={loadLatest}>
                    Load latest rules
                  </button>
                </div>
              </div>
            ) : (
              <div
                ref={conflictRef}
                className={styles.projectRulesConflict}
                role="alert"
                tabIndex={-1}
                data-project-rules-orphaned={
                  workspaceProject ? undefined : "true"
                }
              >
                <strong>
                  {workspaceProject
                    ? draft.conflictLocked &&
                      draft.openedFingerprint === currentFingerprint
                      ? "Workspace changed elsewhere"
                      : "Project rules changed elsewhere"
                    : "Project plan changed elsewhere"}
                </strong>
                <p>{announcement}</p>
                {planRemovedWhileEditing ? (
                  draft.rows.length ? (
                    <ol aria-label="Preserved project-rules draft">
                      {draft.rows.map((row) => (
                        <li key={row.key}>
                          {row.text || "Blank project rule"}
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p>The preserved draft has no project rules.</p>
                  )
                ) : null}
                <div className={styles.projectRuleActions}>
                  {!planRemovedWhileEditing ? (
                    <button type="button" disabled={saving} onClick={useDraft}>
                      Use my draft
                    </button>
                  ) : null}
                  {!planRemovedWhileEditing ? (
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() =>
                        setDraft({
                          ...draft,
                          confirmingReload: true,
                          confirmingClear: false,
                        })
                      }
                    >
                      Review latest rules
                    </button>
                  ) : null}
                  <button type="button" disabled={saving} onClick={closeEditor}>
                    Cancel
                  </button>
                </div>
              </div>
            )
          ) : draft.confirmingClear ? (
            <div
              className={styles.projectRulesConfirmation}
              role="group"
              aria-label="Confirm clearing project rules"
            >
              <strong>Clear all current project rules?</strong>
              <p>
                This removes them from the current list. Your project,
                decisions, objectives, work items, and Codex tasks are
                unchanged.
              </p>
              <div className={styles.projectRuleActions}>
                <button
                  type="button"
                  autoFocus
                  disabled={saving}
                  onClick={() => {
                    setDraft({ ...draft, confirmingClear: false });
                    focusAdd();
                  }}
                >
                  Back
                </button>
                <button
                  type="button"
                  disabled={locked}
                  onClick={() => void persistRules([])}
                >
                  Clear rules
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className={styles.projectRuleRows}>
                {draft.rows.map((row, index) => (
                  <div
                    key={row.key}
                    className={styles.projectRuleRow}
                    data-project-rule-row-key={row.key}
                  >
                    <label>
                      Project rule {index + 1}
                      <textarea
                        ref={(element) => {
                          if (element) rowRefs.current.set(row.key, element);
                          else rowRefs.current.delete(row.key);
                        }}
                        value={row.text}
                        maxLength={MAX_PROJECT_RULE_ENTRY_LENGTH}
                        rows={3}
                        required
                        disabled={locked}
                        onChange={(event) =>
                          changeRow(row.key, event.currentTarget.value)
                        }
                      />
                    </label>
                    <div className={styles.projectRuleRowActions}>
                      <button
                        type="button"
                        data-project-rule-move="earlier"
                        disabled={locked || index === 0}
                        aria-label={`Move project rule ${index + 1} up`}
                        onClick={() => moveRow(row.key, "earlier")}
                      >
                        Move up
                      </button>
                      <button
                        type="button"
                        data-project-rule-move="later"
                        disabled={locked || index === draft.rows.length - 1}
                        aria-label={`Move project rule ${index + 1} down`}
                        onClick={() => moveRow(row.key, "later")}
                      >
                        Move down
                      </button>
                      <button
                        type="button"
                        disabled={locked}
                        aria-label={`Remove project rule ${index + 1}`}
                        onClick={() => removeRow(row.key)}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <button
                ref={addRef}
                type="button"
                className={styles.addProjectRule}
                disabled={locked}
                onClick={addRow}
              >
                Add rule
              </button>
              <div className={styles.projectRuleActions}>
                <button type="submit" disabled={locked}>
                  {saving ? "Saving…" : "Save rules"}
                </button>
                {rules.length ? (
                  <button
                    type="button"
                    disabled={locked}
                    onClick={() => {
                      setDraft({
                        ...draft,
                        confirmingClear: true,
                        confirmingReload: false,
                        message: null,
                      });
                    }}
                  >
                    Clear rules
                  </button>
                ) : null}
                <button type="button" disabled={saving} onClick={closeEditor}>
                  Cancel
                </button>
              </div>
            </>
          )}
          {unsafeReason ? (
            <p className={styles.projectRulesLocked} role="note">
              {unsafeReason}
            </p>
          ) : null}
        </form>
      ) : rules.length ? (
        <details
          className={styles.projectRulesRead}
          open={disclosureOpen}
          onToggle={(event) => setDisclosureOpen(event.currentTarget.open)}
        >
          <summary
            aria-label={`${rules.length} current project ${rules.length === 1 ? "rule" : "rules"} for ${project.name}`}
          >
            Project rules · {rules.length}
          </summary>
          <ol>
            {rules.map((rule, index) => (
              <li key={`${index}-${rule}`}>{rule}</li>
            ))}
          </ol>
          <button
            ref={triggerRef}
            type="button"
            disabled={locked}
            onClick={beginEditing}
          >
            Edit rules
          </button>
        </details>
      ) : (
        <div className={styles.projectRulesEmpty}>
          <div>
            <strong>No project rules recorded.</strong>
            {!workspaceProject ? (
              <small>
                Saving the first rule also creates this project&apos;s local
                Coffice plan.
              </small>
            ) : null}
          </div>
          <button
            ref={triggerRef}
            type="button"
            disabled={locked}
            onClick={beginEditing}
          >
            Add project rules
          </button>
        </div>
      )}
      <p
        ref={statusRef}
        className={styles.projectRulesStatus}
        role="status"
        aria-live="polite"
        tabIndex={-1}
        data-project-rules-status="true"
      >
        {announcement}
      </p>
    </section>
  );
}

export function WorkPlannerPanel({
  project,
  controller,
  focusTarget,
  onOpenLiveTask,
  onClose,
}: {
  project: PlannerProject;
  controller: CofficeWorkspaceController;
  focusTarget?: VerificationTarget | null;
  onOpenLiveTask?: (projectId: string, taskId: string) => void;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const storedResultRef = useRef<HTMLElement>(null);
  const focusTargetIdentity = verificationTargetIdentity(focusTarget);
  const workspaceProject = useMemo(
    () => selectWorkspaceProject(controller.workspace, project.id),
    [controller.workspace, project.id],
  );
  const objective = selectActiveObjective(workspaceProject);
  const storedResultContext = useMemo(() => {
    if (
      !focusTarget ||
      focusTarget.projectId !== project.id ||
      !workspaceProject
    )
      return null;
    const targetObjective = workspaceProject.objectives.find(
      (candidate) => candidate.id === focusTarget.objectiveId,
    );
    const workItem = targetObjective?.workItems.find(
      (candidate) => candidate.id === focusTarget.workItemId,
    );
    const attempt = workItem?.attempts.find(
      (candidate) => candidate.id === focusTarget.attemptId,
    );
    const result = attempt?.resultCycles.find(
      (candidate) =>
        candidate.key.kind === focusTarget.resultKey.kind &&
        candidate.key.id === focusTarget.resultKey.id,
    );
    if (!targetObjective || !workItem || !attempt || !result) return null;
    const receipts = (controller.workspace?.verificationReceipts ?? []).filter(
      (receipt) =>
        receipt.target.projectId === focusTarget.projectId &&
        receipt.target.objectiveId === focusTarget.objectiveId &&
        receipt.target.workItemId === focusTarget.workItemId &&
        receipt.target.attemptId === focusTarget.attemptId &&
        receipt.target.resultKey.kind === focusTarget.resultKey.kind &&
        receipt.target.resultKey.id === focusTarget.resultKey.id,
    );
    const latestReceipt = receipts.at(-1) ?? null;
    return {
      objective: targetObjective,
      workItem,
      attempt,
      result,
      resultIndex: attempt.resultCycles.indexOf(result) + 1,
      latestReceipt,
      liveTaskId: project.liveTaskLocations?.has(attempt.codexTaskId)
        ? attempt.codexTaskId
        : project.liveTaskIds?.includes(attempt.codexTaskId)
          ? attempt.codexTaskId
          : null,
      liveTaskProjectId:
        project.liveTaskLocations?.get(attempt.codexTaskId) ??
        (project.liveTaskIds?.includes(attempt.codexTaskId)
          ? project.id
          : null),
    };
  }, [
    controller.workspace,
    focusTarget,
    project.id,
    project.liveTaskIds,
    project.liveTaskLocations,
    workspaceProject,
  ]);
  const [objectiveFormOpen, setObjectiveFormOpen] = useState(false);
  const [workItemFormOpen, setWorkItemFormOpen] = useState(false);
  const [objectiveTitle, setObjectiveTitle] = useState(objective?.title ?? "");
  const [objectiveOutcome, setObjectiveOutcome] = useState(
    objective?.expectedOutcome ?? "",
  );
  const [workItemTitle, setWorkItemTitle] = useState("");
  const [workItemOutcome, setWorkItemOutcome] = useState("");
  const [workItemDefinitionRows, setWorkItemDefinitionRows] = useState<
    DefinitionOfDoneRow[]
  >([]);
  const [definitionDraft, setDefinitionDraft] =
    useState<DefinitionOfDoneDraft | null>(null);
  const [definitionStatus, setDefinitionStatus] = useState<{
    workItemId: string;
    text: string;
  } | null>(null);
  const [openDefinitionDisclosures, setOpenDefinitionDisclosures] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [orderModeOpen, setOrderModeOpen] = useState(false);
  const [rulesEditing, setRulesEditing] = useState(false);
  const [qualityBarsEditing, setQualityBarsEditing] = useState(false);
  const [contextReviewEditing, setContextReviewEditing] = useState(false);
  const [reviewScheduleEditing, setReviewScheduleEditing] = useState(false);
  const [relationshipEditingId, setRelationshipEditingId] = useState<
    string | null
  >(null);
  const orderModeTriggerRef = useRef<HTMLButtonElement>(null);
  const addWorkTriggerRef = useRef<HTMLButtonElement>(null);
  const definitionTriggerRefs = useRef(new Map<string, HTMLButtonElement>());
  const definitionTextareaRefs = useRef(new Map<string, HTMLTextAreaElement>());
  const definitionAddRef = useRef<HTMLButtonElement>(null);
  const creationDefinitionAddRef = useRef<HTMLButtonElement>(null);
  const definitionStatusRef = useRef<HTMLParagraphElement>(null);
  const definitionGenerationRef = useRef(0);
  const recoveryLocked = Boolean(
    controller.recovery?.kind === "backup" && !controller.recoveryAcknowledged,
  );
  const orderLocked =
    !controller.persistent ||
    recoveryLocked ||
    saving ||
    rulesEditing ||
    qualityBarsEditing ||
    contextReviewEditing ||
    reviewScheduleEditing ||
    relationshipEditingId !== null ||
    project.holding;
  const definitionItem = definitionDraft
    ? definitionDraft.projectId === project.id &&
      definitionDraft.objectiveId === objective?.id
      ? (objective.workItems.find(
          (item) => item.id === definitionDraft.workItemId,
        ) ?? null)
      : null
    : null;
  const definitionDraftMatchesProject = Boolean(
    definitionDraft && definitionDraft.projectId === project.id,
  );
  const definitionDraftMatchesContext = Boolean(
    definitionDraft &&
    definitionDraft.projectId === project.id &&
    definitionDraft.objectiveId === objective?.id,
  );
  const definitionChangedElsewhere = Boolean(
    definitionDraftMatchesContext &&
    definitionDraft &&
    (!definitionItem ||
      definitionOfDoneFingerprint(definitionItem.definitionOfDone) !==
        definitionDraft.openedFingerprint),
  );
  const definitionLocked =
    !controller.persistent ||
    recoveryLocked ||
    saving ||
    rulesEditing ||
    qualityBarsEditing ||
    contextReviewEditing ||
    reviewScheduleEditing ||
    relationshipEditingId !== null ||
    project.holding;
  const definitionAnnouncement = definitionChangedElsewhere
    ? definitionItem
      ? "Definition of Done changed elsewhere. Your draft was not overwritten. Load the latest criteria before saving."
      : "This work item was removed elsewhere. Your Definition of Done draft was not overwritten and cannot be saved."
    : (definitionDraft?.message ??
      (workItemFormOpen ? message : null) ??
      definitionStatus?.text ??
      "");

  const closeOrderMode = () => {
    setOrderModeOpen(false);
    setMessage(null);
    window.requestAnimationFrame(() => {
      const trigger = orderModeTriggerRef.current;
      const target =
        trigger?.isConnected && !trigger.disabled
          ? trigger
          : closeButtonRef.current;
      target?.focus({ preventScroll: true });
    });
  };

  const focusDefinitionTrigger = (workItemId: string) => {
    window.requestAnimationFrame(() => {
      const trigger = definitionTriggerRefs.current.get(workItemId);
      const target =
        trigger?.isConnected &&
        !trigger.disabled &&
        trigger.getClientRects().length > 0
          ? trigger
          : closeButtonRef.current;
      target?.focus({ preventScroll: true });
    });
  };

  const closeDefinitionEditor = () => {
    const workItemId = definitionDraft?.workItemId;
    definitionGenerationRef.current += 1;
    setDefinitionDraft(null);
    if (workItemId) focusDefinitionTrigger(workItemId);
  };

  const dismissDefinitionEditor = () => {
    definitionGenerationRef.current += 1;
    setDefinitionDraft(null);
  };

  const focusDefinitionRow = (rowKey: string) => {
    window.requestAnimationFrame(() => {
      definitionTextareaRefs.current
        .get(rowKey)
        ?.focus({ preventScroll: true });
    });
  };

  const openDefinitionEditor = (item: WorkItem) => {
    definitionGenerationRef.current += 1;
    const rows = definitionOfDoneRows(item.definitionOfDone);
    setOpenDefinitionDisclosures((current) => {
      if (current.has(item.id)) return current;
      return new Set([...current, item.id]);
    });
    setOrderModeOpen(false);
    setWorkItemFormOpen(false);
    setObjectiveFormOpen(false);
    setDefinitionStatus(null);
    setDefinitionDraft({
      projectId: project.id,
      objectiveId: objective?.id ?? "",
      workItemId: item.id,
      openedFingerprint: definitionOfDoneFingerprint(item.definitionOfDone),
      rows,
      confirmingClear: false,
      confirmingReload: false,
      message: null,
    });
    if (rows[0]) {
      focusDefinitionRow(rows[0].key);
    } else {
      window.requestAnimationFrame(() =>
        definitionAddRef.current?.focus({ preventScroll: true }),
      );
    }
  };

  const addDefinitionRow = () => {
    if (!definitionDraft || definitionLocked) return;
    if (definitionDraft.rows.length >= MAX_DEFINITION_OF_DONE_ENTRIES) {
      setDefinitionDraft((current) =>
        current
          ? {
              ...current,
              message: "This Definition of Done is too large to save safely.",
            }
          : current,
      );
      return;
    }
    const row = { key: newId("criterion-row"), text: "" };
    setDefinitionDraft((current) =>
      current
        ? {
            ...current,
            rows: [...current.rows, row],
            confirmingClear: false,
            confirmingReload: false,
            message: null,
          }
        : current,
    );
    focusDefinitionRow(row.key);
  };

  const changeDefinitionRow = (rowKey: string, text: string) => {
    setDefinitionDraft((current) =>
      current
        ? {
            ...current,
            rows: current.rows.map((row) =>
              row.key === rowKey ? { ...row, text } : row,
            ),
            message: null,
          }
        : current,
    );
  };

  const removeDefinitionRow = (rowKey: string) => {
    if (!definitionDraft || definitionLocked) return;
    const index = definitionDraft.rows.findIndex((row) => row.key === rowKey);
    if (index < 0) return;
    const rows = definitionDraft.rows.filter((row) => row.key !== rowKey);
    const nextFocusKey = rows[index]?.key ?? rows.at(-1)?.key;
    setDefinitionDraft({
      ...definitionDraft,
      rows,
      confirmingClear: false,
      confirmingReload: false,
      message: null,
    });
    if (nextFocusKey) {
      focusDefinitionRow(nextFocusKey);
    } else {
      window.requestAnimationFrame(() =>
        definitionAddRef.current?.focus({ preventScroll: true }),
      );
    }
  };

  const moveDefinitionRow = (
    rowKey: string,
    direction: "earlier" | "later",
  ) => {
    if (!definitionDraft || definitionLocked) return;
    const index = definitionDraft.rows.findIndex((row) => row.key === rowKey);
    const destination = index + (direction === "earlier" ? -1 : 1);
    if (
      index < 0 ||
      destination < 0 ||
      destination >= definitionDraft.rows.length
    )
      return;
    const rows = [...definitionDraft.rows];
    [rows[index], rows[destination]] = [rows[destination], rows[index]];
    setDefinitionDraft({
      ...definitionDraft,
      rows,
      message: `Moved criterion ${index + 1} to ${destination + 1} of ${rows.length}.`,
    });
    window.requestAnimationFrame(() => {
      const row = panelRef.current?.querySelector<HTMLElement>(
        `[data-definition-row-key="${rowKey}"]`,
      );
      const control = row?.querySelector<HTMLButtonElement>(
        "button[data-definition-move]:not(:disabled)",
      );
      (control ?? definitionTextareaRefs.current.get(rowKey))?.focus({
        preventScroll: true,
      });
    });
  };

  const loadLatestDefinition = () => {
    if (!definitionDraft || !definitionItem) return;
    const rows = definitionOfDoneRows(definitionItem.definitionOfDone);
    setDefinitionDraft({
      projectId: definitionDraft.projectId,
      objectiveId: definitionDraft.objectiveId,
      workItemId: definitionItem.id,
      openedFingerprint: definitionOfDoneFingerprint(
        definitionItem.definitionOfDone,
      ),
      rows,
      confirmingClear: false,
      confirmingReload: false,
      message: null,
    });
    if (rows[0]) focusDefinitionRow(rows[0].key);
    else
      window.requestAnimationFrame(() =>
        definitionAddRef.current?.focus({ preventScroll: true }),
      );
  };

  const persistDefinition = async (definitionOfDone: string[]) => {
    if (
      !objective ||
      !definitionDraft ||
      !definitionDraftMatchesContext ||
      definitionChangedElsewhere ||
      definitionLocked
    )
      return;
    const workItemId = definitionDraft.workItemId;
    const generation = ++definitionGenerationRef.current;
    setSaving(true);
    const result = await controller.mutate({
      type: "workItem.definitionOfDone.set",
      projectId: project.id,
      objectiveId: objective.id,
      workItemId,
      definitionOfDone,
    });
    if (definitionGenerationRef.current !== generation) return;
    setSaving(false);
    if (!result.ok) {
      setDefinitionDraft((current) =>
        current
          ? {
              ...current,
              confirmingClear: false,
              confirmingReload: false,
              message:
                result.reason === "conflict"
                  ? "The workspace changed elsewhere. Your draft was not overwritten. Review the latest plan and save again."
                  : "The Definition of Done was not saved. Your draft was not overwritten.",
            }
          : current,
      );
      window.requestAnimationFrame(() =>
        definitionStatusRef.current?.focus({ preventScroll: true }),
      );
      return;
    }
    setDefinitionDraft(null);
    setDefinitionStatus({
      workItemId,
      text: "Definition of Done saved.",
    });
    focusDefinitionTrigger(workItemId);
  };

  const saveDefinition = () => {
    if (!definitionDraft || definitionChangedElsewhere) return;
    const normalized = normalizedDefinitionOfDone(definitionDraft.rows);
    if (!normalized.entries) {
      setDefinitionDraft({
        ...definitionDraft,
        message: normalized.error ?? "Review the criteria before saving.",
      });
      const invalidRow = definitionDraft.rows.find(
        (row) => !row.text.replace(/\r\n?|\n/gu, "\n").trim(),
      );
      if (invalidRow) focusDefinitionRow(invalidRow.key);
      else
        window.requestAnimationFrame(() =>
          definitionStatusRef.current?.focus({ preventScroll: true }),
        );
      return;
    }
    if (
      normalized.entries.length === 0 &&
      definitionItem?.definitionOfDone?.length
    ) {
      setDefinitionDraft({
        ...definitionDraft,
        confirmingClear: true,
        confirmingReload: false,
        message: null,
      });
      return;
    }
    if (
      normalized.entries.length === 0 &&
      !definitionItem?.definitionOfDone?.length
    ) {
      setDefinitionDraft({
        ...definitionDraft,
        message: "Add a criterion before saving, or cancel this editor.",
      });
      return;
    }
    void persistDefinition(normalized.entries);
  };

  useDialogKeyboard(panelRef, () => {
    if (
      rulesEditing ||
      qualityBarsEditing ||
      contextReviewEditing ||
      reviewScheduleEditing ||
      relationshipEditingId
    )
      return;
    if (saving && (definitionDraft || workItemFormOpen)) return;
    if (definitionDraft?.confirmingReload) {
      setDefinitionDraft({
        ...definitionDraft,
        confirmingReload: false,
        message: null,
      });
      window.requestAnimationFrame(() =>
        panelRef.current
          ?.querySelector<HTMLButtonElement>("[data-load-latest-definition]")
          ?.focus({ preventScroll: true }),
      );
      return;
    }
    if (definitionDraft?.confirmingClear) {
      setDefinitionDraft({
        ...definitionDraft,
        confirmingClear: false,
        confirmingReload: false,
        message: null,
      });
      window.requestAnimationFrame(() =>
        definitionAddRef.current?.focus({ preventScroll: true }),
      );
      return;
    }
    if (definitionDraft) {
      closeDefinitionEditor();
      return;
    }
    if (orderModeOpen) {
      closeOrderMode();
      return;
    }
    onClose();
  });
  useEffect(() => {
    if (!focusTargetIdentity) return;
    const frame = window.requestAnimationFrame(() =>
      storedResultRef.current?.focus({ preventScroll: true }),
    );
    return () => window.cancelAnimationFrame(frame);
  }, [focusTargetIdentity]);
  useEffect(
    () => () => {
      definitionGenerationRef.current += 1;
    },
    [project.id],
  );

  const saveObjective = async (event: FormEvent) => {
    event.preventDefault();
    const title = objectiveTitle.trim();
    const expectedOutcome = objectiveOutcome.trim();
    if (!title) {
      setMessage("Add a concise objective before saving.");
      return;
    }
    const at = now();
    const nextObjective: Objective = {
      id: objective?.id ?? newId("objective"),
      title,
      ...(expectedOutcome ? { expectedOutcome } : {}),
      status: "active",
      createdAt: objective?.createdAt ?? at,
      updatedAt: at,
      workItems: objective?.workItems ?? [],
    };
    setSaving(true);
    const result = workspaceProject
      ? await controller.mutate({
          type: "objective.upsert",
          projectId: project.id,
          objective: nextObjective,
        })
      : await controller.mutate({
          type: "project.upsert",
          project: {
            id: project.id,
            title: project.name,
            createdAt: at,
            updatedAt: at,
            objectives: [nextObjective],
          },
        });
    setSaving(false);
    if (!result.ok) {
      setMessage(
        "The objective was not saved. Review the latest plan and try again.",
      );
      return;
    }
    setObjectiveFormOpen(false);
    setMessage("Objective saved.");
  };

  const createWorkItem = async (event: FormEvent) => {
    event.preventDefault();
    const title = workItemTitle.trim();
    const expectedOutcome = workItemOutcome.trim();
    if (!objective || !title || !expectedOutcome) {
      setMessage("A work item needs both a name and an expected outcome.");
      return;
    }
    const normalized = normalizedDefinitionOfDone(workItemDefinitionRows);
    if (!normalized.entries) {
      setMessage(normalized.error ?? "Review the criteria before saving.");
      const invalidRow = workItemDefinitionRows.find(
        (row) => !row.text.replace(/\r\n?|\n/gu, "\n").trim(),
      );
      if (invalidRow) focusDefinitionRow(invalidRow.key);
      else
        window.requestAnimationFrame(() =>
          definitionStatusRef.current?.focus({ preventScroll: true }),
        );
      return;
    }
    const at = now();
    setSaving(true);
    const result = await controller.mutate({
      type: "workItem.upsert",
      projectId: project.id,
      objectiveId: objective.id,
      workItem: {
        id: newId("work"),
        title,
        expectedOutcome,
        ...(normalized.entries.length
          ? { definitionOfDone: normalized.entries }
          : {}),
        status: "planned",
        createdAt: at,
        updatedAt: at,
        attempts: [],
      },
    });
    setSaving(false);
    if (!result.ok) {
      setMessage(
        "The work item was not saved. Review the latest plan and try again.",
      );
      return;
    }
    setWorkItemTitle("");
    setWorkItemOutcome("");
    setWorkItemDefinitionRows([]);
    setWorkItemFormOpen(false);
    setMessage("Work item added.");
    window.requestAnimationFrame(() =>
      addWorkTriggerRef.current?.focus({ preventScroll: true }),
    );
  };

  const updateWorkItemStatus = async (
    item: WorkItem,
    status: WorkItem["status"],
  ) => {
    if (!objective) return;
    setSaving(true);
    const result = await controller.mutate({
      type: "workItem.upsert",
      projectId: project.id,
      objectiveId: objective.id,
      workItem: { ...item, status, updatedAt: now() },
    });
    setSaving(false);
    setMessage(
      result.ok ? "Work item updated." : "The work item was not updated.",
    );
  };

  const focusOrderControl = (
    itemId: string,
    preferredDirection: "earlier" | "later",
    fallback: HTMLButtonElement,
  ) => {
    window.requestAnimationFrame(() => {
      const controls = [
        ...(panelRef.current?.querySelectorAll<HTMLButtonElement>(
          "[data-order-item-id][data-order-direction]",
        ) ?? []),
      ].filter((control) => control.dataset.orderItemId === itemId);
      const preferred = controls.find(
        (control) => control.dataset.orderDirection === preferredDirection,
      );
      const alternate = controls.find(
        (control) => control.dataset.orderDirection !== preferredDirection,
      );
      const orderModeTrigger = orderModeTriggerRef.current;
      const target =
        preferred && !preferred.disabled
          ? preferred
          : alternate && !alternate.disabled
            ? alternate
            : fallback.isConnected && !fallback.disabled
              ? fallback
              : orderModeTrigger?.isConnected && !orderModeTrigger.disabled
                ? orderModeTrigger
                : closeButtonRef.current;
      target?.focus({ preventScroll: true });
    });
  };

  const moveWorkItem = async (
    item: WorkItem,
    index: number,
    direction: "earlier" | "later",
    trigger: HTMLButtonElement,
  ) => {
    if (!objective || orderLocked) return;
    const offset = direction === "earlier" ? -1 : 1;
    const destination = index + offset;
    if (destination < 0 || destination >= objective.workItems.length) return;

    const orderedWorkItemIds = objective.workItems.map(
      (candidate) => candidate.id,
    );
    [orderedWorkItemIds[index], orderedWorkItemIds[destination]] = [
      orderedWorkItemIds[destination],
      orderedWorkItemIds[index],
    ];

    setSaving(true);
    setMessage("Saving milestone order…");
    const result = await controller.mutate({
      type: "workItem.reorder",
      projectId: project.id,
      objectiveId: objective.id,
      orderedWorkItemIds,
    });
    setSaving(false);
    if (!result.ok) {
      setMessage(
        "The milestone order was not saved. Review the latest plan and try again.",
      );
      focusOrderControl(item.id, direction, trigger);
      return;
    }

    setMessage(
      `Moved ${item.title} to milestone ${destination + 1} of ${objective.workItems.length}.`,
    );
    focusOrderControl(item.id, direction, trigger);
  };

  return (
    <aside
      id="work-planner-dialog"
      ref={panelRef}
      className={styles.panel}
      role="dialog"
      aria-modal="true"
      aria-labelledby="work-planner-heading"
      data-work-planner="true"
    >
      <header className={styles.header}>
        <div>
          <small>Outcome plan</small>
          <h2 id="work-planner-heading">{project.name}</h2>
        </div>
        <button
          ref={closeButtonRef}
          type="button"
          onClick={onClose}
          aria-label="Close project plan"
        >
          ×
        </button>
      </header>

      {controller.ready &&
      !controller.persistent &&
      !(
        controller.recovery?.kind === "backup" &&
        !controller.recoveryAcknowledged
      ) ? (
        <p className={styles.warning} role="status">
          The local Coffice store is unavailable. Planning changes are disabled.
        </p>
      ) : null}
      {controller.recovery?.kind === "backup" &&
      !controller.recoveryAcknowledged ? (
        <p className={styles.warning} role="status">
          Coffice recovered this plan from its last valid backup. Review it
          before making a new decision.
        </p>
      ) : null}

      <p
        ref={definitionStatusRef}
        className={styles.definitionLiveStatus}
        role="status"
        aria-live="polite"
        data-definition-of-done-status="true"
        tabIndex={-1}
      >
        {definitionAnnouncement}
      </p>

      {focusTarget ? (
        <section
          ref={storedResultRef}
          className={styles.storedResult}
          data-stored-result-context="true"
          tabIndex={-1}
          aria-labelledby="stored-result-heading"
        >
          <span>Stored result context</span>
          {storedResultContext ? (
            <>
              <h3 id="stored-result-heading">
                {storedResultContext.workItem.title}
              </h3>
              <p>{storedResultContext.objective.title}</p>
              <small>
                Result {storedResultContext.resultIndex} of{" "}
                {storedResultContext.attempt.resultCycles.length} · observed{" "}
                {compactTimestamp(storedResultContext.result.observedAt)}
              </small>
              {storedResultContext.latestReceipt ? (
                <b
                  data-stored-verification-state={
                    storedResultContext.latestReceipt.state
                  }
                >
                  {verificationProfileLabel(
                    storedResultContext.latestReceipt.profile.id,
                  )}
                  {storedResultContext.latestReceipt.state === "failed"
                    ? ` · ${verificationFailureLabel(
                        storedResultContext.latestReceipt.checks[0]
                          ?.failureKind,
                        storedResultContext.latestReceipt.checks[0]?.exitCode,
                      )}`
                    : ` · ${verificationStateLabel(
                        storedResultContext.latestReceipt.state,
                      )}`}
                  {storedResultContext.latestReceipt.completedAt
                    ? ` · ${compactTimestamp(
                        storedResultContext.latestReceipt.completedAt,
                      )}`
                    : ""}
                </b>
              ) : (
                <b>No quality-check receipt is stored for this result.</b>
              )}
              <ReviewAssessmentCard
                controller={controller}
                target={focusTarget}
                scopeLabel="Exact result"
                showAgentSelfCritique
              />
              <DecisionRequestsCard
                controller={controller}
                target={focusTarget}
                scopeLabel="Exact result"
              />
              {storedResultContext.liveTaskId && onOpenLiveTask ? (
                <button
                  type="button"
                  className={styles.storedResultAction}
                  onClick={() =>
                    onOpenLiveTask(
                      storedResultContext.liveTaskProjectId!,
                      storedResultContext.liveTaskId!,
                    )
                  }
                >
                  Review live task
                </button>
              ) : null}
            </>
          ) : (
            <>
              <h3 id="stored-result-heading">Stored result unavailable</h3>
              <p>
                The saved target no longer exists in this local work plan. No
                live task was opened in its place.
              </p>
            </>
          )}
        </section>
      ) : null}

      <section className={styles.objective}>
        <div className={styles.sectionTopline}>
          <div>
            <span>Current objective</span>
            <h3>{objective?.title ?? "No objective yet"}</h3>
          </div>
          <button
            type="button"
            data-dialog-initial-focus={!objective ? "true" : undefined}
            disabled={
              !controller.persistent ||
              saving ||
              rulesEditing ||
              qualityBarsEditing ||
              project.holding
            }
            onClick={() => {
              dismissDefinitionEditor();
              setOrderModeOpen(false);
              setObjectiveTitle(objective?.title ?? "");
              setObjectiveOutcome(objective?.expectedOutcome ?? "");
              setObjectiveFormOpen((open) => !open);
              setWorkItemFormOpen(false);
              setMessage(null);
            }}
          >
            {objective ? "Edit" : "Set objective"}
          </button>
        </div>
        <p>
          {project.holding
            ? "Assign these tasks to a Codex project before creating project work."
            : (objective?.expectedOutcome ??
              "Define the outcome this office is trying to achieve.")}
        </p>

        {objectiveFormOpen ? (
          <form className={styles.form} onSubmit={saveObjective}>
            <label>
              Objective
              <input
                autoFocus
                value={objectiveTitle}
                maxLength={320}
                onChange={(event) =>
                  setObjectiveTitle(event.currentTarget.value)
                }
                placeholder="Ship the first useful review workflow"
                required
              />
            </label>
            <label>
              Definition of success <span>optional</span>
              <textarea
                value={objectiveOutcome}
                maxLength={1000}
                rows={3}
                onChange={(event) =>
                  setObjectiveOutcome(event.currentTarget.value)
                }
                placeholder="What must be true before this objective is achieved?"
              />
            </label>
            <div className={styles.formActions}>
              <button type="submit" disabled={saving}>
                {saving ? "Saving…" : "Save objective"}
              </button>
              <button type="button" onClick={() => setObjectiveFormOpen(false)}>
                Cancel
              </button>
            </div>
          </form>
        ) : null}
      </section>

      <ProjectRulesSection
        project={project}
        workspaceProject={workspaceProject}
        controller={controller}
        parentBusy={
          saving ||
          qualityBarsEditing ||
          contextReviewEditing ||
          reviewScheduleEditing ||
          relationshipEditingId !== null
        }
        recoveryLocked={recoveryLocked}
        onBeginEditing={() => {
          dismissDefinitionEditor();
          setOrderModeOpen(false);
          setWorkItemFormOpen(false);
          setObjectiveFormOpen(false);
          setMessage(null);
        }}
        onEditingChange={setRulesEditing}
      />

      <ProjectQualityBarsSection
        project={project}
        workspaceProject={workspaceProject}
        controller={controller}
        parentBusy={
          saving ||
          rulesEditing ||
          contextReviewEditing ||
          reviewScheduleEditing ||
          relationshipEditingId !== null
        }
        recoveryLocked={recoveryLocked}
        onBeginEditing={() => {
          dismissDefinitionEditor();
          setOrderModeOpen(false);
          setWorkItemFormOpen(false);
          setObjectiveFormOpen(false);
          setMessage(null);
        }}
        onEditingChange={setQualityBarsEditing}
      />

      {workspaceProject && !project.holding ? (
        <ProjectContextReviewSection
          project={workspaceProject}
          controller={controller}
          locked={
            !controller.persistent ||
            recoveryLocked ||
            saving ||
            rulesEditing ||
            qualityBarsEditing ||
            reviewScheduleEditing ||
            relationshipEditingId !== null
          }
          onBeginEditing={() => {
            dismissDefinitionEditor();
            setOrderModeOpen(false);
            setWorkItemFormOpen(false);
            setObjectiveFormOpen(false);
            setMessage(null);
          }}
          onEditingChange={setContextReviewEditing}
        />
      ) : null}

      {!project.holding ? (
        <ProjectReviewScheduleSection
          project={project}
          workspaceProject={workspaceProject}
          controller={controller}
          locked={
            !controller.persistent ||
            recoveryLocked ||
            saving ||
            rulesEditing ||
            qualityBarsEditing ||
            contextReviewEditing ||
            relationshipEditingId !== null
          }
          onBeginEditing={() => {
            dismissDefinitionEditor();
            setOrderModeOpen(false);
            setWorkItemFormOpen(false);
            setObjectiveFormOpen(false);
            setMessage(null);
          }}
          onEditingChange={setReviewScheduleEditing}
        />
      ) : null}

      {workspaceProject && !project.holding ? (
        <ProjectDecisionLog
          projectId={project.id}
          projectName={project.name}
          controller={controller}
        />
      ) : null}

      <section className={styles.workItems}>
        <div className={styles.sectionTopline}>
          <div>
            <span>Milestones</span>
            <h3>Ordered outcomes</h3>
          </div>
          <div className={styles.sectionActions}>
            {orderModeOpen || (objective && objective.workItems.length > 1) ? (
              <button
                ref={orderModeTriggerRef}
                type="button"
                disabled={!orderModeOpen && orderLocked}
                aria-pressed={orderModeOpen}
                onClick={() => {
                  if (orderModeOpen) {
                    closeOrderMode();
                    return;
                  }
                  setOrderModeOpen(true);
                  dismissDefinitionEditor();
                  setWorkItemFormOpen(false);
                  setObjectiveFormOpen(false);
                  setMessage(null);
                }}
              >
                {orderModeOpen ? "Done" : "Change order"}
              </button>
            ) : null}
            {!orderModeOpen ? (
              <button
                ref={addWorkTriggerRef}
                type="button"
                disabled={!objective || definitionLocked}
                onClick={() => {
                  dismissDefinitionEditor();
                  setWorkItemFormOpen((open) => !open);
                  setObjectiveFormOpen(false);
                  setMessage(null);
                }}
              >
                Add work
              </button>
            ) : null}
          </div>
        </div>

        {objective ? (
          <p className={styles.orderHint}>
            Order guides what comes next; it does not block other work.
          </p>
        ) : null}

        {workItemFormOpen ? (
          <form className={styles.form} onSubmit={createWorkItem}>
            <label>
              Work item
              <input
                autoFocus
                disabled={definitionLocked}
                value={workItemTitle}
                maxLength={320}
                onChange={(event) =>
                  setWorkItemTitle(event.currentTarget.value)
                }
                placeholder="Review and accept the command-center slice"
                required
              />
            </label>
            <label>
              Expected outcome
              <textarea
                disabled={definitionLocked}
                value={workItemOutcome}
                maxLength={1000}
                rows={3}
                onChange={(event) =>
                  setWorkItemOutcome(event.currentTarget.value)
                }
                placeholder="State the result a reviewer can accept or reject"
                required
              />
            </label>
            <fieldset className={styles.definitionFieldset}>
              <legend>
                Definition of Done <span>optional</span>
              </legend>
              <p>
                Add concrete conditions a reviewer can check. Coffice does not
                verify them automatically.
              </p>
              <div className={styles.definitionRows}>
                {workItemDefinitionRows.map((row, index) => (
                  <div
                    key={row.key}
                    className={styles.definitionRow}
                    data-definition-row-key={row.key}
                  >
                    <label>
                      Done criterion {index + 1}
                      <textarea
                        ref={(element) => {
                          if (element)
                            definitionTextareaRefs.current.set(
                              row.key,
                              element,
                            );
                          else definitionTextareaRefs.current.delete(row.key);
                        }}
                        value={row.text}
                        rows={2}
                        disabled={definitionLocked}
                        onChange={(event) => {
                          const text = event.currentTarget.value;
                          setWorkItemDefinitionRows((current) =>
                            current.map((candidate) =>
                              candidate.key === row.key
                                ? {
                                    ...candidate,
                                    text,
                                  }
                                : candidate,
                            ),
                          );
                        }}
                      />
                    </label>
                    <div
                      className={styles.definitionRowActions}
                      role="group"
                      aria-label={`Reorder or remove criterion ${index + 1}`}
                    >
                      <button
                        type="button"
                        data-definition-move="earlier"
                        disabled={definitionLocked || index === 0}
                        aria-label={`Move criterion ${index + 1} earlier`}
                        onClick={() => {
                          const rows = [...workItemDefinitionRows];
                          [rows[index - 1], rows[index]] = [
                            rows[index],
                            rows[index - 1],
                          ];
                          setWorkItemDefinitionRows(rows);
                          focusDefinitionRow(row.key);
                        }}
                      >
                        Earlier
                      </button>
                      <button
                        type="button"
                        data-definition-move="later"
                        disabled={
                          definitionLocked ||
                          index === workItemDefinitionRows.length - 1
                        }
                        aria-label={`Move criterion ${index + 1} later`}
                        onClick={() => {
                          const rows = [...workItemDefinitionRows];
                          [rows[index], rows[index + 1]] = [
                            rows[index + 1],
                            rows[index],
                          ];
                          setWorkItemDefinitionRows(rows);
                          focusDefinitionRow(row.key);
                        }}
                      >
                        Later
                      </button>
                      <button
                        type="button"
                        disabled={definitionLocked}
                        aria-label={`Remove criterion ${index + 1}`}
                        onClick={() => {
                          const rows = workItemDefinitionRows.filter(
                            (candidate) => candidate.key !== row.key,
                          );
                          const nextKey = rows[index]?.key ?? rows.at(-1)?.key;
                          setWorkItemDefinitionRows(rows);
                          if (nextKey) focusDefinitionRow(nextKey);
                          else
                            window.requestAnimationFrame(() =>
                              creationDefinitionAddRef.current?.focus({
                                preventScroll: true,
                              }),
                            );
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <button
                ref={creationDefinitionAddRef}
                type="button"
                disabled={
                  definitionLocked ||
                  workItemDefinitionRows.length >=
                    MAX_DEFINITION_OF_DONE_ENTRIES
                }
                onClick={() => {
                  const row = { key: newId("criterion-row"), text: "" };
                  setWorkItemDefinitionRows((current) => [...current, row]);
                  focusDefinitionRow(row.key);
                }}
              >
                Add criterion
              </button>
            </fieldset>
            <div className={styles.formActions}>
              <button type="submit" disabled={definitionLocked}>
                {saving ? "Saving…" : "Add work item"}
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => {
                  setWorkItemTitle("");
                  setWorkItemOutcome("");
                  setWorkItemDefinitionRows([]);
                  setWorkItemFormOpen(false);
                  window.requestAnimationFrame(() =>
                    addWorkTriggerRef.current?.focus({ preventScroll: true }),
                  );
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : null}

        <div className={styles.itemList}>
          {objective?.workItems.map((item, itemIndex) => (
            <article
              key={item.id}
              data-work-item-state={item.status}
              data-milestone-position={itemIndex + 1}
              data-milestone-order-mode={orderModeOpen ? "true" : undefined}
              data-stored-result-work-item={
                storedResultContext?.workItem.id === item.id
                  ? "true"
                  : undefined
              }
            >
              <div className={styles.itemSummary}>
                <span className={styles.milestoneNumber} aria-hidden="true">
                  {itemIndex + 1}
                </span>
                <div>
                  <span>
                    Milestone {itemIndex + 1} · {itemStateLabel(item)}
                  </span>
                  <h4>{item.title}</h4>
                  {!orderModeOpen ? <p>{item.expectedOutcome}</p> : null}
                </div>
                {orderModeOpen ? (
                  <div
                    className={styles.orderControls}
                    role="group"
                    aria-label={`Change order for milestone ${itemIndex + 1}, ${item.title}`}
                  >
                    <button
                      type="button"
                      data-order-item-id={item.id}
                      data-order-direction="earlier"
                      disabled={orderLocked || itemIndex === 0}
                      aria-label={`Move milestone ${itemIndex + 1}, ${item.title}, earlier`}
                      onClick={(event) =>
                        void moveWorkItem(
                          item,
                          itemIndex,
                          "earlier",
                          event.currentTarget,
                        )
                      }
                    >
                      <span aria-hidden="true">↑</span>
                    </button>
                    <button
                      type="button"
                      data-order-item-id={item.id}
                      data-order-direction="later"
                      disabled={
                        orderLocked ||
                        itemIndex === objective.workItems.length - 1
                      }
                      aria-label={`Move milestone ${itemIndex + 1}, ${item.title}, later`}
                      onClick={(event) =>
                        void moveWorkItem(
                          item,
                          itemIndex,
                          "later",
                          event.currentTarget,
                        )
                      }
                    >
                      <span aria-hidden="true">↓</span>
                    </button>
                  </div>
                ) : null}
              </div>
              {!orderModeOpen ? (
                <WorkItemRelationshipsSection
                  project={workspaceProject!}
                  objective={objective}
                  item={item}
                  controller={controller}
                  locked={
                    !controller.persistent ||
                    recoveryLocked ||
                    saving ||
                    rulesEditing ||
                    qualityBarsEditing ||
                    contextReviewEditing ||
                    reviewScheduleEditing ||
                    Boolean(definitionDraft) ||
                    (relationshipEditingId !== null &&
                      relationshipEditingId !== item.id) ||
                    Boolean(project.holding)
                  }
                  onBeginEditing={() => {
                    dismissDefinitionEditor();
                    setOrderModeOpen(false);
                    setWorkItemFormOpen(false);
                    setObjectiveFormOpen(false);
                    setMessage(null);
                  }}
                  onEditingChange={(editing) =>
                    setRelationshipEditingId(editing ? item.id : null)
                  }
                />
              ) : null}
              {!orderModeOpen && relationshipEditingId !== item.id ? (
                definitionDraftMatchesContext &&
                definitionDraft?.workItemId === item.id ? (
                  <fieldset
                    className={styles.definitionEditor}
                    data-definition-of-done-editor="true"
                  >
                    <legend>Edit Definition of Done</legend>
                    {definitionChangedElsewhere ? (
                      <div className={styles.definitionConflict} role="alert">
                        <p>
                          Definition of Done changed elsewhere. Your draft was
                          not overwritten. Load the latest criteria before
                          saving.
                        </p>
                        {definitionDraft.confirmingReload ? (
                          <div
                            className={styles.definitionReloadConfirmation}
                            role="group"
                            aria-label="Load latest Definition of Done"
                          >
                            <p>
                              Loading the latest criteria will discard this
                              unsaved draft.
                            </p>
                            <div className={styles.definitionActions}>
                              <button
                                type="button"
                                disabled={saving || !definitionItem}
                                onClick={loadLatestDefinition}
                              >
                                Discard draft and load latest
                              </button>
                              <button
                                type="button"
                                autoFocus
                                disabled={saving}
                                onClick={() =>
                                  setDefinitionDraft({
                                    ...definitionDraft,
                                    confirmingReload: false,
                                    message: null,
                                  })
                                }
                              >
                                Keep my draft
                              </button>
                              <button
                                type="button"
                                disabled={saving}
                                onClick={closeDefinitionEditor}
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className={styles.definitionActions}>
                            <button
                              type="button"
                              disabled={saving || !definitionItem}
                              onClick={() => {
                                if (!definitionItem) return;
                                setDefinitionDraft({
                                  ...definitionDraft,
                                  openedFingerprint:
                                    definitionOfDoneFingerprint(
                                      definitionItem.definitionOfDone,
                                    ),
                                  confirmingReload: false,
                                  message:
                                    "Your preserved draft will replace the latest criteria if you save. Review it first.",
                                });
                                window.requestAnimationFrame(() => {
                                  const first = definitionDraft.rows[0];
                                  if (first) focusDefinitionRow(first.key);
                                  else
                                    definitionAddRef.current?.focus({
                                      preventScroll: true,
                                    });
                                });
                              }}
                            >
                              Use my draft
                            </button>
                            <button
                              type="button"
                              data-load-latest-definition="true"
                              disabled={saving || !definitionItem}
                              onClick={() =>
                                setDefinitionDraft({
                                  ...definitionDraft,
                                  confirmingReload: true,
                                  message: null,
                                })
                              }
                            >
                              Load latest criteria
                            </button>
                            <button
                              type="button"
                              disabled={saving}
                              onClick={closeDefinitionEditor}
                            >
                              Cancel
                            </button>
                          </div>
                        )}
                      </div>
                    ) : definitionDraft.confirmingClear ? (
                      <div
                        className={styles.definitionConfirmation}
                        role="group"
                        aria-label="Confirm removal of Definition of Done"
                      >
                        <strong>Confirm removal of Definition of Done</strong>
                        <p>
                          This removes all current criteria from this work item.
                          It does not change work status, saved results, or
                          Codex.
                        </p>
                        <div className={styles.definitionActions}>
                          <button
                            type="button"
                            disabled={
                              definitionLocked || definitionChangedElsewhere
                            }
                            onClick={() => void persistDefinition([])}
                          >
                            Remove criteria
                          </button>
                          <button
                            type="button"
                            autoFocus
                            disabled={saving}
                            onClick={() => {
                              setDefinitionDraft({
                                ...definitionDraft,
                                confirmingClear: false,
                                confirmingReload: false,
                                message: null,
                              });
                              window.requestAnimationFrame(() =>
                                definitionAddRef.current?.focus({
                                  preventScroll: true,
                                }),
                              );
                            }}
                          >
                            Back
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <p>
                          Put criteria in the order you want them reviewed.
                          Coffice does not check them automatically.
                        </p>
                        <div className={styles.definitionRows}>
                          {definitionDraft.rows.map((row, index) => (
                            <div
                              key={row.key}
                              className={styles.definitionRow}
                              data-definition-row-key={row.key}
                            >
                              <label>
                                Done criterion {index + 1}
                                <textarea
                                  ref={(element) => {
                                    if (element)
                                      definitionTextareaRefs.current.set(
                                        row.key,
                                        element,
                                      );
                                    else
                                      definitionTextareaRefs.current.delete(
                                        row.key,
                                      );
                                  }}
                                  value={row.text}
                                  rows={3}
                                  disabled={definitionLocked}
                                  onChange={(event) =>
                                    changeDefinitionRow(
                                      row.key,
                                      event.currentTarget.value,
                                    )
                                  }
                                />
                              </label>
                              <div
                                className={styles.definitionRowActions}
                                role="group"
                                aria-label={`Reorder or remove criterion ${index + 1}`}
                              >
                                <button
                                  type="button"
                                  data-definition-move="earlier"
                                  disabled={definitionLocked || index === 0}
                                  aria-label={`Move criterion ${index + 1} earlier`}
                                  onClick={() =>
                                    moveDefinitionRow(row.key, "earlier")
                                  }
                                >
                                  Earlier
                                </button>
                                <button
                                  type="button"
                                  data-definition-move="later"
                                  disabled={
                                    definitionLocked ||
                                    index === definitionDraft.rows.length - 1
                                  }
                                  aria-label={`Move criterion ${index + 1} later`}
                                  onClick={() =>
                                    moveDefinitionRow(row.key, "later")
                                  }
                                >
                                  Later
                                </button>
                                <button
                                  type="button"
                                  disabled={definitionLocked}
                                  aria-label={`Remove criterion ${index + 1}`}
                                  onClick={() => removeDefinitionRow(row.key)}
                                >
                                  Remove
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                        <div className={styles.definitionActions}>
                          <button
                            ref={definitionAddRef}
                            type="button"
                            disabled={
                              definitionLocked ||
                              definitionDraft.rows.length >=
                                MAX_DEFINITION_OF_DONE_ENTRIES
                            }
                            onClick={addDefinitionRow}
                          >
                            Add criterion
                          </button>
                          <button
                            type="button"
                            disabled={
                              definitionLocked || definitionChangedElsewhere
                            }
                            onClick={saveDefinition}
                          >
                            {saving ? "Saving…" : "Save changes"}
                          </button>
                          <button
                            type="button"
                            disabled={saving}
                            onClick={closeDefinitionEditor}
                          >
                            Cancel
                          </button>
                        </div>
                      </>
                    )}
                  </fieldset>
                ) : (
                  <section
                    className={styles.definitionRead}
                    data-definition-of-done-current="true"
                  >
                    {item.definitionOfDone?.length ? (
                      <details
                        open={openDefinitionDisclosures.has(item.id)}
                        onToggle={(event) => {
                          const open = event.currentTarget.open;
                          setOpenDefinitionDisclosures((current) => {
                            if (current.has(item.id) === open) return current;
                            const next = new Set(current);
                            if (open) next.add(item.id);
                            else next.delete(item.id);
                            return next;
                          });
                        }}
                      >
                        <summary>
                          Definition of Done · {item.definitionOfDone.length}
                        </summary>
                        <ol>
                          {item.definitionOfDone.map((criterion, index) => (
                            <li key={`${index}-${criterion}`}>{criterion}</li>
                          ))}
                        </ol>
                        <button
                          ref={(element) => {
                            if (element)
                              definitionTriggerRefs.current.set(
                                item.id,
                                element,
                              );
                            else definitionTriggerRefs.current.delete(item.id);
                          }}
                          type="button"
                          disabled={definitionLocked}
                          onClick={() => openDefinitionEditor(item)}
                        >
                          Edit criteria
                        </button>
                      </details>
                    ) : (
                      <div className={styles.definitionEmpty}>
                        <div>
                          <strong>Definition of Done</strong>
                          <span>Not defined</span>
                          <p>No done criteria recorded.</p>
                        </div>
                        <button
                          ref={(element) => {
                            if (element)
                              definitionTriggerRefs.current.set(
                                item.id,
                                element,
                              );
                            else definitionTriggerRefs.current.delete(item.id);
                          }}
                          type="button"
                          disabled={definitionLocked}
                          onClick={() => openDefinitionEditor(item)}
                        >
                          Define done
                        </button>
                      </div>
                    )}
                  </section>
                )
              ) : null}
              {!orderModeOpen && item.attempts.length ? (
                <ul
                  className={styles.attemptSegments}
                  aria-label={`${item.title} Codex link history`}
                >
                  {item.attempts.map((attempt, index) => {
                    const latestResult = attempt.resultCycles.at(-1);
                    const liveProjectId =
                      project.liveTaskLocations?.get(attempt.codexTaskId) ??
                      (project.liveTaskIds?.includes(attempt.codexTaskId)
                        ? project.id
                        : null);
                    return (
                      <li key={attempt.id}>
                        <div>
                          <strong>Codex attempt {index + 1}</strong>
                          <span>
                            {attempt.unlinkedAt
                              ? `No longer tracked · until ${compactTimestamp(attempt.unlinkedAt)}`
                              : "Actively tracked"}
                          </span>
                          <small>
                            {attempt.resultCycles.length} saved result
                            {attempt.resultCycles.length === 1 ? "" : "s"}
                            {latestResult?.review?.decision
                              ? ` · latest ${latestResult.review.decision.kind}`
                              : ""}
                          </small>
                        </div>
                        {liveProjectId && onOpenLiveTask ? (
                          <button
                            type="button"
                            onClick={() =>
                              onOpenLiveTask(liveProjectId, attempt.codexTaskId)
                            }
                          >
                            Review live task
                          </button>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              ) : null}
              {!orderModeOpen ? (
                <>
                  <ReviewAssessmentCard
                    controller={controller}
                    target={{
                      projectId: project.id,
                      objectiveId: objective.id,
                      workItemId: item.id,
                    }}
                    scopeLabel="Work item"
                  />
                  <DecisionRequestsCard
                    controller={controller}
                    target={{
                      projectId: project.id,
                      objectiveId: objective.id,
                      workItemId: item.id,
                    }}
                    scopeLabel="Work item"
                  />
                  <footer>
                    <span>
                      {
                        item.attempts.filter((attempt) => !attempt.unlinkedAt)
                          .length
                      }{" "}
                      active ·{" "}
                      {
                        item.attempts.filter((attempt) => attempt.unlinkedAt)
                          .length
                      }{" "}
                      historical
                    </span>
                    {item.status === "planned" ? (
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() =>
                          void updateWorkItemStatus(item, "in_progress")
                        }
                      >
                        Start
                      </button>
                    ) : null}
                  </footer>
                </>
              ) : null}
            </article>
          ))}
          {objective && !objective.workItems.length ? (
            <div className={styles.empty}>
              <strong>No milestones yet</strong>
              <p>
                Add only outcomes that need a decision or a clear finish line.
              </p>
            </div>
          ) : null}
          {definitionDraftMatchesProject &&
          definitionDraft &&
          (!definitionDraftMatchesContext || !definitionItem) ? (
            <section
              className={styles.definitionOrphaned}
              data-definition-of-done-orphaned="true"
              role="alert"
            >
              <h4>Definition of Done changed elsewhere</h4>
              <p>
                This work item was removed elsewhere. Your Definition of Done
                draft was not overwritten and cannot be saved.
              </p>
              {definitionDraft.rows.length ? (
                <ol aria-label="Preserved Definition of Done draft">
                  {definitionDraft.rows.map((row) => (
                    <li key={row.key}>{row.text || "Blank criterion"}</li>
                  ))}
                </ol>
              ) : (
                <p>The preserved draft has no criteria.</p>
              )}
              <button
                type="button"
                autoFocus
                disabled={saving}
                onClick={closeDefinitionEditor}
              >
                Cancel
              </button>
            </section>
          ) : null}
          {!objective ? (
            <div className={styles.empty}>
              <strong>Start with the objective</strong>
              <p>
                The plan stays small by organizing work around one clear
                outcome.
              </p>
            </div>
          ) : null}
        </div>
      </section>

      {message || controller.error ? (
        <p className={styles.message} role="status">
          {controller.error ?? message}
        </p>
      ) : null}
      <p className={styles.privacy}>
        Stored locally by Coffice. Codex prompts, responses, and transcripts are
        never copied into this plan.
      </p>
    </aside>
  );
}
