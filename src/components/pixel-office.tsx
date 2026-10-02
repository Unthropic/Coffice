"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

import type { EvidenceProvenance, NormalizedStatusValue } from "../lib/domain";
import {
  selectAttentionProjectProjection,
  type AttentionDigestCounts,
  type AttentionDigestGroup,
} from "../lib/attention-digest";
import { attentionEventKey, type AttentionItem } from "../lib/attention-inbox";
import type { VerificationTarget } from "../lib/coffice-workspace";
import {
  formatVisibleProjectName,
  formatVisibleTaskName,
  selectProjectTaskCounts,
  selectVisibleTaskLabels,
  type ProjectTaskCounts,
} from "../lib/project-task-presentation";
import {
  sessionLivenessAriaLabel,
  summarizeProjectSignals,
} from "../lib/session-liveness";
import {
  bindTopDownRoster,
  stableTopDownVisualIdentity,
} from "../lib/top-down-office-roster";
import { AttentionInboxPanel, ReviewActInspector } from "./review-workspace";
import {
  selectLatestClosedTaskWorkContext,
  selectOpenTaskWorkContext,
  selectTaskWorkContexts,
} from "./task-work-context";
import type { CodexActionsController } from "./use-codex-actions";
import type { AttentionReviewController } from "./use-attention-review-state";
import {
  useVerifications,
  type VerificationsController,
} from "./use-verifications";
import type { CofficeWorkspaceController } from "./use-coffice-workspace";
import { AvatarSprite, TopDownOffice } from "./top-down-office";
import {
  selectActiveObjective,
  selectWorkspaceProject,
  WorkPlannerPanel,
} from "./work-planner";

import reviewStyles from "./review-workspace.module.css";
import tdStyles from "./top-down-office.module.css";

interface OfficeStatus {
  value: NormalizedStatusValue;
  evidence: EvidenceProvenance;
  source: string;
  timestamp: string | null;
  confidence?: number;
  stale?: boolean;
}

interface OfficeTokenUsage {
  contextTokens: number;
  contextWindow: number;
  cumulativeTokens?: number;
  source: string;
  timestamp: string;
  stale: boolean;
}

interface OfficeTask {
  id: string;
  title: string;
  kind: "staff" | "temporary";
  assignmentEvidence?:
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
  status: OfficeStatus;
  tokenUsage?: OfficeTokenUsage;
}

type OfficeRepositoryAreaName =
  "Source" | "Tests" | "Docs" | "Config" | "Assets" | "Other";

interface OfficeRepositoryArea {
  area: OfficeRepositoryAreaName;
  files: number;
}

interface OfficeRepositoryDiffStats {
  trackedFiles: number;
  additions: number;
  deletions: number;
  binaryFiles: number;
  source: "git:diff-numstat";
}

interface OfficeUnavailableRepository {
  availability: "unavailable";
  source: "git";
  observedAt: string;
}

interface OfficeAvailableRepository {
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
    areas: readonly OfficeRepositoryArea[];
  };
  diffStats?: OfficeRepositoryDiffStats;
}

type OfficeRepository = OfficeUnavailableRepository | OfficeAvailableRepository;

interface OfficeProject {
  id: string;
  name: string;
  tasks: OfficeTask[];
  repository?: OfficeRepository;
  repositoryEvidenceState?: "fresh" | "refreshing" | "stale" | "unavailable";
  holding?: boolean;
}

interface ReviewWorkspace {
  controller: AttentionReviewController;
  visibleAttentionItems: readonly AttentionItem[];
  verificationProjectScoped?: boolean;
  verifications?: VerificationsController;
  requestedTask: { projectId: string; taskId: string } | null;
  requestedPlanTarget?: VerificationTarget | null;
  requestedPlanProjectId?: string | null;
  onOpenTask: (projectId: string, taskId: string) => void;
  onRequestHandled: (taskId: string) => void;
  onPlanRequestHandled?: (projectId: string) => void;
}

