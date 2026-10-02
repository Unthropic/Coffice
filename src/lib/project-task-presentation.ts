import type { NormalizedStatusValue } from "./domain";

const ACTIVE_STATUSES = new Set<NormalizedStatusValue>([
  "queued",
  "active",
  "starting",
  "planning",
  "thinking",
  "reading",
  "researching",
  "coding",
  "running",
  "reviewing",
]);

export interface CountableProjectTask {
  status: {
    value: NormalizedStatusValue;
    stale?: boolean;
  };
}

export interface ProjectTaskCounts {
  active: number;
  waiting: number;
  attention: number;
  completed: number;
}

export const EMPTY_PROJECT_TASK_COUNTS: Readonly<ProjectTaskCounts> =
  Object.freeze({ active: 0, waiting: 0, attention: 0, completed: 0 });

/** One status-count authority shared by campus, rail, and room headers. */
export function selectProjectTaskCounts(
  tasks: readonly CountableProjectTask[],
): ProjectTaskCounts {
  return tasks.reduce<ProjectTaskCounts>(
    (counts, task) => {
      if (ACTIVE_STATUSES.has(task.status.value) && !task.status.stale) {
        counts.active += 1;
      }
      if (task.status.value === "waiting_for_user") counts.waiting += 1;
      if (task.status.value === "blocked" || task.status.value === "failed") {
        counts.attention += 1;
      }
      if (task.status.value === "completed") counts.completed += 1;
      return counts;
    },
    { ...EMPTY_PROJECT_TASK_COUNTS },
  );
}

export function selectProjectCountsById(
  projects: readonly {
    id: string;
    tasks: readonly CountableProjectTask[];
  }[],
): ReadonlyMap<string, ProjectTaskCounts> {
  return new Map(
    projects.map((project) => [
      project.id,
      selectProjectTaskCounts(project.tasks),
    ]),
  );
}

export interface IdentifiableProjectTask {
  id: string;
  title: string;
  kind: "staff" | "temporary";
  agentName?: string;
}

export interface IdentifiableProjectLike {
  id: string;
  name: string;
}

const AGENT_TITLE_PREFIX = /^\[AGENT\]\s*/iu;
const TRAILING_ORDINAL_SUFFIX = /\s*\((\d+)\)$/u;

function titleCaseWord(word: string): string {
  if (!word) return word;
  if (word.includes("-")) {
    return word
      .split("-")
      .map((segment) => titleCaseWord(segment))
      .join("-");
  }
  if (/^[A-Z\d]+$/u.test(word)) return word;
  if (/[A-Z]/u.test(word.slice(1))) return word;
  return `${word[0]?.toUpperCase() ?? ""}${word.slice(1).toLowerCase()}`;
}

function normalizeVisibleLabel(value: string | null | undefined): string {
  return (value ?? "")
    .replace(AGENT_TITLE_PREFIX, "")
    .replaceAll("_", " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function normalizeProjectDisplayLabel(value: string): string {
  return normalizeVisibleLabel(value)
    .split(" ")
    .map((word) => titleCaseWord(word))
    .join(" ");
}

function hashDominatedLabel(value: string): boolean {
  const normalized = normalizeVisibleLabel(value);
  if (!normalized) return true;
  if (/^(task|session)\s+[0-9a-f]{4,}$/iu.test(normalized)) return true;
  const compact = normalized.replace(/[^\p{L}\p{N}]/gu, "");
  if (compact.length < 6) return false;
  if (/^[0-9a-f]{6,}$/iu.test(compact)) return true;
  const letters = compact.match(/[a-z]/giu)?.length ?? 0;
  const digits = compact.match(/\d/gu)?.length ?? 0;
  const hexLike = compact.match(/[0-9a-f]/giu)?.length ?? 0;
  return (
    compact.length >= 8 &&
    digits >= Math.max(3, letters) &&
    hexLike / compact.length >= 0.72
  );
}

export function shortTaskId(id: string): string {
  const compact = id.replaceAll("-", "");
  return compact.slice(0, 8) || "unknown";
}

function visibleIdentityToken(id: string): string {
  const compact = id.replace(/[^a-z\d]/giu, "");
  return (compact.slice(0, 4) || "LIVE").toUpperCase();
}

function baseVisibleTaskName(task: IdentifiableProjectTask): string {
  const agentName = normalizeVisibleLabel(task.agentName);
  if (agentName && !hashDominatedLabel(agentName)) return agentName;

  const title = normalizeVisibleLabel(task.title);
  if (title && !hashDominatedLabel(title)) return title;

  return task.kind === "staff" ? "Staff session" : "Session";
}

function canonicalTaskDisplayGroup(name: string): string {
  return name.replace(TRAILING_ORDINAL_SUFFIX, "").trim() || name;
}

function alphabeticalOrdinal(index: number): string {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  return letters[index] ?? `${index + 1}`;
}

export function formatVisibleTaskName(task: IdentifiableProjectTask): string {
  return canonicalTaskDisplayGroup(baseVisibleTaskName(task));
}

export function selectVisibleTaskLabels(
  tasks: readonly IdentifiableProjectTask[],
): ReadonlyMap<string, string> {
  const grouped = new Map<string, IdentifiableProjectTask[]>();
  for (const task of tasks) {
    const groupKey = canonicalTaskDisplayGroup(baseVisibleTaskName(task));
    const group = grouped.get(groupKey);
    if (group) group.push(task);
    else grouped.set(groupKey, [task]);
  }

  const labels = new Map<string, string>();
  for (const [groupKey, group] of grouped.entries()) {
    if (group.length === 1) {
      labels.set(group[0]!.id, groupKey);
      continue;
    }
    group.forEach((task, index) => {
      labels.set(task.id, `${groupKey} ${alphabeticalOrdinal(index)}`);
    });
  }
  return labels;
}

export function formatVisibleProjectName(
  project: IdentifiableProjectLike,
): string {
  const name = normalizeProjectDisplayLabel(project.name);
  if (name && !hashDominatedLabel(name)) return name;
  return `Project ${visibleIdentityToken(project.id)}`;
}

/**
 * Only duplicate resident names receive a badge. Unique names stay clean, and
 * the opaque ID is shortened without exposing task content.
 */
export function selectDuplicateStaffBadges(
  tasks: readonly IdentifiableProjectTask[],
): ReadonlyMap<string, string> {
  const groups = new Map<string, IdentifiableProjectTask[]>();
  for (const task of tasks) {
    if (task.kind !== "staff") continue;
    const name = formatVisibleTaskName(task).toLocaleLowerCase();
    const group = groups.get(name);
    if (group) group.push(task);
    else groups.set(name, [task]);
  }

  const badges = new Map<string, string>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    for (const task of group) badges.set(task.id, shortTaskId(task.id));
  }
  return badges;
}