function VerificationAwareInspector({
  task,
  project,
  displayName,
  referenceTime,
  review,
  workspace,
  actions,
  verificationProjectId,
  visibleVerifications,
  onClose,
}: {
  task: OfficeTask;
  project: OfficeProject;
  displayName: string;
  referenceTime: number;
  review: AttentionReviewController;
  workspace: CofficeWorkspaceController;
  actions?: CodexActionsController;
  verificationProjectId: string;
  visibleVerifications?: VerificationsController;
  onClose: () => void;
}) {
  const historicalVerifications = useVerifications(
    verificationProjectId === project.id ? null : verificationProjectId,
    workspace.refresh,
  );
  const verifications =
    verificationProjectId === project.id
      ? visibleVerifications
      : historicalVerifications;

  return (
    <ReviewActInspector
      task={task}
      project={project}
      referenceTime={referenceTime}
      displayName={displayName}
      review={review}
      workspace={workspace}
      actions={actions}
      verifications={verifications}
      onClose={onClose}
    />
  );
}

function verificationProjectForTask(
  workspace: CofficeWorkspaceController,
  project: OfficeProject,
  task: OfficeTask,
): string {
  const contexts = selectTaskWorkContexts(workspace.workspace, task.id);
  const resultKey = attentionEventKey(task);
  const exactResultContext =
    contexts.find((context) =>
      context.attempt.resultCycles.some(
        (result) =>
          result.key.kind === "revision" && result.key.id === resultKey,
      ),
    ) ?? null;
  return (
    (
      exactResultContext ??
      selectOpenTaskWorkContext(workspace.workspace, task.id) ??
      selectLatestClosedTaskWorkContext(workspace.workspace, task.id)
    )?.project.id ?? project.id
  );
}

interface PixelOfficeProps {
  project: OfficeProject;
  projects: OfficeProject[];
  onExit: () => void;
  onEnterProject: (id: string) => void;
  referenceTime: number;
  projectCountsById?: ReadonlyMap<string, ProjectTaskCounts>;
  attentionProjectGroupsById?: ReadonlyMap<string, AttentionDigestGroup>;
  reviewWorkspace?: ReviewWorkspace;
  workspace?: CofficeWorkspaceController;
  codexActions?: CodexActionsController;
}

const EMPTY_WORKSPACE_CONTROLLER: CofficeWorkspaceController = {
  workspace: null,
  ready: false,
  persistent: false,
  recovery: null,
  recoveryAcknowledged: false,
  error: null,
  refresh: async () => undefined,
  acknowledgeRecovery: () => undefined,
  mutate: async () => ({ ok: false, reason: "unavailable" }),
  replaceAttentionReview: async () => ({
    ok: false,
    reason: "unavailable",
  }),
  updateAttentionEvent: async () => ({
    ok: false,
    reason: "unavailable",
  }),
};

const STATUS_LABELS: Record<NormalizedStatusValue, string> = {
  unknown: "Unknown",
  offline: "Offline",
  idle: "Idle",
  queued: "Queued",
  active: "Active",
  starting: "Starting",
  planning: "Planning",
  thinking: "Thinking",
  reading: "Reading",
  researching: "Researching",
  coding: "Coding",
  running: "Using tools",
  reviewing: "Reviewing",
  waiting_for_user: "Waiting for you",
  blocked: "Blocked",
  completed: "Completed",
  failed: "Failed",
};

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

const DRAWER_FOCUSABLE_SELECTOR = [
  "button:not(:disabled)",
  "input:not(:disabled)",
  "select:not(:disabled)",
  "textarea:not(:disabled)",
  "a[href]",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function drawerFocusableControls(panel: HTMLElement): HTMLElement[] {
  return Array.from(
    panel.querySelectorAll<HTMLElement>(DRAWER_FOCUSABLE_SELECTOR),
  );
}

function TopDownProjectDrawer({
  project,
  projects,
  referenceTime,
  projectCountsById,
  attentionProjectGroupsById,
  currentProjectAttentionCounts,
  attentionReady,
  returnFocusRef,
  onClose,
  onEnter,
  onExit,
}: {
  project: OfficeProject;
  projects: OfficeProject[];
  referenceTime: number;
  projectCountsById?: ReadonlyMap<string, ProjectTaskCounts>;
  attentionProjectGroupsById?: ReadonlyMap<string, AttentionDigestGroup>;
  currentProjectAttentionCounts: Readonly<AttentionDigestCounts>;
  attentionReady: boolean;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onEnter: (id: string) => void;
  onExit: () => void;
}) {
  const [query, setQuery] = useState("");
  const panelRef = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleProjects = normalizedQuery
    ? projects.filter((item) =>
        formatVisibleProjectName(item)
          .toLocaleLowerCase()
          .includes(normalizedQuery),
      )
    : projects;

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;

    const appShell = document.querySelector<HTMLElement>(".app-shell");
    const previousInert = appShell?.inert ?? false;
    const previousInertAttribute = appShell?.getAttribute("inert") ?? null;
    const previousAriaHidden = appShell?.getAttribute("aria-hidden") ?? null;
    const returnFocusElement = returnFocusRef.current;

    if (appShell) {
      appShell.inert = true;
      appShell.setAttribute("aria-hidden", "true");
    }

    const focusInitialControl = () => {
      (searchRef.current ?? drawerFocusableControls(panel)[0] ?? panel).focus({
        preventScroll: true,
      });
    };
    focusInitialControl();

    const handleFocus = (event: FocusEvent) => {
      if (!panel.contains(event.target as Node)) focusInitialControl();
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      const controls = drawerFocusableControls(panel);
      if (!controls.length) {
        event.preventDefault();
        panel.focus();
        return;
      }

      const first = controls[0];
      const last = controls.at(-1)!;
      const active = document.activeElement;
      if (!panel.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("focusin", handleFocus);
    window.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("focusin", handleFocus);
      window.removeEventListener("keydown", handleKey);
      if (appShell) {
        appShell.inert = previousInert;
        if (previousInertAttribute === null) {
          appShell.removeAttribute("inert");
        } else {
          appShell.setAttribute("inert", previousInertAttribute);
        }
        if (previousAriaHidden === null) {
          appShell.removeAttribute("aria-hidden");
        } else {
          appShell.setAttribute("aria-hidden", previousAriaHidden);
        }
      }
      returnFocusElement?.focus({ preventScroll: true });
    };
  }, [onClose, returnFocusRef]);

  return (
    <aside
      ref={panelRef}
      id="project-door-rail"
      className={tdStyles.drawerPanel}
      role="dialog"
      aria-modal="true"
      aria-labelledby="project-drawer-heading"
      tabIndex={-1}
    >
      <header className={tdStyles.drawerHeader}>
        <div>
          <small>Workspace</small>
          <h2 id="project-drawer-heading">Projects</h2>
        </div>
        <button type="button" onClick={onClose} aria-label="Close projects">
          ×
        </button>
      </header>
      <input
        ref={searchRef}
        className={tdStyles.drawerSearch}
        type="search"
        value={query}
        onChange={(event) => setQuery(event.currentTarget.value)}
        placeholder="Search projects"
        aria-label="Search projects"
      />
      <div className={tdStyles.drawerList}>
        {visibleProjects.map((item) => {
          const counts =
            projectCountsById?.get(item.id) ??
            selectProjectTaskCounts(item.tasks);
          const signals = summarizeProjectSignals(item.tasks, referenceTime);
          const attentionCounts =
            attentionProjectGroupsById?.get(item.id)?.counts ??
            (item.id === project.id
              ? currentProjectAttentionCounts
              : EMPTY_ATTENTION_COUNTS);
          const selected = item.id === project.id;
          const displayName = formatVisibleProjectName(item);
          return (
            <button
              key={item.id}
              type="button"
              className={tdStyles.drawerProject}
              data-project-id={item.id}
              data-attention-count={
                attentionReady ? attentionCounts.total : "—"
              }
              data-needs-reply-count={
                attentionReady ? attentionCounts.needsReply : "—"
              }
              data-needs-decision-count={
                attentionReady ? attentionCounts.needsDecision : "—"
              }
              data-unread-result-count={
                attentionReady ? attentionCounts.unreadResults : "—"
              }
              aria-current={selected ? "page" : undefined}
              aria-label={`Open ${displayName}. ${item.tasks.length} agent${item.tasks.length === 1 ? "" : "s"}, ${counts.active} active. ${attentionReady ? `${countLabel(attentionCounts.total, "current action")}, ${repliesNeededLabel(attentionCounts.needsReply)}, ${decisionsNeededLabel(attentionCounts.needsDecision)}, ${countLabel(attentionCounts.unreadResults, "unread result")}.` : "Current actions not ready."} ${sessionLivenessAriaLabel(signals.liveness)}.`}
              onClick={() => {
                onEnter(item.id);
                onClose();
              }}
            >
              <span className={tdStyles.drawerMonogram} aria-hidden="true">
                {displayName.slice(0, 2).toLocaleUpperCase()}
              </span>
              <span className={tdStyles.drawerProjectName}>
                <strong title={item.name}>{displayName}</strong>
                <span>
                  {item.tasks.length} agents · {counts.active} active
                </span>
              </span>
              <span
                className={tdStyles.drawerProjectSignal}
                data-live={signals.liveCount > 0 ? "true" : undefined}
                data-has-attention={
                  attentionReady && attentionCounts.total > 0
                    ? "true"
                    : undefined
                }
              >
                <span className={tdStyles.drawerSignalTotal}>
                  <i aria-hidden="true" />
                  {!attentionReady
                    ? "Actions —"
                    : countLabel(attentionCounts.total, "action")}
                </span>
                {attentionReady ? (
                  <span className={tdStyles.drawerSignalDetails}>
                    {attentionCounts.needsReply > 0 ? (
                      <span className={tdStyles.drawerReplyCount}>
                        {repliesNeededLabel(attentionCounts.needsReply)}
                      </span>
                    ) : null}
                    {attentionCounts.needsDecision > 0 ? (
                      <span className={tdStyles.drawerDecisionCount}>
                        {decisionsNeededLabel(attentionCounts.needsDecision)}
                      </span>
                    ) : null}
                    {attentionCounts.unreadResults > 0 ? (
                      <span className={tdStyles.drawerUnreadCount}>
                        {attentionCounts.unreadResults} unread
                      </span>
                    ) : null}
                    {attentionCounts.total === 0 ? (
                      <span>{signals.liveCount > 0 ? "Live" : "Quiet"}</span>
                    ) : null}
                  </span>
                ) : null}
              </span>
            </button>
          );
        })}
        {!visibleProjects.length ? (
          <p className={tdStyles.drawerEmpty}>No projects match “{query}”.</p>
        ) : null}
      </div>
      <footer className={tdStyles.drawerFooter}>
        <button type="button" onClick={onExit}>
          View all projects
        </button>
      </footer>
    </aside>
  );
}

function TopDownProductOffice({
  project,
  projects,
  onExit,
  onEnterProject,
  referenceTime,
  projectCountsById,
  attentionProjectGroupsById,
  reviewWorkspace,
  workspace = EMPTY_WORKSPACE_CONTROLLER,
  codexActions,
}: PixelOfficeProps) {
  const requestedPlanTarget =
    reviewWorkspace?.requestedPlanTarget?.projectId === project.id
      ? reviewWorkspace.requestedPlanTarget
      : null;
  const requestedPlanProject =
    reviewWorkspace?.requestedPlanProjectId === project.id;
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [inspectorTaskId, setInspectorTaskId] = useState<string | null>(null);
  const [projectDrawerOpen, setProjectDrawerOpen] = useState(false);
  const [attentionOpen, setAttentionOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(
    Boolean(requestedPlanTarget || requestedPlanProject),
  );
  const [planTarget, setPlanTarget] = useState<VerificationTarget | null>(
    requestedPlanTarget,
  );
  const selectionFocusTarget = useRef<HTMLElement | null>(null);
  const projectsToggleRef = useRef<HTMLButtonElement | null>(null);
  const attentionToggleRef = useRef<HTMLButtonElement | null>(null);
  const planToggleRef = useRef<HTMLButtonElement | null>(null);
  const visibleTaskLabels = useMemo(
    () => selectVisibleTaskLabels(project.tasks),
    [project.tasks],
  );
  const liveTaskIds = useMemo(
    () => project.tasks.map((task) => task.id),
    [project.tasks],
  );
  const liveTaskLocations = useMemo(
    () =>
      new Map(
        projects.flatMap((candidate) =>
          candidate.tasks.map((task) => [task.id, candidate.id] as const),
        ),
      ),
    [projects],
  );
  const projectAttentionItems = useMemo(
    () =>
      (reviewWorkspace?.visibleAttentionItems ?? []).filter(
        (item) => item.projectId === project.id,
      ),
    [project.id, reviewWorkspace?.visibleAttentionItems],
  );
  const fallbackAttentionCounts = useMemo(
    () =>
      selectAttentionProjectProjection(
        projectAttentionItems,
        [{ id: project.id, name: project.name }],
        reviewWorkspace?.controller.dispositionFor,
      ).byProjectId.get(project.id)?.counts ?? EMPTY_ATTENTION_COUNTS,
    [
      project.id,
      project.name,
      projectAttentionItems,
      reviewWorkspace?.controller.dispositionFor,
    ],
  );
  const workers = useMemo(
    () =>
      bindTopDownRoster(project.tasks, visibleTaskLabels, {
        projectId: project.id,
        attentionItems: projectAttentionItems,
      }),
    [project.id, project.tasks, projectAttentionItems, visibleTaskLabels],
  );
  const workerById = useMemo(
    () => new Map(workers.map((worker) => [worker.taskId, worker])),
    [workers],
  );
  const requestedTaskId =
    reviewWorkspace?.requestedTask?.projectId === project.id &&
    project.tasks.some(
      (task) => task.id === reviewWorkspace.requestedTask?.taskId,
    )
      ? reviewWorkspace.requestedTask.taskId
      : null;
  const onOpenReviewTask = reviewWorkspace?.onOpenTask;
  const onReviewRequestHandled = reviewWorkspace?.onRequestHandled;
  const onPlanRequestHandled = reviewWorkspace?.onPlanRequestHandled;
  const activeSelectedTaskId = requestedTaskId ?? selectedTaskId;
  const selectedTask = project.tasks.find(
    (task) => task.id === activeSelectedTaskId,
  );
  const activeInspectorTaskId = requestedTaskId ?? inspectorTaskId;
  const inspectorTask = project.tasks.find(
    (task) => task.id === activeInspectorTaskId,
  );
  const inspectorVerificationProjectId = inspectorTask
    ? verificationProjectForTask(workspace, project, inspectorTask)
    : project.id;
  const counts =
    projectCountsById?.get(project.id) ??
    selectProjectTaskCounts(project.tasks);
  const activeObjective = selectActiveObjective(
    selectWorkspaceProject(workspace.workspace, project.id),
  );
  const displayProjectName = formatVisibleProjectName(project);
  const attentionReady = Boolean(reviewWorkspace?.controller.ready);
  const attentionCounts =
    attentionProjectGroupsById?.get(project.id)?.counts ??
    fallbackAttentionCounts;

  const closeProjectDrawer = useCallback(() => {
    setProjectDrawerOpen(false);
  }, []);
  const closeAttention = useCallback(() => {
    setAttentionOpen(false);
    window.requestAnimationFrame(() => attentionToggleRef.current?.focus());
  }, []);
  const closePlan = useCallback(() => {
    setPlanOpen(false);
    setPlanTarget(null);
    window.requestAnimationFrame(() => planToggleRef.current?.focus());
  }, []);
  const closeInspector = useCallback(() => {
    const requestedFocusTarget = selectionFocusTarget.current;
    const focusTarget = requestedFocusTarget?.isConnected
      ? requestedFocusTarget
      : attentionToggleRef.current;
    if (requestedTaskId) {
      setSelectedTaskId(requestedTaskId);
      onReviewRequestHandled?.(requestedTaskId);
    }
    setInspectorTaskId(null);
    window.requestAnimationFrame(() => focusTarget?.focus());
  }, [onReviewRequestHandled, requestedTaskId]);

  useEffect(() => {
    if (!requestedPlanTarget && !requestedPlanProject) return;
    const frame = window.requestAnimationFrame(() => {
      setAttentionOpen(false);
      setProjectDrawerOpen(false);
      setInspectorTaskId(null);
      setPlanTarget(requestedPlanTarget ?? null);
      setPlanOpen(true);
      onPlanRequestHandled?.(project.id);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [
    onPlanRequestHandled,
    project.id,
    requestedPlanProject,
    requestedPlanTarget,
  ]);
  const selectTask = useCallback(
    (taskId: string, focusTarget: HTMLElement | null) => {
      selectionFocusTarget.current = focusTarget;
      if (requestedTaskId) onReviewRequestHandled?.(requestedTaskId);
      setSelectedTaskId(taskId);
    },
    [onReviewRequestHandled, requestedTaskId],
  );
  const openTaskInspector = useCallback(
    (taskId: string, focusTarget: HTMLElement | null) => {
      selectionFocusTarget.current = focusTarget;
      if (requestedTaskId) onReviewRequestHandled?.(requestedTaskId);
      setSelectedTaskId(taskId);
      setInspectorTaskId(taskId);
    },
    [onReviewRequestHandled, requestedTaskId],
  );
  const openLiveTaskFromPlan = useCallback(
    (targetProjectId: string, taskId: string) => {
      selectionFocusTarget.current = planToggleRef.current;
      setPlanOpen(false);
      setPlanTarget(null);
      if (targetProjectId === project.id) {
        setSelectedTaskId(taskId);
        setInspectorTaskId(taskId);
      } else {
        onOpenReviewTask?.(targetProjectId, taskId);
      }
    },
    [onOpenReviewTask, project.id],
  );

  useEffect(() => {
    if (!inspectorTaskId || inspectorTask || requestedTaskId) return;
    const requestedFocusTarget = selectionFocusTarget.current;
    const focusTarget = requestedFocusTarget?.isConnected
      ? requestedFocusTarget
      : attentionToggleRef.current;
    const frame = window.requestAnimationFrame(() => {
      setInspectorTaskId(null);
      focusTarget?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [inspectorTask, inspectorTaskId, requestedTaskId]);
  const dialogOpen = Boolean(
    planOpen || (reviewWorkspace && (attentionOpen || inspectorTask)),
  );

  return (
    <>
      <section
        className={tdStyles.productOffice}
        aria-labelledby="pixel-office-heading"
        aria-hidden={dialogOpen ? true : undefined}
        inert={dialogOpen ? true : undefined}
        data-product-office-renderer="topdown"
        data-project-id={project.id}
      >
        <p
          className={tdStyles.selectionAnnouncement}
          role="status"
          aria-live="polite"
        >
          {selectedTask
            ? `Selected ${visibleTaskLabels.get(selectedTask.id) ?? formatVisibleTaskName(selectedTask)}. ${STATUS_LABELS[selectedTask.status.value]}.${inspectorTask ? " Inspector open." : ""}`
            : ""}
        </p>
        <header className={tdStyles.topbar} data-office-hud="true">
          <button
            type="button"
            className={tdStyles.backButton}
            onClick={onExit}
          >
            ← Back
          </button>
          <button
            ref={projectsToggleRef}
            type="button"
            className={tdStyles.projectsButton}
            onClick={() => {
              setAttentionOpen(false);
              setPlanOpen(false);
              setProjectDrawerOpen((current) => !current);
            }}
            aria-controls="project-door-rail"
            aria-expanded={projectDrawerOpen}
          >
            Projects
          </button>
          <div className={tdStyles.title}>
            <small>
              {project.holding ? "Session lounge" : "Project office"}
            </small>
            <h1 id="pixel-office-heading" title={project.name}>
              {displayProjectName}
            </h1>
            <p title={activeObjective?.title}>
              {project.holding
                ? "Unassigned current tasks"
                : (activeObjective?.title ?? "No objective yet")}
            </p>
          </div>
          <button
            ref={planToggleRef}
            type="button"
            className={tdStyles.planButton}
            disabled={!workspace.ready}
            onClick={() => {
              setProjectDrawerOpen(false);
              setAttentionOpen(false);
              setInspectorTaskId(null);
              setPlanOpen((current) => !current);
            }}
            aria-controls="work-planner-dialog"
            aria-expanded={planOpen}
          >
            Plan
          </button>
          <button
            ref={attentionToggleRef}
            type="button"
            className={reviewStyles.attentionToggle}
            disabled={!reviewWorkspace?.controller.ready}
            data-project-id={project.id}
            data-attention-count={attentionReady ? attentionCounts.total : "—"}
            data-needs-reply-count={
              attentionReady ? attentionCounts.needsReply : "—"
            }
            data-needs-decision-count={
              attentionReady ? attentionCounts.needsDecision : "—"
            }
            data-unread-result-count={
              attentionReady ? attentionCounts.unreadResults : "—"
            }
            data-has-attention={
              attentionReady && attentionCounts.total > 0 ? "true" : undefined
            }
            onClick={() => {
              setProjectDrawerOpen(false);
              setPlanOpen(false);
              if (requestedTaskId) {
                setSelectedTaskId(requestedTaskId);
                onReviewRequestHandled?.(requestedTaskId);
              }
              setInspectorTaskId(null);
              selectionFocusTarget.current = attentionToggleRef.current;
              setAttentionOpen((current) => !current);
            }}
            aria-controls="attention-inbox"
            aria-expanded={attentionOpen}
            aria-label={
              attentionReady
                ? `Attention for ${displayProjectName}, ${countLabel(attentionCounts.total, "action")}, ${repliesNeededLabel(attentionCounts.needsReply)}, ${decisionsNeededLabel(attentionCounts.needsDecision)}, ${countLabel(attentionCounts.unreadResults, "unread result")}`
                : `Attention for ${displayProjectName} is loading`
            }
          >
            <span className={reviewStyles.attentionToggleLabel}>Attention</span>
            <span
              className={reviewStyles.attentionBadgeGroup}
              aria-hidden="true"
            >
              <span className={reviewStyles.attentionBadge}>
                {attentionReady ? attentionCounts.total : "—"}
              </span>
              {attentionReady && attentionCounts.needsReply > 0 ? (
                <span className={reviewStyles.attentionReplyBadge}>
                  <b>{attentionCounts.needsReply}</b>{" "}
                  {attentionCounts.needsReply === 1
                    ? "reply needed"
                    : "replies needed"}
                </span>
              ) : null}
              {attentionReady && attentionCounts.needsDecision > 0 ? (
                <span className={reviewStyles.attentionDecisionBadge}>
                  <b>{attentionCounts.needsDecision}</b>{" "}
                  {attentionCounts.needsDecision === 1
                    ? "decision needed"
                    : "decisions needed"}
                </span>
              ) : null}
              {attentionReady && attentionCounts.unreadResults > 0 ? (
                <span className={reviewStyles.attentionUnreadBadge}>
                  <b>{attentionCounts.unreadResults}</b> unread
                </span>
              ) : null}
            </span>
          </button>
          <div className={tdStyles.summary} aria-label="Office summary">
            <span>
              <strong>{project.tasks.length}</strong> agents
            </span>
            <span>
              <strong>{counts.active}</strong> active
            </span>
          </div>
        </header>

        <div className={tdStyles.body}>
          <main className={tdStyles.viewport} data-office-viewport="true">
            <TopDownOffice
              key={project.id}
              roomId={project.id}
              workers={workers}
              selectedTaskId={activeSelectedTaskId}
              onSelectTask={selectTask}
            />
          </main>
        </div>

        <footer
          className={tdStyles.roster}
          data-staff-dock="true"
          aria-label="Agent roster"
        >
          <strong className={tdStyles.rosterTitle}>Agents</strong>
          <div>
            {project.tasks.map((task) => {
              const worker = workerById.get(task.id);
              return (
                <button
                  key={task.id}
                  type="button"
                  className={tdStyles.rosterButton}
                  onClick={(event) =>
                    openTaskInspector(task.id, event.currentTarget)
                  }
                  aria-pressed={activeSelectedTaskId === task.id}
                  aria-label={`Review ${visibleTaskLabels.get(task.id) ?? formatVisibleTaskName(task)}, ${STATUS_LABELS[task.status.value]}`}
                >
                  <AvatarSprite
                    identity={
                      worker?.visualIdentity ??
                      stableTopDownVisualIdentity(task.id)
                    }
                    className={tdStyles.rosterAvatar}
                  />
                  <span className={tdStyles.rosterText}>
                    <strong>
                      {visibleTaskLabels.get(task.id) ??
                        formatVisibleTaskName(task)}
                    </strong>
                    <span>{STATUS_LABELS[task.status.value]}</span>
                  </span>
                </button>
              );
            })}
            {!project.tasks.length ? <span>No agents reported</span> : null}
          </div>
        </footer>
      </section>

      {typeof document !== "undefined" && projectDrawerOpen
        ? createPortal(
            <>
              <button
                type="button"
                className={tdStyles.drawerBackdrop}
                onClick={closeProjectDrawer}
                tabIndex={-1}
                aria-hidden="true"
              />
              <div className={tdStyles.drawer}>
                <TopDownProjectDrawer
                  project={project}
                  projects={projects}
                  referenceTime={referenceTime}
                  attentionProjectGroupsById={attentionProjectGroupsById}
                  currentProjectAttentionCounts={attentionCounts}
                  attentionReady={attentionReady}
                  onClose={closeProjectDrawer}
                  onEnter={onEnterProject}
                  onExit={onExit}
                  projectCountsById={projectCountsById}
                  returnFocusRef={projectsToggleRef}
                />
              </div>
            </>,
            document.body,
          )
        : null}

      {typeof document !== "undefined" && attentionOpen && reviewWorkspace
        ? createPortal(
            <>
              <button
                type="button"
                className={reviewStyles.dialogBackdrop}
                onClick={closeAttention}
                tabIndex={-1}
                aria-hidden="true"
              />
              <AttentionInboxPanel
                items={projectAttentionItems}
                initializedAt={reviewWorkspace.controller.initializedAt}
                persistent={reviewWorkspace.controller.persistent}
                referenceTime={referenceTime}
                scopeLabel={displayProjectName}
                scopeProjectId={project.id}
                onOpenItem={(item) => {
                  if (item.projectId !== project.id) return;
                  if (
                    item.verificationTarget &&
                    item.verificationTarget.projectId !== project.id
                  ) {
                    return;
                  }
                  if (!item.openTaskId && !item.verificationTarget) return;
                  void reviewWorkspace.controller
                    .markSeen(item.eventKey)
                    .catch(() => undefined);
                  setAttentionOpen(false);
                  setProjectDrawerOpen(false);
                  selectionFocusTarget.current = attentionToggleRef.current;
                  if (item.openTaskId) {
                    onOpenReviewTask?.(project.id, item.openTaskId);
                  } else if (item.verificationTarget) {
                    setPlanTarget(item.verificationTarget);
                    setPlanOpen(true);
                    onPlanRequestHandled?.(project.id);
                  }
                }}
                onReviewItem={reviewWorkspace.controller.markReviewed}
                onDismissItem={reviewWorkspace.controller.dismiss}
                onSnoozeItem={(eventKey) =>
                  reviewWorkspace.controller.snooze(eventKey, 60 * 60 * 1000)
                }
                onClose={closeAttention}
              />
            </>,
            document.body,
          )
        : null}
      {typeof document !== "undefined" && planOpen
        ? createPortal(
            <>
              <button
                type="button"
                className={reviewStyles.dialogBackdrop}
                onClick={closePlan}
                tabIndex={-1}
                aria-hidden="true"
              />
              <WorkPlannerPanel
                key={project.id}
                project={{ ...project, liveTaskIds, liveTaskLocations }}
                controller={workspace}
                focusTarget={planTarget}
                onOpenLiveTask={
                  reviewWorkspace ? openLiveTaskFromPlan : undefined
                }
                onClose={closePlan}
              />
            </>,
            document.body,
          )
        : null}
      {typeof document !== "undefined" && inspectorTask && reviewWorkspace
        ? createPortal(
            <>
              <button
                type="button"
                className={reviewStyles.dialogBackdrop}
                onClick={closeInspector}
                tabIndex={-1}
                aria-hidden="true"
              />
              {reviewWorkspace.verificationProjectScoped ? (
                <VerificationAwareInspector
                  key={inspectorTask.id}
                  task={inspectorTask}
                  project={project}
                  referenceTime={referenceTime}
                  displayName={
                    visibleTaskLabels.get(inspectorTask.id) ??
                    formatVisibleTaskName(inspectorTask)
                  }
                  review={reviewWorkspace.controller}
                  workspace={workspace}
                  actions={codexActions}
                  verificationProjectId={inspectorVerificationProjectId}
                  visibleVerifications={reviewWorkspace.verifications}
                  onClose={closeInspector}
                />
              ) : (
                <ReviewActInspector
                  key={inspectorTask.id}
                  task={inspectorTask}
                  project={project}
                  referenceTime={referenceTime}
                  displayName={
                    visibleTaskLabels.get(inspectorTask.id) ??
                    formatVisibleTaskName(inspectorTask)
                  }
                  review={reviewWorkspace.controller}
                  workspace={workspace}
                  actions={codexActions}
                  verifications={reviewWorkspace.verifications}
                  onClose={closeInspector}
                />
              )}
            </>,
            document.body,
          )
        : null}
    </>
  );
}

export function PixelOffice(props: PixelOfficeProps) {
  return <TopDownProductOffice {...props} />;
}
