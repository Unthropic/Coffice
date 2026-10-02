"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";

import {
  attentionEventKey,
  createAttentionItem,
  type AttentionItem,
  type AttentionProject,
  type AttentionTask,
} from "../lib/attention-inbox";
import { buildFailedCheckRepairFollowUpContext } from "../lib/failed-check-repair-context";
import { buildCurrentPlanFollowUpContext } from "../lib/follow-up-context";
import type {
  CodexApprovalDecision,
  CodexPendingRequest,
} from "../lib/codex-app-server";
import type { AttentionReviewController } from "./use-attention-review-state";
import {
  codexOperationNotice,
  type CodexActionsController,
} from "./use-codex-actions";
import type { CofficeWorkspaceController } from "./use-coffice-workspace";
import { DecisionRequestsCard } from "./decision-requests";
import {
  selectActiveProjectDecisions,
  selectReviewAssessment,
  type ProjectDecisionEvent,
  type ReviewAssessmentTarget,
  type CodexResultCycle,
  type CodexResultKey,
  type CodexTaskAttempt,
  type VerificationCheckReceipt,
  type VerificationReceipt,
  type VerificationTarget,
} from "../lib/coffice-workspace";
import {
  ReviewAssessmentCard,
  unresolvedReviewAssessmentCount,
} from "./review-assessment";
import {
  selectSavedResultComparison,
  selectSavedResultComparisonPair,
  type SavedResultEvidenceBinding,
  type SavedResultEvidencePresentation,
} from "../lib/saved-result-comparison";
import {
  projectQualityBarReadiness,
  type ProjectQualityBarReadiness,
} from "../lib/project-quality-bars";
import {
  selectLatestClosedTaskWorkContext,
  selectOpenTaskWorkContext,
  selectTaskWorkContexts,
} from "./task-work-context";
import type {
  VerificationReceiptView,
  VerificationsController,
} from "./use-verifications";
import styles from "./review-workspace.module.css";

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
const EMPTY_PROJECT_DECISION_EVENTS: readonly ProjectDecisionEvent[] = [];

function PendingCodexRequestPanel({
  request,
  actions,
  displayName,
}: {
  request: CodexPendingRequest;
  actions: CodexActionsController;
  displayName: string;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [decision, setDecision] = useState<CodexApprovalDecision | null>(null);
  const [confirmingAnswers, setConfirmingAnswers] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const headingId = useId();
  const formId = useId();
  const firstControlRef = useRef<HTMLElement | null>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const responseLabel =
    decision === "accept"
      ? "Allow once"
      : decision === "decline"
        ? "Decline request"
        : "Stop turn";
  const clarificationReady =
    request.kind === "clarification" &&
    request.questions.every((question) => answers[question.id]?.trim());
  const confirmOpen = Boolean(decision) || confirmingAnswers;

  useEffect(() => {
    const frame = window.requestAnimationFrame(() =>
      firstControlRef.current?.focus({ preventScroll: true }),
    );
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!confirmOpen) return;
    const frame = window.requestAnimationFrame(() =>
      backRef.current?.focus({ preventScroll: true }),
    );
    return () => window.cancelAnimationFrame(frame);
  }, [confirmOpen]);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setMessage("");
    let result;
    if (request.kind === "clarification") {
      const responseAnswers = Object.fromEntries(
        request.questions.map((question) => [
          question.id,
          [answers[question.id].trim()],
        ]),
      );
      const response = actions.respondToClarification?.(
        request.id,
        request.taskId,
        responseAnswers,
      );
      setAnswers({});
      result = await response;
    } else if (decision) {
      result = await actions.respondToApproval?.(
        request.id,
        request.taskId,
        decision,
      );
    }
    if (!result || result.state === "unknown") {
      setMessage(
        "Response confirmation was lost. Check the task in Codex before responding again.",
      );
      setBusy(false);
    }
  };

  return (
    <section
      className={styles.pendingRequest}
      aria-labelledby={headingId}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || busy || !confirmOpen) return;
        event.preventDefault();
        event.stopPropagation();
        setDecision(null);
        setConfirmingAnswers(false);
        window.requestAnimationFrame(() =>
          firstControlRef.current?.focus({ preventScroll: true }),
        );
      }}
    >
      <div className={styles.sectionHeading}>
        <h3 id={headingId}>Codex needs your response</h3>
        <span>One-time request</span>
      </div>
      <p>
        This request is shown only for {displayName}. Coffice does not save its
        contents or your response.
      </p>

      {confirmOpen ? (
        <div
          className={styles.actionConfirmation}
          role="group"
          aria-label="Confirm Codex response"
        >
          <small>Confirm response</small>
          <strong>{displayName}</strong>
          {request.kind === "clarification" ? (
            <ul className={styles.pendingAnswerReview}>
              {request.questions.map((question) => (
                <li key={question.id}>
                  <strong>{question.header}</strong>
                  <span>
                    {question.isSecret
                      ? "Secret answer entered"
                      : answers[question.id]}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p>
              Send “{responseLabel}” for this exact request. This response
              applies once and is not retried automatically if confirmation is
              lost.
            </p>
          )}
          <div className={styles.formActions}>
            <button
              type="button"
              disabled={busy || actions.available !== true}
              onClick={() => void submit()}
            >
              {busy ? "Sending…" : "Confirm response"}
            </button>
            <button
              ref={backRef}
              type="button"
              disabled={busy}
              onClick={() => {
                setDecision(null);
                setConfirmingAnswers(false);
                window.requestAnimationFrame(() =>
                  firstControlRef.current?.focus({ preventScroll: true }),
                );
              }}
            >
              Back
            </button>
          </div>
        </div>
      ) : request.kind === "clarification" ? (
        <form
          className={styles.pendingRequestForm}
          onSubmit={(event) => {
            event.preventDefault();
            if (clarificationReady) setConfirmingAnswers(true);
          }}
        >
          {request.questions.map((question, questionIndex) => (
            <fieldset key={question.id}>
              <legend>{question.header}</legend>
              <p>{question.question}</p>
              {question.options.map((option, optionIndex) => (
                <label key={`${optionIndex}-${option.label}`}>
                  <input
                    ref={(node) => {
                      if (questionIndex === 0 && optionIndex === 0)
                        firstControlRef.current = node;
                    }}
                    type="radio"
                    name={`${formId}-${questionIndex}`}
                    value={option.label}
                    checked={answers[question.id] === option.label}
                    onChange={(event) =>
                      setAnswers((current) => ({
                        ...current,
                        [question.id]: event.currentTarget.value,
                      }))
                    }
                  />
                  <span>
                    <strong>{option.label}</strong>
                    <small>{option.description}</small>
                  </span>
                </label>
              ))}
              {question.allowOther || question.options.length === 0 ? (
                <label>
                  {question.allowOther ? "Other answer" : "Your answer"}
                  {question.isSecret ? (
                    <input
                      ref={(node) => {
                        if (
                          questionIndex === 0 &&
                          question.options.length === 0
                        )
                          firstControlRef.current = node;
                      }}
                      type="password"
                      autoComplete="off"
                      value={answers[question.id] ?? ""}
                      onChange={(event) =>
                        setAnswers((current) => ({
                          ...current,
                          [question.id]: event.currentTarget.value,
                        }))
                      }
                    />
                  ) : (
                    <textarea
                      ref={(node) => {
                        if (
                          questionIndex === 0 &&
                          question.options.length === 0
                        )
                          firstControlRef.current = node;
                      }}
                      rows={3}
                      value={
                        question.options.some(
                          (option) => option.label === answers[question.id],
                        )
                          ? ""
                          : (answers[question.id] ?? "")
                      }
                      onChange={(event) =>
                        setAnswers((current) => ({
                          ...current,
                          [question.id]: event.currentTarget.value,
                        }))
                      }
                    />
                  )}
                </label>
              ) : null}
            </fieldset>
          ))}
          <div className={styles.formActions}>
            <button
              type="submit"
              disabled={!clarificationReady || actions.available !== true}
            >
              Review answers
            </button>
          </div>
        </form>
      ) : (
        <div className={styles.pendingApproval}>
          {request.kind === "command_approval" ? (
            <>
              <p>Codex is asking to run this exact command:</p>
              <pre tabIndex={0}>
                {request.command ?? "Command not reported"}
              </pre>
              {request.cwd ? (
                <p>
                  <strong>Working folder:</strong> {request.cwd}
                </p>
              ) : null}
              {request.environmentId ? (
                <p>
                  <strong>Environment:</strong> {request.environmentId}
                </p>
              ) : null}
              {request.reason ? <p>{request.reason}</p> : null}
              {request.network ? (
                <p>
                  <strong>Network:</strong> {request.network.protocol}://
                  {request.network.host}
                </p>
              ) : null}
              {request.requiresCodexReview ? (
                <p>
                  This request includes a persistent permission or policy
                  change. Review it in Codex; Coffice will not approve it.
                </p>
              ) : null}
            </>
          ) : (
            <>
              <p>
                Codex requested a file change, but Coffice did not receive the
                patch. You can decline it or stop the turn here; inspect it in
                Codex before approving any change.
              </p>
              {request.grantRoot ? <pre>{request.grantRoot}</pre> : null}
              {request.reason ? <p>{request.reason}</p> : null}
            </>
          )}
          <div className={styles.formActions}>
            {request.kind === "command_approval" && request.allowOnce ? (
              <button
                ref={(node) => {
                  firstControlRef.current = node;
                }}
                type="button"
                disabled={actions.available !== true}
                onClick={() => setDecision("accept")}
              >
                Review allow once
              </button>
            ) : null}
            {request.canDecline ? (
              <button
                ref={
                  request.kind !== "command_approval" || !request.allowOnce
                    ? (node) => {
                        firstControlRef.current = node;
                      }
                    : undefined
                }
                type="button"
                disabled={actions.available !== true}
                onClick={() => setDecision("decline")}
              >
                Review decline
              </button>
            ) : null}
            {request.canCancel ? (
              <button
                type="button"
                disabled={actions.available !== true}
                onClick={() => setDecision("cancel")}
              >
                Review stop turn
              </button>
            ) : null}
          </div>
        </div>
      )}
      <p className={styles.contextInsertStatus} role="status">
        {message ||
          (actions.available === false
            ? (actions.error ?? "Codex responses are unavailable.")
            : "")}
      </p>
    </section>
  );
}

interface ReviewTokenUsage {
  contextTokens: number;
  contextWindow: number;
}

type ReviewRepositoryAreaName =
  "Source" | "Tests" | "Docs" | "Config" | "Assets" | "Other";

interface ReviewRepositoryArea {
  area: ReviewRepositoryAreaName;
  files: number;
}

interface ReviewRepositoryDiffStats {
  trackedFiles: number;
  additions: number;
  deletions: number;
  binaryFiles: number;
  source: "git:diff-numstat";
}

interface ReviewUnavailableRepository {
  availability: "unavailable";
  source: "git";
  observedAt: string;
}

interface ReviewAvailableRepository {
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
    areas: readonly ReviewRepositoryArea[];
  };
  diffStats?: ReviewRepositoryDiffStats;
}

type ReviewRepository = ReviewUnavailableRepository | ReviewAvailableRepository;

interface ReviewRepositoryRoot {
  role: "primary" | "additional";
  evidence?: ReviewRepository;
  evidenceState: "fresh" | "refreshing" | "stale" | "unavailable";
}

export interface ReviewTask extends AttentionTask {
  kind: "staff" | "temporary";
  agentName?: string;
  model?: string;
  modelStale?: boolean;
  assignmentEvidence?:
    | "explicit_project"
    | "explicit_unassigned"
    | "explicit_unknown_project"
    | "cwd_fallback";
  assignmentSourceFresh?: boolean;
  startedAt?: string;
  tokenUsage?: ReviewTokenUsage;
  status: AttentionTask["status"] & {
    source?: string;
    confidence?: number;
  };
}

export interface ReviewProject extends AttentionProject {
  tasks: readonly ReviewTask[];
  repositoryRootCount?: number;
  repositoryCollectionState?: "bounded_out";
  repository?: ReviewRepository;
  repositoryRoots?: readonly ReviewRepositoryRoot[];
  repositoryEvidenceState?: "fresh" | "refreshing" | "stale" | "unavailable";
  holding?: boolean;
}

const KIND_LABELS: Record<AttentionItem["kind"], string> = {
  needs_input: "Reply needed",
  decision_needed: "Decision needed",
  task_failed: "Task failed",
  verification_failed: "Quality check failed",
  plan_link_mismatch: "Plan link needs attention",
  plan_link_orphaned: "Plan link needs attention",
  project_review_due: "Project review due",
  blocked: "Blocked",
  ready_for_review: "Ready for review",
};

const ACTIONABLE_TASK_STATUSES = new Set<ReviewTask["status"]["value"]>([
  "idle",
  "completed",
  "failed",
]);
const ACTIVE_OPERATION_STATES = new Set([
  "queued",
  "connecting",
  "sent",
  "running",
  "waiting",
]);
const LINK_DESTINATION_STATES = new Set(["planned", "in_progress", "blocked"]);

type LinkChangeMode = {
  action: "move" | "unlink";
  step: "choose" | "confirm";
  sourceAttemptId: string;
  sourceWasOpen: boolean;
  destination?: string;
};

function operationStatus(
  operation: ReturnType<CodexActionsController["latestOperationFor"]>,
): string | null {
  if (!operation) return null;
  const notice = codexOperationNotice(operation);
  if (notice === "user_action_required") {
    return "Codex needs your input, which Coffice cannot safely provide. Open the task in Codex.";
  }
  if (notice === "confirmation_lost") {
    return "Coffice lost confirmation. Check the task in Codex before retrying.";
  }
  if (
    operation.cancelRequestedAt &&
    ACTIVE_OPERATION_STATES.has(operation.state)
  ) {
    return "Stop requested. Waiting for Codex to report the final task state.";
  }
  switch (operation.state) {
    case "queued":
    case "connecting":
      return "Connecting to Codex…";
    case "sent":
    case "running":
      return operation.kind === "request_review"
        ? "Codex review is running."
        : operation.kind === "archive_task"
          ? "Archiving the task in Codex…"
          : "Codex is working on the follow-up.";
    case "completed":
      return operation.kind === "request_review"
        ? "Codex review completed. Open it to inspect the findings."
        : operation.kind === "archive_task"
          ? "Codex archived the task. It will leave active Coffice views after the source refreshes."
          : "Codex completed the follow-up.";
    case "failed":
      return operation.errorCode === "TASK_NOT_IDLE"
        ? "The task is busy. Wait for it to become idle, then try again."
        : "Codex did not complete this action. Review the task before retrying.";
    case "interrupted":
      return "The Codex action was interrupted. Review the task before retrying.";
  }
  return null;
}

function relativeTime(value: string | null | undefined, referenceTime: number) {
  if (!value) return "Time not reported";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "Time not reported";
  const delta = Math.max(0, referenceTime - timestamp);
  if (delta < 60_000) return "Just now";
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
  return `${Math.floor(delta / 86_400_000)}d ago`;
}

function compactTimestamp(value: string) {
  const date = new Date(value);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hour}:${minute} UTC`;
}

function qualityBarReadinessLabel(
  readiness: ProjectQualityBarReadiness["state"],
): string {
  if (readiness === "ready") return "Ready";
  if (readiness === "not_ready") return "Not ready";
  if (readiness === "unknown") return "Unknown";
  return "Not configured";
}

function qualityBarResultLabel(
  state: ProjectQualityBarReadiness["bars"][number]["state"],
): string {
  if (state === "not_run") return "Not run";
  if (state === "unknown") return "Outcome unknown";
  return `${state.charAt(0).toUpperCase()}${state.slice(1)}`;
}

function focusableControls(panel: HTMLElement): HTMLElement[] {
  return Array.from(
    panel.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], summary, [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((control) => control.getClientRects().length > 0);
}

export function useDialogKeyboard(
  panelRef: React.RefObject<HTMLElement | null>,
  onClose: () => void,
) {
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const appShell = document.querySelector<HTMLElement>(".app-shell");
    const appShellWasInert = appShell?.inert ?? false;
    const previousAriaHidden = appShell?.getAttribute("aria-hidden") ?? null;
    if (appShell) {
      appShell.inert = true;
      appShell.setAttribute("aria-hidden", "true");
    }
    const preferred = panel.querySelector<HTMLElement>(
      "[data-dialog-initial-focus]",
    );
    const initialControls = focusableControls(panel);
    const initialFocus =
      preferred && initialControls.includes(preferred)
        ? preferred
        : initialControls[0];
    initialFocus?.focus({ preventScroll: true });

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const controls = focusableControls(panel);
      if (!controls.length) return;
      const first = controls[0];
      const last = controls.at(-1)!;
      if (!panel.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("keydown", handleKey);
      if (appShell) {
        appShell.inert = appShellWasInert;
        if (previousAriaHidden === null) {
          appShell.removeAttribute("aria-hidden");
        } else {
          appShell.setAttribute("aria-hidden", previousAriaHidden);
        }
      }
    };
  }, [panelRef]);
}

export function AttentionInboxPanel({
  items,
  initializedAt,
  persistent,
  referenceTime,
  scopeLabel,
  scopeProjectId,
  onOpenItem,
  onReviewItem,
  onDismissItem,
  onSnoozeItem,
  onClose,
}: {
  items: readonly AttentionItem[];
  initializedAt: string | null;
  persistent: boolean;
  referenceTime: number;
  scopeLabel?: string;
  scopeProjectId?: string;
  onOpenItem: (item: AttentionItem) => void;
  onReviewItem?: (eventKey: string) => Promise<boolean>;
  onDismissItem?: (eventKey: string) => void;
  onSnoozeItem?: (eventKey: string) => void;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const reviewStatusRef = useRef<HTMLParagraphElement>(null);
  const [reviewingEventKey, setReviewingEventKey] = useState<string | null>(
    null,
  );
  const [reviewMessage, setReviewMessage] = useState<string | null>(null);
  useDialogKeyboard(panelRef, onClose);

  const markVerificationReviewed = async (eventKey: string) => {
    if (!onReviewItem || reviewingEventKey) return;
    setReviewingEventKey(eventKey);
    setReviewMessage("Saving review choice…");
    window.requestAnimationFrame(() =>
      reviewStatusRef.current?.focus({ preventScroll: true }),
    );
    let saved = false;
    try {
      saved = await onReviewItem(eventKey);
    } catch {
      saved = false;
    }
    setReviewingEventKey(null);
    setReviewMessage(
      saved
        ? "Quality-check alert marked reviewed."
        : "The quality-check alert was not marked reviewed because its Attention receipt was not saved.",
    );
    window.requestAnimationFrame(() =>
      reviewStatusRef.current?.focus({ preventScroll: true }),
    );
  };

  return (
    <aside
      ref={panelRef}
      id="attention-inbox"
      className={styles.attentionPanel}
      role="dialog"
      aria-modal="true"
      aria-labelledby="attention-inbox-heading"
      data-attention-inbox="true"
      data-attention-scope-project-id={scopeProjectId}
    >
      <header className={styles.panelHeader}>
        <div>
          <small>{scopeLabel ? "Project attention" : "Command center"}</small>
          <h2 id="attention-inbox-heading">
            {scopeLabel ? `${scopeLabel} attention` : "Attention"}
          </h2>
        </div>
        <span
          className={styles.headerCount}
          aria-label={`${items.length} item${items.length === 1 ? "" : "s"}`}
        >
          {items.length}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close attention inbox"
        >
          ×
        </button>
      </header>

      <p className={styles.panelIntro}>
        {scopeLabel
          ? `Only current observed actions for ${scopeLabel}.`
          : "Only observed results, failures, blockers, and requests for your input."}
      </p>

      {!persistent ? (
        <p className={styles.storageWarning} role="status">
          Review choices cannot be saved because the local Coffice workspace is
          unavailable.
        </p>
      ) : null}

      {reviewMessage ? (
        <p
          ref={reviewStatusRef}
          className={styles.attentionActionStatus}
          role="status"
          tabIndex={-1}
        >
          {reviewMessage}
        </p>
      ) : null}

      <div className={styles.attentionList}>
        {items.map((item, index) => {
          const content = (
            <>
              <span className={styles.itemTopline}>
                <strong>{KIND_LABELS[item.kind]}</strong>
                <time dateTime={item.occurredAt ?? undefined}>
                  {item.kind === "plan_link_mismatch" ||
                  item.kind === "plan_link_orphaned"
                    ? "Assignment time not reported"
                    : relativeTime(item.occurredAt, referenceTime)}
                </time>
              </span>
              <span className={styles.itemTitle}>{item.taskTitle}</span>
              <span className={styles.itemProject}>{item.projectName}</span>
              <span className={styles.itemReason}>{item.reason}</span>
              <span className={styles.itemAction}>
                {item.recommendedAction} <i aria-hidden="true">→</i>
              </span>
            </>
          );
          return item.kind === "verification_failed" ? (
            <article
              key={item.eventKey}
              className={styles.attentionReceiptItem}
              data-attention-item={item.kind}
            >
              <button
                type="button"
                className={styles.attentionItem}
                data-dialog-initial-focus={index === 0 ? "true" : undefined}
                onClick={() => onOpenItem(item)}
              >
                {content}
              </button>
              <div
                className={styles.attentionItemActions}
                aria-label={`Review options for ${item.taskTitle}`}
              >
                <button
                  type="button"
                  data-dialog-initial-focus={undefined}
                  disabled={
                    !persistent || !onReviewItem || Boolean(reviewingEventKey)
                  }
                  onClick={() => void markVerificationReviewed(item.eventKey)}
                >
                  {reviewingEventKey === item.eventKey
                    ? "Saving…"
                    : "Mark reviewed"}
                </button>
                <button
                  type="button"
                  disabled={
                    !persistent || !onSnoozeItem || Boolean(reviewingEventKey)
                  }
                  onClick={() => onSnoozeItem?.(item.eventKey)}
                >
                  Snooze 1 hour
                </button>
                <button
                  type="button"
                  disabled={
                    !persistent || !onDismissItem || Boolean(reviewingEventKey)
                  }
                  onClick={() => onDismissItem?.(item.eventKey)}
                >
                  Dismiss
                </button>
              </div>
            </article>
          ) : (
            <button
              key={item.eventKey}
              type="button"
              className={styles.attentionItem}
              data-attention-item={item.kind}
              data-dialog-initial-focus={index === 0 ? "true" : undefined}
              onClick={() => onOpenItem(item)}
            >
              {content}
            </button>
          );
        })}
        {!items.length ? (
          <div className={styles.attentionEmpty}>
            <span aria-hidden="true">✓</span>
            <h3>{scopeLabel ? "No current actions" : "All caught up"}</h3>
            <p>
              {scopeLabel
                ? `${scopeLabel} has no current Attention items.`
                : "New completed results and current observed problems will appear here."}
            </p>
          </div>
        ) : null}
      </div>

      {initializedAt ? (
        <p className={styles.baselineNote}>
          Inbox started {relativeTime(initializedAt, referenceTime)}. Older
          completed results remain available from their desks without flooding
          this queue.
        </p>
      ) : null}
    </aside>
  );
}

function contextPercent(task: ReviewTask): number | null {
  if (!task.tokenUsage?.contextWindow) return null;
  return Math.round(
    Math.min(
      1,
      Math.max(
        0,
        task.tokenUsage.contextTokens / task.tokenUsage.contextWindow,
      ),
    ) * 100,
  );
}

function resultSummary(task: ReviewTask, candidate: AttentionItem | null) {
  if (candidate?.kind === "ready_for_review") {
    return "Codex reports that this result completed. A privacy-safe result summary is not reported by the current metadata source.";
  }
  return "A privacy-safe result summary is not reported by the current metadata source.";
}

function recommendedAction(
  task: ReviewTask,
  candidate: AttentionItem | null,
): string {
  if (candidate?.kind === "ready_for_review") {
    return "Open the completed result in Codex, review it, then mark this result reviewed here.";
  }
  switch (task.status.value) {
    case "waiting_for_user":
      return "Open the task in Codex and provide the requested decision or clarification.";
    case "failed":
      return "Open the task in Codex, inspect the failure, and decide whether to retry or redirect it.";
    case "blocked":
      return "Open the task in Codex and provide the information or direction needed to unblock it.";
    default:
      return "Open the task in Codex to review its current work and choose the next instruction.";
  }
}

const REPOSITORY_AREA_LABELS: Record<ReviewRepositoryAreaName, string> = {
  Source: "Source",
  Tests: "Tests",
  Docs: "Docs",
  Config: "Config",
  Assets: "Assets",
  Other: "Other",
};

const REPOSITORY_STATE_LABELS: Record<
  "fresh" | "refreshing" | "stale" | "unavailable",
  string
> = {
  fresh: "Fresh",
  refreshing: "Refreshing",
  stale: "Stale",
  unavailable: "Unavailable",
};

function repositoryHeadline(repository: ReviewAvailableRepository): string {
  const revision =
    repository.headState === "unborn"
      ? "unborn"
      : (repository.headOid?.slice(0, 12) ?? "unknown");
  return `${repository.branch} @ ${revision}`;
}

function repositoryStats(repository: ReviewAvailableRepository): string[] {
  if (repository.clean) {
    return [
      "Clean working tree",
      ...(repository.ahead ? [`${repository.ahead} ahead`] : []),
      ...(repository.behind ? [`${repository.behind} behind`] : []),
    ];
  }
  return [
    `${repository.changedFiles} changed`,
    ...(repository.stagedFiles ? [`${repository.stagedFiles} staged`] : []),
    ...(repository.untrackedFiles
      ? [`${repository.untrackedFiles} untracked`]
      : []),
    ...(repository.conflictedFiles
      ? [`${repository.conflictedFiles} conflicted`]
      : []),
    ...(repository.ahead ? [`${repository.ahead} ahead`] : []),
    ...(repository.behind ? [`${repository.behind} behind`] : []),
  ];
}

function RepositoryEvidenceContents({
  repository,
  evidenceState,
  eyebrow,
  title,
  referenceTime,
  unavailableSubject,
  showAttribution = false,
  accessibleRootLabel,
}: {
  repository: ReviewRepository | undefined;
  evidenceState: "fresh" | "refreshing" | "stale" | "unavailable";
  eyebrow: string;
  title: string;
  referenceTime: number;
  unavailableSubject: "repository" | "saved root";
  showAttribution?: boolean;
  accessibleRootLabel?: string;
}) {
  const available =
    repository?.availability === "available" ? repository : null;

  return (
    <>
      <div className={styles.repositoryCardHeader}>
        <div>
          <span>{eyebrow}</span>
          <strong>{title}</strong>
        </div>
        <b>{REPOSITORY_STATE_LABELS[evidenceState]}</b>
      </div>
      {showAttribution ? (
        <p className={styles.repositoryAttribution}>
          Not attributed to this task or result. Task-level changed files: Not
          reported per task.
        </p>
      ) : null}

      {available ? (
        <>
          <div className={styles.repositoryHeadline}>
            <strong title={available.headOid ?? undefined}>
              {repositoryHeadline(available)}
            </strong>
            <span>{available.clean ? "Clean" : "Dirty"}</span>
          </div>
          <ul
            className={styles.repositoryStats}
            aria-label={
              accessibleRootLabel
                ? `${accessibleRootLabel} repository totals`
                : "Repository totals"
            }
          >
            {repositoryStats(available).map((stat) => (
              <li key={stat}>{stat}</li>
            ))}
          </ul>
          {evidenceState === "refreshing" ? (
            <p className={styles.repositoryCaution} role="status">
              Refreshing now; showing the last observed repository snapshot.
            </p>
          ) : evidenceState === "stale" ? (
            <p className={styles.repositoryCaution} role="status">
              This repository snapshot is stale and may no longer match disk.
            </p>
          ) : null}

          <details className={styles.repositoryDetails}>
            <summary
              aria-label={
                accessibleRootLabel
                  ? `${accessibleRootLabel} repository details`
                  : undefined
              }
            >
              Repository details
            </summary>
            <div className={styles.repositoryAreaList}>
              {available.changeAreas.areas.length ? (
                available.changeAreas.areas.map((area) => (
                  <span key={area.area}>
                    {REPOSITORY_AREA_LABELS[area.area]} {area.files}
                  </span>
                ))
              ) : (
                <span>
                  {available.changeAreas.totalFiles
                    ? "No summarized areas"
                    : "No changed areas"}
                </span>
              )}
              {available.changeAreas.omittedFiles ? (
                <span>
                  {available.changeAreas.omittedFiles}{" "}
                  {available.changeAreas.omittedFiles === 1 ? "file" : "files"}{" "}
                  omitted
                </span>
              ) : null}
            </div>
            <dl className={styles.repositoryMetadata}>
              <div>
                <dt>Coverage</dt>
                <dd>
                  {available.changeAreas.summarizedFiles} of{" "}
                  {available.changeAreas.totalFiles} files summarized
                </dd>
              </div>
              <div>
                <dt>Diff</dt>
                <dd>
                  {available.diffStats
                    ? `${available.diffStats.trackedFiles} tracked · +${available.diffStats.additions} −${available.diffStats.deletions}${available.diffStats.binaryFiles ? ` · ${available.diffStats.binaryFiles} binary` : ""}`
                    : "Diff stats unavailable"}
                </dd>
              </div>
              <div>
                <dt>Observed</dt>
                <dd>
                  <time dateTime={available.observedAt}>
                    {relativeTime(available.observedAt, referenceTime)}
                  </time>
                </dd>
              </div>
              <div>
                <dt>Source</dt>
                <dd
                  title={`${available.source}${available.diffStats ? ` · ${available.diffStats.source}` : ""}`}
                >
                  Privacy-isolated Git status
                  {available.diffStats ? " · Git diff totals" : ""}
                </dd>
              </div>
            </dl>
          </details>
        </>
      ) : (
        <p className={styles.repositoryUnavailable} role="status">
          {evidenceState === "refreshing"
            ? "Git evidence is refreshing; no previous repository snapshot is available."
            : `Privacy-safe Git evidence is unavailable for this ${unavailableSubject}.`}
          {repository?.observedAt ? (
            <small>
              Last checked {relativeTime(repository.observedAt, referenceTime)}.
            </small>
          ) : null}
        </p>
      )}
    </>
  );
}

function RepositoryEvidenceCard({
  project,
  referenceTime,
}: {
  project: ReviewProject;
  referenceTime: number;
}) {
  if (project.holding) {
    return (
      <article
        className={styles.repositoryCard}
        data-repository-evidence-state="unavailable"
      >
        <div className={styles.repositoryCardHeader}>
          <div>
            <span>Project Git evidence</span>
            <strong>No saved project root</strong>
          </div>
          <b>Not assigned</b>
        </div>
        <p className={styles.repositoryUnavailable} role="status">
          This task is in projectless intake, so there is no project root to
          inspect.
        </p>
      </article>
    );
  }

  if (
    project.repositoryCollectionState === "bounded_out" &&
    project.repositoryRootCount !== undefined
  ) {
    return (
      <article
        className={styles.repositoryCard}
        data-repository-root-count={project.repositoryRootCount}
        data-repository-collection-state="bounded_out"
        data-repository-evidence-state="unavailable"
      >
        <div className={styles.repositoryCardHeader}>
          <div>
            <span>Project Git evidence</span>
            <strong>{project.repositoryRootCount} saved roots</strong>
          </div>
          <b>Unavailable</b>
        </div>
        <p className={styles.repositoryAttribution}>
          Not attributed to this task or result. Task-level changed files: Not
          reported per task.
        </p>
        <p className={styles.repositoryUnavailable} role="status">
          Git evidence is unavailable because the source-wide saved-root
          inventory exceeds the technical collection safety bound. No partial
          subset was inspected.
        </p>
      </article>
    );
  }

  const repositoryRootsPresent = project.repositoryRoots !== undefined;
  const repositoryRoots: readonly ReviewRepositoryRoot[] =
    project.repositoryRoots ??
    (project.repository
      ? [
          {
            role: "primary" as const,
            evidence: project.repository,
            evidenceState:
              project.repositoryEvidenceState ??
              (project.repository.availability === "available"
                ? "fresh"
                : "unavailable"),
          },
        ]
      : []);

  if (repositoryRoots.length <= 1) {
    const root = repositoryRoots[0];
    const repository = root?.evidence;
    const evidenceState = repositoryRootsPresent
      ? (root?.evidenceState ?? "unavailable")
      : (root?.evidenceState ??
        project.repositoryEvidenceState ??
        (repository?.availability === "available" ? "fresh" : "unavailable"));
    return (
      <article
        className={styles.repositoryCard}
        data-repository-evidence-state={evidenceState}
      >
        <RepositoryEvidenceContents
          repository={repository}
          evidenceState={evidenceState}
          eyebrow="Project Git evidence"
          title="Primary-root working tree"
          referenceTime={referenceTime}
          unavailableSubject="repository"
          showAttribution
        />
      </article>
    );
  }

  return (
    <article
      className={styles.repositoryCard}
      data-repository-root-count={repositoryRoots.length}
    >
      <div className={styles.repositoryGroupHeader}>
        <span>Project Git evidence</span>
        <strong>{repositoryRoots.length} saved roots</strong>
      </div>
      <p className={styles.repositoryAttribution}>
        Not attributed to this task or result. Task-level changed files: Not
        reported per task.
      </p>
      <p className={styles.repositoryRootExplanation}>
        Each saved root is reported separately. Totals are not combined, and
        local paths are not shown.
      </p>
      <div className={styles.repositoryRootList} role="list">
        {repositoryRoots.map((root, index) => {
          const label =
            index === 0
              ? "Primary saved root"
              : `Additional saved root ${index + 1}`;
          return (
            <section
              key={`${root.role}-${index}`}
              className={styles.repositoryRoot}
              data-repository-evidence-state={root.evidenceState}
              aria-label={`${label} Git evidence`}
              role="listitem"
            >
              <RepositoryEvidenceContents
                repository={root.evidence}
                evidenceState={root.evidenceState}
                eyebrow={`Saved root ${index + 1} of ${repositoryRoots.length}`}
                title={label}
                referenceTime={referenceTime}
                unavailableSubject="saved root"
                accessibleRootLabel={label}
              />
            </section>
          );
        })}
      </div>
    </article>
  );
}

function createLocalId(prefix: string): string {
  const suffix =
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${suffix}`;
}

function linkDestinationValue(objectiveId: string, workItemId: string): string {
  return JSON.stringify([objectiveId, workItemId]);
}

function parseLinkDestination(
  value: string | undefined,
): { objectiveId: string; workItemId: string } | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) &&
      parsed.length === 2 &&
      parsed.every((item) => typeof item === "string" && item.length > 0)
      ? { objectiveId: parsed[0], workItemId: parsed[1] }
      : null;
  } catch {
    return null;
  }
}

function sameResultKey(left: CodexResultKey, right: CodexResultKey): boolean {
  return left.kind === right.kind && left.id === right.id;
}

function sameVerificationTarget(
  left: VerificationTarget,
  right: VerificationTarget,
): boolean {
  return (
    left.projectId === right.projectId &&
    left.objectiveId === right.objectiveId &&
    left.workItemId === right.workItemId &&
    left.attemptId === right.attemptId &&
    sameResultKey(left.resultKey, right.resultKey)
  );
}

function sameVerificationCheck(
  left: VerificationReceiptView["checks"][number],
  right: VerificationCheckReceipt,
): boolean {
  return (
    left.id === right.id &&
    left.version === right.version &&
    left.state === right.state &&
    left.failureKind === right.failureKind &&
    left.exitCode === right.exitCode
  );
}

function sameVerificationReceipt(
  live: VerificationReceiptView | null,
  stored: VerificationReceipt | null,
): boolean {
  if (
    !live ||
    !stored ||
    live.id !== stored.id ||
    live.state !== stored.state ||
    live.profile.id !== stored.profile.id ||
    live.profile.version !== stored.profile.version ||
    !sameVerificationTarget(live.target, stored.target) ||
    live.checks.length !== stored.checks.length
  ) {
    return false;
  }
  return live.checks.every((check, index) =>
    sameVerificationCheck(check, stored.checks[index]!),
  );
}

function verificationStateLabel(
  state: VerificationReceiptView["state"],
): string {
  switch (state) {
    case "queued":
      return "Queued";
    case "running":
      return "Running";
    case "passed":
      return "Passed";
    case "failed":
      return "Failed";
    case "unknown":
      return "Outcome unknown";
  }
}

const SAVED_ACTION_LABELS = {
  open_in_codex: "Open in Codex",
  send_follow_up: "Send a follow-up",
  request_review: "Request review",
  run_quality_check: "Run a quality check",
  accept_result: "Accept result",
  redirect_result: "Request another pass",
  reject_result: "Reject result",
} as const;

function savedDecisionLabel(
  kind: NonNullable<
    SavedResultEvidencePresentation["review"]
  >["decision"] extends { kind: infer Kind } | undefined
    ? Kind
    : never,
): string {
  switch (kind) {
    case "accepted":
      return "Accepted";
    case "redirected":
      return "Another pass requested";
    case "rejected":
      return "Rejected";
  }
}

function savedCountSummary(
  counts: Readonly<Record<string, number>>,
  labels: Readonly<Record<string, string>>,
): string {
  const entries = Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([key, count]) => `${labels[key] ?? key}: ${count}`);
  return entries.length ? entries.join(" · ") : "None";
}

function SavedEvidenceCard({
  title,
  evidence,
}: {
  title: "Selected result" | "Alternative result";
  evidence: SavedResultEvidencePresentation;
}) {
  const assessment = evidence.assessment;
  const verification = evidence.verification;
  return (
    <article className={styles.savedComparisonCard} aria-label={title}>
      <header>
        <small>{title}</small>
        <strong>
          Attempt {evidence.attemptNumber} · Result {evidence.resultNumber}
        </strong>
      </header>
      <dl>
        <div>
          <dt>Observed by Coffice</dt>
          <dd>
            <time dateTime={evidence.observedAt}>
              {compactTimestamp(evidence.observedAt)}
            </time>
          </dd>
        </div>
        <div>
          <dt>Review</dt>
          <dd>
            {evidence.review ? (
              <>
                Reviewed {compactTimestamp(evidence.review.reviewedAt)}
                {evidence.review.decision
                  ? ` · ${savedDecisionLabel(evidence.review.decision.kind)} ${compactTimestamp(evidence.review.decision.decidedAt)}`
                  : " · Decision: Not recorded"}
              </>
            ) : (
              "Not marked reviewed"
            )}
          </dd>
        </div>
        <div>
          <dt>Your saved notes</dt>
          <dd>
            {assessment ? (
              <>
                {assessment.summaryRecorded
                  ? "Summary: Recorded"
                  : "Summary: Not recorded"}
                {` · Risks ${assessment.riskCount} · Uncertainties ${assessment.uncertaintyCount} · Decision notes ${assessment.blockedDecisionCount} · Advisory action: ${assessment.recordedNextAction ? SAVED_ACTION_LABELS[assessment.recordedNextAction] : "Not recorded"}`}
                <span>Updated {compactTimestamp(assessment.updatedAt)}</span>
              </>
            ) : (
              "Not recorded"
            )}
          </dd>
        </div>
        <div>
          <dt>Newest retained quality check</dt>
          <dd>
            {verification ? (
              <>
                {verification.profileLabel} ·{" "}
                {verificationStateLabel(verification.state)}
                <span>
                  Recorded{" "}
                  {compactTimestamp(
                    verification.completedAt ??
                      verification.startedAt ??
                      verification.queuedAt,
                  )}
                </span>
                <span>
                  Checks:{" "}
                  {savedCountSummary(verification.checkCounts, {
                    queued: "queued",
                    running: "running",
                    passed: "passed",
                    failed: "failed",
                    unknown: "unknown",
                  })}
                </span>
                <span>
                  Failures:{" "}
                  {savedCountSummary(verification.failureCounts, {
                    exit: "project script",
                    timeout: "timed out",
                    launch: "could not start",
                  })}
                </span>
              </>
            ) : (
              "No retained check receipt"
            )}
          </dd>
        </div>
      </dl>
    </article>
  );
}

function checkStateLabel(
  check: VerificationReceiptView["checks"][number],
): string {
  if (check.state === "failed") {
    if (check.failureKind === "timeout") return "Timed out";
    if (check.failureKind === "launch") return "Could not start";
    if (check.failureKind === "exit") {
      return check.exitCode === undefined
        ? "Failed · project script"
        : `Failed · exit ${check.exitCode}`;
    }
  }
  return check.state === "unknown"
    ? "Outcome unknown"
    : `${check.state.charAt(0).toUpperCase()}${check.state.slice(1)}`;
}

function targetIdentity(target: VerificationTarget | null): string | null {
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

function QualityChecksSection({
  controller,
  target,
  workItemTitle,
  observedAt,
  pendingStoredResult,
  verificationAllowed,
  storedReceipts = [],
  unavailableReason,
  referenceTime,
}: {
  controller?: VerificationsController;
  target: VerificationTarget | null;
  workItemTitle: string;
  observedAt: string;
  pendingStoredResult: boolean;
  verificationAllowed: boolean;
  storedReceipts?: readonly VerificationReceiptView[];
  unavailableReason?: string;
  referenceTime: number;
}) {
  const sectionRef = useRef<HTMLElement>(null);
  const runButtonRef = useRef<HTMLButtonElement>(null);
  const confirmRunRef = useRef<HTMLButtonElement>(null);
  const confirmCancelRef = useRef<HTMLButtonElement>(null);
  const receiptStatusRef = useRef<HTMLDivElement>(null);
  const cancelIntentGenerationRef = useRef(0);
  const [profileId, setProfileId] = useState("");
  const [confirmation, setConfirmation] = useState<{
    targetIdentity: string;
    profile: { id: string; version: string };
  } | null>(null);
  const [cancelConfirmation, setCancelConfirmation] = useState<string | null>(
    null,
  );
  const [message, setMessage] = useState<string | null>(null);
  const controllerView =
    controller ??
    ({
      ready: true,
      available: false,
      degraded: false,
      profiles: [],
      receipts: storedReceipts,
      operations: [],
      busyReceiptId: null,
      receiptForTarget: () => null,
      run: async () => ({ ok: false as const, reason: "unavailable" as const }),
      cancel: async () => ({
        ok: false as const,
        reason: "unavailable" as const,
      }),
      refresh: async () => undefined,
    } satisfies VerificationsController);
  const currentTargetIdentity = targetIdentity(target);
  const latestTargetIdentityRef = useRef(currentTargetIdentity);
  const verificationAllowedRef = useRef(verificationAllowed);
  const eligibleProfiles = controllerView.profiles.filter(
    (profile) => profile.eligible,
  );
  const selectedProfile =
    eligibleProfiles.find((profile) => profile.id === profileId) ??
    eligibleProfiles[0] ??
    null;
  const confirmationProfile = confirmation
    ? (eligibleProfiles.find(
        (profile) =>
          profile.id === confirmation.profile.id &&
          profile.version === confirmation.profile.version,
      ) ?? null)
    : null;
  const receiptSource = controller?.receipts ?? storedReceipts;
  const exactReceipts = target
    ? receiptSource.filter((receipt) =>
        sameVerificationTarget(receipt.target, target),
      )
    : [];
  const latestReceipt = exactReceipts.at(-1) ?? null;
  const operation = latestReceipt
    ? controller?.operations.find(
        (candidate) => candidate.receiptId === latestReceipt.id,
      )
    : null;
  const active = Boolean(
    latestReceipt &&
    (latestReceipt.state === "queued" || latestReceipt.state === "running"),
  );
  const confirmationInvalidReason = confirmation
    ? confirmation.targetIdentity !== currentTargetIdentity
      ? "A newer result is now current. Choose a check for that result."
      : controller?.degraded
        ? "Live receipt updates must recover before another check can be confirmed."
        : active
          ? "A quality check is already active for this result. Review its receipt below."
          : !confirmationProfile
            ? "That check profile changed. Review its current details before running it."
            : null
    : null;
  const activeConfirmation =
    confirmation && !confirmationInvalidReason ? confirmation : null;

  useLayoutEffect(() => {
    latestTargetIdentityRef.current = currentTargetIdentity;
    verificationAllowedRef.current = verificationAllowed;
  }, [currentTargetIdentity, verificationAllowed]);

  useEffect(() => {
    if (!confirmation || !confirmationInvalidReason) return;
    window.requestAnimationFrame(() => {
      const focusTarget =
        runButtonRef.current && !runButtonRef.current.disabled
          ? runButtonRef.current
          : sectionRef.current;
      focusTarget?.focus({ preventScroll: true });
    });
  }, [confirmation, confirmationInvalidReason]);

  const runConfirmed = async () => {
    if (
      !controller ||
      !target ||
      !confirmationProfile ||
      !activeConfirmation ||
      !verificationAllowed ||
      controller.degraded ||
      active
    )
      return;
    const capturedConfirmation = activeConfirmation;
    const capturedTarget = activeConfirmation.targetIdentity;
    setMessage(null);
    const result = await controller.run(target, {
      id: confirmationProfile.id,
      version: confirmationProfile.version,
    });
    setConfirmation((current) =>
      current === capturedConfirmation ? null : current,
    );
    if (
      capturedTarget !== latestTargetIdentityRef.current ||
      !verificationAllowedRef.current
    )
      return;
    setMessage(
      result.ok
        ? result.replayed
          ? "The existing request receipt was restored."
          : "Quality check queued."
        : result.reason === "confirmation_lost"
          ? "Coffice could not confirm whether the request was received. Check the receipt history before starting another run."
          : "The quality check could not be started.",
    );
    window.requestAnimationFrame(() =>
      (receiptStatusRef.current ?? runButtonRef.current)?.focus({
        preventScroll: true,
      }),
    );
  };

  const cancelConfirmed = async () => {
    if (!controller || !cancelConfirmation || !verificationAllowed) return;
    const receiptId = cancelConfirmation;
    const intentGeneration = cancelIntentGenerationRef.current;
    const capturedTarget = currentTargetIdentity;
    setCancelConfirmation(null);
    setMessage(null);
    const result = await controller.cancel(receiptId);
    if (
      intentGeneration !== cancelIntentGenerationRef.current ||
      capturedTarget !== latestTargetIdentityRef.current ||
      !verificationAllowedRef.current
    )
      return;
    setMessage(
      result.ok
        ? "Cancellation requested. The final receipt may still report a completed check."
        : result.reason === "confirmation_lost"
          ? "Coffice could not confirm cancellation. It will not retry automatically."
          : "Cancellation could not be requested.",
    );
    window.requestAnimationFrame(() =>
      receiptStatusRef.current?.focus({ preventScroll: true }),
    );
  };

  return (
    <section
      ref={sectionRef}
      className={styles.qualityChecks}
      aria-labelledby="quality-checks-heading"
      tabIndex={-1}
    >
      <div className={styles.sectionHeading}>
        <h3 id="quality-checks-heading">Quality checks</h3>
        <span>Exact result</span>
      </div>
      <p className={styles.qualityTarget}>
        <strong>{workItemTitle}</strong>
        <span>Result observed {relativeTime(observedAt, referenceTime)}</span>
      </p>

      {pendingStoredResult ? (
        <p className={styles.qualityNotice} role="status">
          This completed result is still being saved to the local work plan.
          Checks become available when its exact result key is durable.
        </p>
      ) : unavailableReason && !latestReceipt ? (
        <p className={styles.qualityNotice} role="status">
          {unavailableReason}
        </p>
      ) : !controller?.ready && !latestReceipt ? (
        <p className={styles.qualityNotice} role="status">
          Checking local verification availability…
        </p>
      ) : !controllerView.available && !latestReceipt ? (
        <p className={styles.qualityNotice} role="status">
          Quality checks are unavailable for this saved project.
        </p>
      ) : (
        <>
          {unavailableReason ? (
            <p className={styles.qualityWarning} role="status">
              {unavailableReason}
            </p>
          ) : null}
          {controller?.degraded ? (
            <p className={styles.qualityWarning} role="status">
              Live receipt updates are temporarily unavailable. Saved receipts
              below remain authoritative; Coffice will not repeat an action
              automatically.
            </p>
          ) : null}

          {!verificationAllowed ? (
            <p className={styles.qualityWarning} role="status">
              Quality-check actions are locked while the local work plan is
              unavailable or awaiting recovery review. Existing receipts remain
              visible below.
            </p>
          ) : eligibleProfiles.length === 0 ? (
            <p className={styles.qualityNotice} role="status">
              {active
                ? "This project already has a quality check in progress. Its receipt and cancellation control remain available below."
                : "No quality-check profile is currently available for another run."}
            </p>
          ) : activeConfirmation && confirmationProfile ? (
            <div
              className={styles.qualityConfirmation}
              role="group"
              aria-label="Confirm quality check"
            >
              <small>Confirm local quality check</small>
              <strong>{confirmationProfile.label}</strong>
              <p>{confirmationProfile.description}</p>
              <ul>
                <li>{confirmationProfile.label}</li>
              </ul>
              <p className={styles.qualitySafety}>
                This runs trusted local project scripts through Codex’s sandbox
                with network access off. Output is not stored. It is not Codex
                approval and not a safety guarantee for untrusted code.
              </p>
              <div className={styles.formActions}>
                <button
                  ref={confirmRunRef}
                  type="button"
                  data-dialog-initial-focus="true"
                  disabled={controllerView.busyReceiptId !== null}
                  onClick={() => void runConfirmed()}
                >
                  {controllerView.busyReceiptId === "starting"
                    ? "Starting…"
                    : "Confirm and run"}
                </button>
                <button
                  type="button"
                  disabled={controllerView.busyReceiptId !== null}
                  onClick={() => {
                    setConfirmation(null);
                    window.requestAnimationFrame(() =>
                      runButtonRef.current?.focus({ preventScroll: true }),
                    );
                  }}
                >
                  Back
                </button>
              </div>
            </div>
          ) : (
            <div className={styles.qualityPicker}>
              <label>
                Check profile
                <select
                  value={selectedProfile?.id ?? ""}
                  disabled={
                    active ||
                    controllerView.degraded ||
                    eligibleProfiles.length === 0
                  }
                  onChange={(event) => setProfileId(event.currentTarget.value)}
                >
                  {eligibleProfiles.map((profile) => (
                    <option
                      key={`${profile.id}:${profile.version}`}
                      value={profile.id}
                    >
                      {profile.label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                ref={runButtonRef}
                type="button"
                disabled={
                  active ||
                  controllerView.degraded ||
                  !target ||
                  !selectedProfile
                }
                onClick={() => {
                  if (!currentTargetIdentity || !selectedProfile) return;
                  setMessage(null);
                  setConfirmation({
                    targetIdentity: currentTargetIdentity,
                    profile: {
                      id: selectedProfile.id,
                      version: selectedProfile.version,
                    },
                  });
                  window.requestAnimationFrame(() =>
                    confirmRunRef.current?.focus({ preventScroll: true }),
                  );
                }}
              >
                Review check details
              </button>
            </div>
          )}

          {latestReceipt ? (
            <div
              ref={receiptStatusRef}
              className={styles.qualityReceipt}
              data-verification-state={latestReceipt.state}
              role="status"
              tabIndex={-1}
            >
              <div>
                <strong>{verificationStateLabel(latestReceipt.state)}</strong>
                <time
                  dateTime={latestReceipt.completedAt ?? latestReceipt.queuedAt}
                >
                  {relativeTime(
                    latestReceipt.completedAt ?? latestReceipt.queuedAt,
                    referenceTime,
                  )}
                </time>
              </div>
              <ul>
                {latestReceipt.checks.map((check) => (
                  <li key={`${check.id}:${check.version}`}>
                    <span>
                      {controllerView.profiles.find(
                        (profile) => profile.id === check.id,
                      )?.label ?? check.id}
                    </span>
                    <b>{checkStateLabel(check)}</b>
                  </li>
                ))}
              </ul>
              {active && verificationAllowed ? (
                cancelConfirmation === latestReceipt.id ? (
                  <div className={styles.formActions}>
                    <button
                      ref={confirmCancelRef}
                      type="button"
                      disabled={controllerView.busyReceiptId !== null}
                      onClick={() => void cancelConfirmed()}
                    >
                      Confirm cancel
                    </button>
                    <button
                      type="button"
                      disabled={controllerView.busyReceiptId !== null}
                      onClick={() => {
                        setCancelConfirmation(null);
                        window.requestAnimationFrame(() =>
                          receiptStatusRef.current?.focus({
                            preventScroll: true,
                          }),
                        );
                      }}
                    >
                      Keep running
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className={styles.cancelCheck}
                    disabled={
                      operation?.state === "cancelling" ||
                      controllerView.busyReceiptId !== null
                    }
                    onClick={() => {
                      cancelIntentGenerationRef.current += 1;
                      setCancelConfirmation(latestReceipt.id);
                      window.requestAnimationFrame(() =>
                        confirmCancelRef.current?.focus({
                          preventScroll: true,
                        }),
                      );
                    }}
                  >
                    {operation?.state === "cancelling"
                      ? "Cancelling…"
                      : "Cancel"}
                  </button>
                )
              ) : null}
            </div>
          ) : (
            <p className={styles.qualityNotice}>
              No quality-check receipt exists for this result yet.
            </p>
          )}
          {exactReceipts.length > 1 ? (
            <details className={styles.qualityHistory}>
              <summary>
                Earlier runs for this result ({exactReceipts.length - 1})
              </summary>
              <ul>
                {exactReceipts
                  .slice(0, -1)
                  .reverse()
                  .slice(0, 5)
                  .map((receipt) => (
                    <li key={receipt.id}>
                      <span>{verificationStateLabel(receipt.state)}</span>
                      <time dateTime={receipt.completedAt ?? receipt.queuedAt}>
                        {relativeTime(
                          receipt.completedAt ?? receipt.queuedAt,
                          referenceTime,
                        )}
                      </time>
                    </li>
                  ))}
              </ul>
            </details>
          ) : null}
        </>
      )}
      {(confirmationInvalidReason ?? message) ? (
        <p className={styles.qualityMessage} role="status">
          {confirmationInvalidReason ?? message}
        </p>
      ) : null}
    </section>
  );
}

export function ReviewActInspector({
  task,
  project,
  displayName,
  referenceTime,
  review,
  workspace,
  actions,
  verifications,
  onClose,
}: {
  task: ReviewTask;
  project: ReviewProject;
  displayName: string;
  referenceTime: number;
  review: AttentionReviewController;
  workspace?: CofficeWorkspaceController;
  actions?: CodexActionsController;
  verifications?: VerificationsController;
  onClose: () => void;
}) {
  workspace ??= EMPTY_WORKSPACE_CONTROLLER;
  const panelRef = useRef<HTMLElement>(null);
  const acceptDecisionRef = useRef<HTMLButtonElement>(null);
  const redirectDecisionRef = useRef<HTMLButtonElement>(null);
  const rejectDecisionRef = useRef<HTMLButtonElement>(null);
  const decisionStatusRef = useRef<HTMLElement>(null);
  const followUpButtonRef = useRef<HTMLButtonElement>(null);
  const followUpTextRef = useRef<HTMLTextAreaElement>(null);
  const reviewButtonRef = useRef<HTMLButtonElement>(null);
  const archiveButtonRef = useRef<HTMLButtonElement>(null);
  const stopActionButtonRef = useRef<HTMLButtonElement>(null);
  const operationStatusRef = useRef<HTMLDivElement>(null);
  const openInCodexRef = useRef<HTMLAnchorElement>(null);
  const planContextHelpId = useId();
  const repairContextHelpId = useId();
  const candidate = createAttentionItem(project, task);
  const disposition = candidate
    ? review.dispositionFor(candidate.eventKey)
    : undefined;
  const snoozedUntil = candidate
    ? review.snoozedUntilFor(candidate.eventKey)
    : undefined;
  const snoozed = Boolean(
    snoozedUntil && Date.parse(snoozedUntil) > referenceTime,
  );
  const baselined = candidate ? review.isBaselined(candidate) : false;
  const explicitlyResolved =
    disposition?.kind === "reviewed" || disposition?.kind === "dismissed";
  const context = contextPercent(task);
  const expectedOutcome =
    task.kind === "staff" || /^\s*\[AGENT\]/iu.test(task.title)
      ? null
      : task.title;
  const managedProject = workspace.workspace?.projects.find(
    (item) => item.id === project.id,
  );
  const activeObjective =
    managedProject?.objectives.find((item) => item.status === "active") ?? null;
  const workContexts = useMemo(
    () => selectTaskWorkContexts(workspace.workspace, task.id),
    [task.id, workspace.workspace],
  );
  const openContexts = workContexts.filter(
    (context) => context.attempt.unlinkedAt === undefined,
  );
  const openWorkContext = selectOpenTaskWorkContext(
    workspace.workspace,
    task.id,
  );
  const latestClosedWorkContext = selectLatestClosedTaskWorkContext(
    workspace.workspace,
    task.id,
  );
  const candidateResultKey =
    candidate?.kind === "ready_for_review"
      ? { kind: "revision" as const, id: candidate.eventKey }
      : null;
  const exactResultContext = candidateResultKey
    ? (workContexts.find((context) =>
        context.attempt.resultCycles.some((result) =>
          sameResultKey(result.key, candidateResultKey),
        ),
      ) ?? null)
    : null;
  const workContextAmbiguous = openContexts.length > 1;
  const workContext = workContextAmbiguous
    ? null
    : (exactResultContext ?? openWorkContext ?? latestClosedWorkContext);
  const decisionProjectId = workContext?.project.id ?? null;
  const decisionProjectTitle = workContext?.project.title ?? null;
  const projectDecisionEvents =
    workspace.workspace?.projectDecisionEvents ?? EMPTY_PROJECT_DECISION_EVENTS;
  const activeProjectDecisions = decisionProjectId
    ? selectActiveProjectDecisions(projectDecisionEvents, decisionProjectId)
    : [];
  const displayingHistoricalResult = Boolean(
    exactResultContext &&
    openWorkContext &&
    exactResultContext.attempt.id !== openWorkContext.attempt.id,
  );
  const [fallbackObservationAt] = useState(() =>
    new Date(referenceTime).toISOString(),
  );
  const candidateObservedAt = candidate?.occurredAt ?? fallbackObservationAt;
  const observationTarget = openWorkContext;
  const matchesObservationBaseline = Boolean(
    candidateResultKey &&
    observationTarget?.attempt.observeResultsAfterKey &&
    sameResultKey(
      candidateResultKey,
      observationTarget.attempt.observeResultsAfterKey,
    ),
  );
  const observedResult: Omit<CodexResultCycle, "review"> | null =
    candidateResultKey &&
    observationTarget &&
    !exactResultContext &&
    !matchesObservationBaseline
      ? { key: candidateResultKey, observedAt: candidateObservedAt }
      : null;
  const initialLinkResult: Omit<CodexResultCycle, "review"> | null =
    candidateResultKey && workContexts.length === 0
      ? { key: candidateResultKey, observedAt: candidateObservedAt }
      : null;
  const resultToReview =
    observedResult ?? workContext?.attempt.resultCycles.at(-1) ?? null;
  const storedResult = resultToReview
    ? (workContext?.attempt.resultCycles.find((result) =>
        sameResultKey(result.key, resultToReview.key),
      ) ?? null)
    : null;
  const resultDurablyReviewed = Boolean(storedResult?.review);
  const workEvidence = workContext
    ? (workspace.workspace?.evidence ?? []).filter(
        (record) => record.attemptId === workContext.attempt.id,
      )
    : [];
  const latestCodexReviewActivity = [...workEvidence]
    .reverse()
    .find(
      (record) =>
        record.kind === "verification" &&
        record.provenance.reference?.startsWith("codex-operation:"),
    );
  const verificationTarget: VerificationTarget | null =
    workContext && storedResult
      ? {
          projectId: workContext.project.id,
          objectiveId: workContext.objective.id,
          workItemId: workContext.workItem.id,
          attemptId: workContext.attempt.id,
          resultKey: storedResult.key,
        }
      : null;
  const qualityBarReadiness =
    workContext && verificationTarget
      ? projectQualityBarReadiness(
          workContext.project,
          verificationTarget,
          workspace.workspace?.verificationReceipts ?? [],
        )
      : null;
  const savedComparison = verificationTarget
    ? selectSavedResultComparison(workspace.workspace, verificationTarget)
    : null;
  const [savedComparisonBinding, setSavedComparisonBinding] =
    useState<SavedResultEvidenceBinding | null>(null);
  const [savedComparisonStatus, setSavedComparisonStatus] = useState("");
  const savedComparisonTriggerRef = useRef<HTMLButtonElement>(null);
  const savedComparisonSelectRef = useRef<HTMLSelectElement>(null);
  const savedComparisonStatusRef = useRef<HTMLParagraphElement>(null);
  const savedComparisonPair =
    verificationTarget && savedComparisonBinding
      ? selectSavedResultComparisonPair(
          workspace.workspace,
          verificationTarget,
          savedComparisonBinding,
        )
      : null;
  const savedComparisonOpen = savedComparisonBinding !== null;
  const selectedAlternativeToken = savedComparisonBinding
    ? (() => {
        const selectedIdentity = targetIdentity(savedComparisonBinding.target);
        const index =
          savedComparison?.alternatives.findIndex(
            (candidate) =>
              targetIdentity(candidate.binding.target) === selectedIdentity,
          ) ?? -1;
        return index >= 0 ? `alternative-${index + 1}` : "";
      })()
    : "";
  const exactAssessmentTarget: ReviewAssessmentTarget | null =
    verificationTarget;
  const workAssessmentTarget: ReviewAssessmentTarget | null = workContext
    ? {
        projectId: workContext.project.id,
        objectiveId: workContext.objective.id,
        workItemId: workContext.workItem.id,
      }
    : null;
  const exactAssessment = exactAssessmentTarget
    ? selectReviewAssessment(
        workspace.workspace?.reviewAssessments ?? [],
        exactAssessmentTarget,
      )
    : undefined;
  const workAssessment = workAssessmentTarget
    ? selectReviewAssessment(
        workspace.workspace?.reviewAssessments ?? [],
        workAssessmentTarget,
      )
    : undefined;
  const acceptanceUnresolvedCount =
    unresolvedReviewAssessmentCount(exactAssessment) +
    unresolvedReviewAssessmentCount(workAssessment);
  const acceptanceConflictingActions = [exactAssessment, workAssessment].filter(
    (assessment) =>
      assessment?.nextAction &&
      assessment.nextAction.kind !== "accept_result" &&
      assessment.nextAction.kind !== "open_in_codex",
  ).length;
  const resultPendingStorage = Boolean(
    workContext && observedResult && !storedResult,
  );
  const [trackingOpen, setTrackingOpen] = useState(false);
  const [targetWorkItemId, setTargetWorkItemId] = useState("new");
  const [trackTitle, setTrackTitle] = useState(task.title);
  const [trackOutcome, setTrackOutcome] = useState("");
  const [relationship, setRelationship] =
    useState<CodexTaskAttempt["relationship"]>("retry");
  const [linkChange, setLinkChange] = useState<LinkChangeMode | null>(null);
  const [linkReconciling, setLinkReconciling] = useState(false);
  const linkChangeTriggerRef = useRef<HTMLButtonElement>(null);
  const linkChangeStatusRef = useRef<HTMLDivElement>(null);
  const assignmentEvidence = task.assignmentEvidence ?? "cwd_fallback";
  const assignmentSourceFresh = task.assignmentSourceFresh !== false;
  const relocationSource = openWorkContext ?? latestClosedWorkContext;
  const destinationOptions = (managedProject?.objectives ?? []).flatMap(
    (objective) =>
      objective.workItems
        .filter(
          (item) =>
            LINK_DESTINATION_STATES.has(item.status) &&
            !(
              openWorkContext?.project.id === managedProject?.id &&
              openWorkContext?.objective.id === objective.id &&
              openWorkContext?.workItem.id === item.id
            ),
        )
        .map((item) => ({
          value: linkDestinationValue(objective.id, item.id),
          objective,
          workItem: item,
        })),
  );
  const selectedDestination = parseLinkDestination(linkChange?.destination);
  const selectedDestinationContext = selectedDestination
    ? (destinationOptions.find(
        (option) =>
          option.objective.id === selectedDestination.objectiveId &&
          option.workItem.id === selectedDestination.workItemId,
      ) ?? null)
    : null;
  const linkMismatch = Boolean(
    openWorkContext &&
    assignmentEvidence === "explicit_project" &&
    openWorkContext.project.id !== project.id,
  );
  const linkOrphaned = Boolean(
    openWorkContext && assignmentEvidence === "explicit_unassigned",
  );
  const assignmentRelocationUnavailable =
    !assignmentSourceFresh ||
    assignmentEvidence === "explicit_unknown_project" ||
    assignmentEvidence === "cwd_fallback";
  const sourceVerificationActive = Boolean(
    relocationSource &&
    workspace.workspace?.verificationReceipts.some(
      (receipt) =>
        receipt.target.projectId === relocationSource.project.id &&
        receipt.target.objectiveId === relocationSource.objective.id &&
        receipt.target.workItemId === relocationSource.workItem.id &&
        receipt.target.attemptId === relocationSource.attempt.id &&
        (receipt.state === "queued" || receipt.state === "running"),
    ),
  );
  const targetWorkItem =
    targetWorkItemId === "new"
      ? null
      : (activeObjective?.workItems.find(
          (item) => item.id === targetWorkItemId,
        ) ?? null);
  const targetHasAttempts = Boolean(targetWorkItem?.attempts.length);
  const resultReviewable = Boolean(
    resultToReview &&
    (candidate?.kind === "ready_for_review" ||
      workContext?.workItem.status === "ready_for_review"),
  );
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const [workspaceMessage, setWorkspaceMessage] = useState<string | null>(null);
  const [decisionMode, setDecisionMode] = useState<{
    kind: "accepted" | "redirected" | "rejected";
    result: Omit<CodexResultCycle, "review">;
  } | null>(null);
  const currentResultKind = resultToReview?.key.kind;
  const currentResultId = resultToReview?.key.id;
  const decisionConfirmation =
    decisionMode &&
    decisionMode.result.key.kind === currentResultKind &&
    decisionMode.result.key.id === currentResultId
      ? decisionMode
      : null;
  const resultChangedDuringDecision = Boolean(
    decisionMode && !decisionConfirmation,
  );
  useEffect(() => {
    if (!resultChangedDuringDecision) return;
    acceptDecisionRef.current?.focus({ preventScroll: true });
  }, [resultChangedDuringDecision]);
  useEffect(() => {
    if (!savedComparisonBinding || savedComparisonPair) return;
    const frame = window.requestAnimationFrame(() => {
      setSavedComparisonBinding(null);
      setSavedComparisonStatus("Saved comparison is no longer available.");
      (
        savedComparisonTriggerRef.current ?? savedComparisonStatusRef.current
      )?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [savedComparisonBinding, savedComparisonPair]);
  const [actionMode, setActionMode] = useState<
    "follow_up" | "review" | "archive" | null
  >(null);
  const [actionStep, setActionStep] = useState<"compose" | "confirm">(
    "compose",
  );
  const [followUpText, setFollowUpText] = useState("");
  const [confirmedFollowUpText, setConfirmedFollowUpText] = useState("");
  const [planContextInserted, setPlanContextInserted] = useState(false);
  const [repairContextInserted, setRepairContextInserted] = useState(false);
  const [repairContextFingerprint, setRepairContextFingerprint] = useState<
    string | null
  >(null);
  const [planContextStatus, setPlanContextStatus] = useState<string | null>(
    null,
  );
  const [actionTargetTaskId, setActionTargetTaskId] = useState<string | null>(
    null,
  );
  const [actionBusy, setActionBusy] = useState(false);
  const [cancelOperationId, setCancelOperationId] = useState<string | null>(
    null,
  );
  const [cancelBusy, setCancelBusy] = useState(false);
  const activeActionMode = actionTargetTaskId === task.id ? actionMode : null;
  const actionTaskIdRef = useRef(task.id);
  useEffect(() => {
    if (actionTaskIdRef.current === task.id) return;
    actionTaskIdRef.current = task.id;
    setActionMode(null);
    setActionStep("compose");
    setFollowUpText("");
    setConfirmedFollowUpText("");
    setPlanContextInserted(false);
    setRepairContextInserted(false);
    setRepairContextFingerprint(null);
    setPlanContextStatus(null);
    setActionTargetTaskId(null);
    setCancelOperationId(null);
    setCancelBusy(false);
  }, [task.id]);
  const planContextResult = useMemo(
    () => buildCurrentPlanFollowUpContext(workspace.workspace, task.id),
    [task.id, workspace.workspace],
  );
  const repairContextResult = verificationTarget
    ? buildFailedCheckRepairFollowUpContext(
        workspace.workspace,
        task.id,
        verificationTarget,
      )
    : ({ kind: "unavailable", reason: "target_mismatch" } as const);
  const latestOperation = actions?.latestOperationFor(task.id);
  const pendingCodexRequest = actions?.pendingRequests?.find(
    (request) => request.taskId === task.id,
  );
  const actionNotice = pendingCodexRequest
    ? "Codex is waiting for your response above."
    : operationStatus(latestOperation);
  const taskActionable = ACTIONABLE_TASK_STATUSES.has(task.status.value);
  const archiveEligible =
    task.status.evidence === "observed" &&
    (task.status.value === "completed" || task.status.value === "failed");
  const operationActive = Boolean(
    latestOperation && ACTIVE_OPERATION_STATES.has(latestOperation.state),
  );
  const cancellableOperation =
    !pendingCodexRequest &&
    latestOperation &&
    ACTIVE_OPERATION_STATES.has(latestOperation.state) &&
    latestOperation.kind !== "archive_task" &&
    latestOperation.turnId &&
    !latestOperation.cancelRequestedAt &&
    actions?.available === true &&
    actions?.cancelOperation
      ? latestOperation
      : null;
  const cancelTarget =
    cancelOperationId && cancellableOperation?.id === cancelOperationId
      ? cancellableOperation
      : null;
  const baseActionUnavailable =
    !actions ||
    actions.available !== true ||
    Boolean(task.status.stale) ||
    !taskActionable ||
    operationActive;
  const archiveUnavailable =
    baseActionUnavailable || !archiveEligible || !actions?.archiveTask;
  const actionUnavailable =
    activeActionMode === "archive" ? archiveUnavailable : baseActionUnavailable;
  const planContextBlockedReason =
    followUpText.length > 0
      ? "Plan context can only be inserted into an empty instruction. Clear this draft first."
      : !workspace.ready
        ? "Wait for the local Coffice workspace to finish loading."
        : !workspace.persistent
          ? "Plan context is unavailable because the local Coffice workspace is not safely available."
          : workspace.recovery?.kind === "backup" &&
              !workspace.recoveryAcknowledged
            ? "Review and acknowledge the recovered workspace before inserting plan context."
            : !assignmentSourceFresh
              ? "Refresh Codex project metadata before inserting plan context."
              : project.holding || assignmentEvidence === "explicit_unassigned"
                ? "Assign this task to a Codex project before inserting project plan context."
                : assignmentEvidence === "explicit_unknown_project"
                  ? "Codex reports a project Coffice cannot currently resolve. Refresh projects first."
                  : assignmentEvidence !== "explicit_project"
                    ? "An explicit Codex project assignment is required before inserting plan context."
                    : openContexts.length === 0
                      ? "This task has no current plan link. Historical plan links are not inserted."
                      : openContexts.length > 1
                        ? "This task has more than one current plan link. Resolve the duplicate links first."
                        : openContexts[0]!.project.id !== project.id
                          ? "The current plan link does not match this task's explicit Codex project. Resolve the mismatch first."
                          : planContextResult.kind === "too_large"
                            ? "The current plan context cannot fit in one Codex follow-up. You can still write a shorter instruction manually."
                            : planContextResult.kind !== "ready"
                              ? "Current plan context is not available for this task."
                              : null;
  const latestControllerReceipt = verificationTarget
    ? ([...(verifications?.receipts ?? [])]
        .reverse()
        .find((receipt) =>
          sameVerificationTarget(receipt.target, verificationTarget),
        ) ?? null)
    : null;
  const durableLatestExactReceipt = verificationTarget
    ? (workspace.workspace?.verificationReceipts
        .filter((receipt) =>
          sameVerificationTarget(receipt.target, verificationTarget),
        )
        .at(-1) ?? null)
    : null;
  const controllerReceiptMatchesRepair = sameVerificationReceipt(
    latestControllerReceipt,
    durableLatestExactReceipt,
  );
  const repairContextCandidate =
    repairContextResult.kind === "ready" ||
    repairContextResult.kind === "too_large";
  const repairSourceBlockedReason = !workspace.ready
    ? "Wait for the local Coffice workspace to finish loading."
    : !workspace.persistent
      ? "Repair context is unavailable because the local Coffice workspace is not safely available."
      : workspace.recovery?.kind === "backup" && !workspace.recoveryAcknowledged
        ? "Review and acknowledge the recovered workspace before preparing a repair follow-up."
        : !assignmentSourceFresh
          ? "Refresh Codex project metadata before preparing a repair follow-up."
          : project.holding || assignmentEvidence === "explicit_unassigned"
            ? "Assign this task to a Codex project before preparing a repair follow-up."
            : assignmentEvidence === "explicit_unknown_project"
              ? "Codex reports a project Coffice cannot currently resolve. Refresh projects first."
              : assignmentEvidence !== "explicit_project"
                ? "An explicit Codex project assignment is required before preparing a repair follow-up."
                : openContexts.length !== 1 ||
                    openContexts[0]!.project.id !== project.id
                  ? "Resolve this task's current plan link before preparing a repair follow-up."
                  : !verifications?.ready
                    ? "Wait for current quality-check receipts to finish loading."
                    : verifications.degraded
                      ? "Wait for live quality-check receipt updates to recover."
                      : !controllerReceiptMatchesRepair
                        ? "Wait for the latest failed check to finish syncing."
                        : repairContextResult.kind === "too_large"
                          ? "The repair context cannot fit in one Codex follow-up. You can still write a shorter instruction manually."
                          : repairContextResult.kind !== "ready"
                            ? "A current failed quality check is not available for this result."
                            : null;
  const repairSourceEligible =
    repairContextResult.kind === "ready" && repairSourceBlockedReason === null;
  const repairContextBlockedReason =
    followUpText.length > 0
      ? "Repair context can only be inserted into an empty instruction. Clear this draft first."
      : repairSourceBlockedReason;
  const repairBindingChanged =
    repairContextInserted &&
    (repairContextResult.kind !== "ready" ||
      repairContextResult.fingerprint !== repairContextFingerprint ||
      !repairSourceEligible);
  useEffect(() => {
    if (
      activeActionMode !== "follow_up" ||
      actionStep !== "confirm" ||
      !repairBindingChanged
    ) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      setActionStep("compose");
      setRepairContextInserted(false);
      setRepairContextFingerprint(null);
      setPlanContextStatus(
        "The failed check, result, plan link, or copied plan context changed. Your draft was preserved as ordinary text. Review it again before sending.",
      );
      window.requestAnimationFrame(() =>
        followUpTextRef.current?.focus({ preventScroll: true }),
      );
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeActionMode, actionStep, repairBindingChanged]);
  useEffect(() => {
    if (!cancelOperationId || cancelTarget) return;
    const frame = window.requestAnimationFrame(() => {
      setCancelOperationId(null);
      (operationStatusRef.current ?? openInCodexRef.current)?.focus({
        preventScroll: true,
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [cancelOperationId, cancelTarget]);
  const closeLinkChange = () => {
    setLinkChange(null);
    window.requestAnimationFrame(() =>
      linkChangeTriggerRef.current?.focus({ preventScroll: true }),
    );
  };
  const closeSavedComparison = () => {
    setSavedComparisonBinding(null);
    setSavedComparisonStatus("");
    window.requestAnimationFrame(() =>
      savedComparisonTriggerRef.current?.focus({ preventScroll: true }),
    );
  };
  useDialogKeyboard(panelRef, () => {
    if (savedComparisonOpen) {
      closeSavedComparison();
      return;
    }
    if (cancelOperationId) {
      setCancelOperationId(null);
      window.requestAnimationFrame(() =>
        stopActionButtonRef.current?.focus({ preventScroll: true }),
      );
      return;
    }
    if (activeActionMode) {
      if (actionStep === "confirm") {
        if (activeActionMode === "follow_up") {
          setActionStep("compose");
          window.requestAnimationFrame(() =>
            followUpTextRef.current?.focus({ preventScroll: true }),
          );
        } else {
          setActionMode(null);
          setActionTargetTaskId(null);
          window.requestAnimationFrame(() =>
            (activeActionMode === "archive"
              ? archiveButtonRef.current
              : reviewButtonRef.current
            )?.focus({ preventScroll: true }),
          );
        }
      } else {
        setFollowUpText("");
        setConfirmedFollowUpText("");
        setPlanContextInserted(false);
        setRepairContextInserted(false);
        setRepairContextFingerprint(null);
        setPlanContextStatus(null);
        setActionTargetTaskId(null);
        setActionMode(null);
        window.requestAnimationFrame(() =>
          followUpButtonRef.current?.focus({ preventScroll: true }),
        );
      }
      return;
    }
    if (linkChange) {
      closeLinkChange();
      return;
    }
    onClose();
  });

  const runConfirmedAction = async () => {
    if (
      !actions ||
      !activeActionMode ||
      actionBusy ||
      actionUnavailable ||
      repairBindingChanged ||
      actionTargetTaskId !== task.id
    )
      return;
    setActionBusy(true);
    if (activeActionMode === "follow_up") {
      const instruction = confirmedFollowUpText;
      setFollowUpText("");
      setConfirmedFollowUpText("");
      setPlanContextInserted(false);
      setRepairContextInserted(false);
      setRepairContextFingerprint(null);
      setPlanContextStatus(null);
      setActionTargetTaskId(null);
      setActionMode(null);
      setActionStep("compose");
      await actions.submitFollowUp(task.id, instruction);
    } else if (activeActionMode === "review") {
      setActionMode(null);
      setActionStep("compose");
      setActionTargetTaskId(null);
      await actions.requestReview(task.id);
    } else {
      const archiveTask = actions.archiveTask;
      if (!archiveTask) {
        setActionBusy(false);
        return;
      }
      setActionMode(null);
      setActionStep("compose");
      setActionTargetTaskId(null);
      await archiveTask(task.id);
    }
    setActionBusy(false);
    window.requestAnimationFrame(() => {
      (operationStatusRef.current ?? openInCodexRef.current)?.focus({
        preventScroll: true,
      });
    });
  };

  const runConfirmedCancellation = async () => {
    const cancelOperation = actions?.cancelOperation;
    if (!cancelTarget || !cancelOperation || cancelBusy) return;
    const operationId = cancelTarget.id;
    const taskId = task.id;
    setCancelBusy(true);
    setCancelOperationId(null);
    await cancelOperation(operationId, taskId);
    if (actionTaskIdRef.current !== taskId) return;
    setCancelBusy(false);
    window.requestAnimationFrame(() =>
      (operationStatusRef.current ?? openInCodexRef.current)?.focus({
        preventScroll: true,
      }),
    );
  };

  const linkChangeBlockedReason =
    workspace.recovery?.kind === "backup" && !workspace.recoveryAcknowledged
      ? "Review and acknowledge the recovered workspace before changing plan links."
      : !workspace.persistent
        ? "The local Coffice workspace is unavailable. Plan links cannot be changed."
        : sourceVerificationActive
          ? "Wait for the running quality check to finish or cancel it before changing this link."
          : resultPendingStorage
            ? "Wait while the current result is saved before changing this link."
            : assignmentRelocationUnavailable
              ? !assignmentSourceFresh
                ? "The project-assignment source is stale. Refresh Codex metadata before changing this link."
                : assignmentEvidence === "explicit_unknown_project"
                  ? "Codex reports a project Coffice cannot currently resolve. Refresh projects before changing this link."
                  : "Coffice only has a folder-based project guess. An explicit Codex project assignment is required to move this link."
              : null;

  const beginLinkChange = (action: LinkChangeMode["action"]) => {
    if (
      !relocationSource ||
      linkChangeBlockedReason ||
      linkReconciling ||
      activeActionMode ||
      cancelOperationId
    )
      return;
    const destination = destinationOptions[0]?.value;
    setWorkspaceMessage(null);
    setLinkChange({
      action,
      step: action === "unlink" ? "confirm" : "choose",
      sourceAttemptId: relocationSource.attempt.id,
      sourceWasOpen: relocationSource.attempt.unlinkedAt === undefined,
      ...(destination ? { destination } : {}),
    });
  };

  const confirmLinkChange = async () => {
    if (!linkChange || workspaceBusy || linkReconciling) return;
    const source = workContexts.find(
      (context) => context.attempt.id === linkChange.sourceAttemptId,
    );
    if (
      !source ||
      linkChangeBlockedReason ||
      (source.attempt.unlinkedAt === undefined) !== linkChange.sourceWasOpen ||
      (linkChange.action === "unlink" &&
        source.attempt.unlinkedAt !== undefined)
    ) {
      setLinkChange(null);
      setWorkspaceMessage(
        "The plan link changed while this confirmation was open. Review the latest context.",
      );
      return;
    }
    if (linkChange.action === "move" && !selectedDestinationContext) {
      setWorkspaceMessage("Choose an available destination work item.");
      return;
    }
    const changedAt = new Date().toISOString();
    setWorkspaceBusy(true);
    const result = await workspace.mutate(
      linkChange.action === "unlink"
        ? {
            type: "taskLink.unlink",
            codexTaskId: task.id,
            from: source.location,
            unlinkedAt: changedAt,
          }
        : {
            type: "taskLink.move",
            codexTaskId: task.id,
            from: source.location,
            to: {
              projectId: project.id,
              objectiveId: selectedDestinationContext!.objective.id,
              workItemId: selectedDestinationContext!.workItem.id,
              attemptId: createLocalId("attempt"),
            },
            movedAt: changedAt,
            baselineResultKey: {
              kind: "revision",
              id: attentionEventKey(task),
            },
          },
    );
    setWorkspaceBusy(false);
    if (!result.ok) {
      setLinkReconciling(true);
      setLinkChange(null);
      setWorkspaceMessage(
        "Coffice could not confirm that plan-link change. Refreshing the latest plan before another attempt.",
      );
      await workspace.refresh();
      setLinkReconciling(false);
      window.requestAnimationFrame(() =>
        linkChangeTriggerRef.current?.focus({ preventScroll: true }),
      );
      return;
    }
    const action = linkChange.action;
    setLinkChange(null);
    setWorkspaceMessage(
      action === "move"
        ? linkChange.sourceWasOpen
          ? "Plan link moved. Earlier results and quality-check receipts remain in their original work context."
          : "Tracking resumed. Earlier results and quality-check receipts remain in their original work context."
        : "Task unlinked. Earlier results and quality-check receipts remain available in Plan.",
    );
    window.requestAnimationFrame(() =>
      linkChangeStatusRef.current?.focus({ preventScroll: true }),
    );
  };

  const linkTask = async (event: FormEvent) => {
    event.preventDefault();
    if (!activeObjective || !managedProject) return;
    if (targetWorkItemId !== "new" && !targetWorkItem) {
      setWorkspaceMessage("Choose an available work item and try again.");
      return;
    }
    const at = new Date().toISOString();
    const attempt: CodexTaskAttempt = {
      id: createLocalId("attempt"),
      codexTaskId: task.id,
      relationship:
        targetWorkItemId === "new" || !targetHasAttempts
          ? "primary"
          : relationship,
      linkedAt: at,
      resultCycles: initialLinkResult ? [initialLinkResult] : [],
    };
    setWorkspaceBusy(true);
    const result =
      targetWorkItemId === "new"
        ? await workspace.mutate({
            type: "workItem.upsert",
            projectId: project.id,
            objectiveId: activeObjective.id,
            workItem: {
              id: createLocalId("work"),
              title: trackTitle.trim(),
              expectedOutcome: trackOutcome.trim(),
              status:
                candidate?.kind === "ready_for_review"
                  ? "ready_for_review"
                  : "in_progress",
              createdAt: at,
              updatedAt: at,
              attempts: [attempt],
            },
          })
        : await workspace.mutate({
            type: "attempt.upsert",
            projectId: project.id,
            objectiveId: activeObjective.id,
            workItemId: targetWorkItem!.id,
            attempt,
          });
    setWorkspaceBusy(false);
    if (!result.ok) {
      setWorkspaceMessage(
        "This task was not linked. Review the latest plan and try again.",
      );
      return;
    }
    setTrackingOpen(false);
    setWorkspaceMessage("Task linked to the work plan.");
  };

  const saveCurrentResultReview = async (
    result: Omit<CodexResultCycle, "review">,
    reviewedAt: string,
  ) => {
    if (!workContext) return false;
    const existingResult = workContext.attempt.resultCycles.find((candidate) =>
      sameResultKey(candidate.key, result.key),
    );
    if (!existingResult) {
      const observed = await workspace.mutate({
        type: "result.upsert",
        projectId: workContext.project.id,
        objectiveId: workContext.objective.id,
        workItemId: workContext.workItem.id,
        attemptId: workContext.attempt.id,
        result,
      });
      if (!observed.ok) {
        return false;
      }
    }
    if (!existingResult?.review) {
      const reviewed = await workspace.mutate({
        type: "result.review",
        projectId: workContext.project.id,
        objectiveId: workContext.objective.id,
        workItemId: workContext.workItem.id,
        attemptId: workContext.attempt.id,
        resultKey: result.key,
        reviewedAt,
      });
      if (!reviewed.ok) return false;
    }
    return true;
  };

  const markCandidateReviewed = async () => {
    if (!candidate) return;
    if (!workContext || !resultToReview || !resultReviewable) {
      setWorkspaceBusy(true);
      const receiptSaved = await review.markReviewed(candidate.eventKey);
      setWorkspaceBusy(false);
      setWorkspaceMessage(
        receiptSaved
          ? "Result marked reviewed."
          : "This result was not marked reviewed because its Attention receipt was not saved.",
      );
      window.requestAnimationFrame(() =>
        linkChangeStatusRef.current?.focus({ preventScroll: true }),
      );
      return;
    }
    setWorkspaceBusy(true);
    const reviewed = await saveCurrentResultReview(
      resultToReview,
      new Date().toISOString(),
    );
    if (!reviewed) {
      setWorkspaceBusy(false);
      setWorkspaceMessage("The completed result was not marked reviewed.");
      return;
    }
    const receiptSaved = await review.markReviewed(candidate.eventKey);
    setWorkspaceBusy(false);
    setWorkspaceMessage(
      receiptSaved
        ? "Result marked reviewed. Accept, redirect, or reject it when ready."
        : "Result marked reviewed in Plan. Its separate Attention receipt was not saved, but the durable result review still resolves this completion.",
    );
    window.requestAnimationFrame(() =>
      linkChangeStatusRef.current?.focus({ preventScroll: true }),
    );
  };

  const decideAttempt = async (pending: NonNullable<typeof decisionMode>) => {
    if (
      !workContext ||
      !resultToReview ||
      !resultReviewable ||
      !sameResultKey(pending.result.key, resultToReview.key)
    ) {
      setDecisionMode(null);
      setWorkspaceMessage("A newer result arrived. Review it before deciding.");
      return;
    }
    const { kind, result } = pending;
    setWorkspaceBusy(true);
    const decidedAt = new Date().toISOString();
    const reviewed = await saveCurrentResultReview(result, decidedAt);
    if (!reviewed) {
      setWorkspaceBusy(false);
      setWorkspaceMessage("The review decision was not saved.");
      return;
    }
    const decided = await workspace.mutate({
      type: "result.decide",
      projectId: workContext.project.id,
      objectiveId: workContext.objective.id,
      workItemId: workContext.workItem.id,
      attemptId: workContext.attempt.id,
      resultKey: result.key,
      decision: { kind, decidedAt },
      evidence: {
        id: createLocalId("decision"),
        kind: "decision",
        outcome: "neutral",
        decisionKind: kind,
        summary:
          kind === "accepted"
            ? "User accepted this result."
            : kind === "rejected"
              ? "User rejected this result."
              : "User requested another pass.",
        recordedAt: decidedAt,
        projectId: workContext.project.id,
        objectiveId: workContext.objective.id,
        workItemId: workContext.workItem.id,
        attemptId: workContext.attempt.id,
        resultKey: result.key,
        provenance: { source: "user" },
      },
    });
    if (!decided.ok) {
      setWorkspaceBusy(false);
      setWorkspaceMessage("The review decision was not saved.");
      return;
    }
    setDecisionMode(null);
    const receiptSaved = candidate
      ? await review.markReviewed(candidate.eventKey)
      : true;
    setWorkspaceBusy(false);
    window.requestAnimationFrame(() =>
      decisionStatusRef.current?.focus({ preventScroll: true }),
    );
    setWorkspaceMessage(
      `${
        kind === "accepted"
          ? "Result accepted. This work item is complete."
          : kind === "redirected"
            ? "Another pass requested. The work item remains open."
            : "Result rejected. The work item remains open."
      }${
        receiptSaved
          ? ""
          : " The separate Attention receipt was not saved, but the durable result review still resolves this completion."
      }`,
    );
  };

  const reviewState =
    resultDurablyReviewed || disposition?.kind === "reviewed"
      ? "Reviewed"
      : disposition?.kind === "dismissed"
        ? "Dismissed"
        : baselined
          ? "Existing result"
          : snoozed
            ? "Snoozed"
            : candidate
              ? KIND_LABELS[candidate.kind]
              : task.status.value
                  .replaceAll("_", " ")
                  .replace(/^./u, (letter) => letter.toLocaleUpperCase());

  return (
    <aside
      ref={panelRef}
      className={`${styles.reviewPanel}${savedComparisonOpen ? ` ${styles.reviewPanelComparing}` : ""}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="review-act-heading"
      data-review-act-inspector="true"
    >
      <header className={styles.panelHeader}>
        <div className={styles.reviewHeading}>
          <small>Review &amp; act</small>
          <h2 id="review-act-heading" title={task.title}>
            {displayName}
          </h2>
          <span>{reviewState}</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close review inspector"
        >
          ×
        </button>
      </header>

      <section
        className={styles.primaryAction}
        aria-labelledby="next-action-heading"
      >
        <div>
          <small>Coffice recommendation</small>
          <h3 id="next-action-heading">Next action</h3>
          <p>
            {resultDurablyReviewed
              ? storedResult?.review?.decision
                ? "This result has a recorded decision. Open it in Codex if you need to inspect the underlying work."
                : "This result is reviewed. Accept it or choose another pass below."
              : recommendedAction(task, candidate)}
          </p>
        </div>
        <a
          ref={openInCodexRef}
          href={`codex://threads/${encodeURIComponent(task.id)}`}
          data-dialog-initial-focus="true"
        >
          Open in Codex <span aria-hidden="true">↗</span>
        </a>
      </section>

      {candidate ? (
        <div className={styles.reviewActions} aria-label="Inbox actions">
          {resultDurablyReviewed ? (
            <span className={styles.reviewResolution} role="status">
              Reviewed in Plan. This completion no longer needs Attention.
            </span>
          ) : baselined ? (
            <>
              <button
                type="button"
                disabled={!review.persistent || workspaceBusy}
                onClick={() => void markCandidateReviewed()}
              >
                Mark reviewed
              </button>
              <button
                type="button"
                disabled={!review.persistent}
                onClick={() => review.restore(candidate.eventKey)}
              >
                Add to inbox
              </button>
            </>
          ) : explicitlyResolved || snoozed ? (
            <button
              type="button"
              disabled={!review.persistent}
              onClick={() => review.restore(candidate.eventKey)}
            >
              Restore to inbox
            </button>
          ) : candidate.kind === "ready_for_review" ? (
            <button
              type="button"
              disabled={!review.persistent || workspaceBusy}
              onClick={() => void markCandidateReviewed()}
            >
              Mark reviewed
            </button>
          ) : (
            <button
              type="button"
              disabled={!review.persistent}
              onClick={() => review.dismiss(candidate.eventKey)}
            >
              Dismiss this signal
            </button>
          )}
          {!resultDurablyReviewed &&
          !baselined &&
          !explicitlyResolved &&
          !snoozed ? (
            <button
              type="button"
              disabled={!review.persistent}
              onClick={() => review.snooze(candidate.eventKey, 60 * 60 * 1000)}
            >
              Snooze 1 hour
            </button>
          ) : null}
        </div>
      ) : null}

      <section
        className={styles.workLink}
        aria-labelledby="work-context-heading"
      >
        <div className={styles.sectionHeading}>
          <h3 id="work-context-heading">Work context</h3>
          <span>
            {openWorkContext
              ? displayingHistoricalResult
                ? "Historical result"
                : linkMismatch || linkOrphaned
                  ? "Link needs attention"
                  : "Coffice plan"
              : latestClosedWorkContext
                ? "History only"
                : "Not linked"}
          </span>
        </div>
        {linkMismatch ? (
          <p className={styles.linkWarning} role="status">
            Codex now assigns this task to <strong>{project.name}</strong>, but
            its active Coffice plan link remains in{" "}
            <strong>{openWorkContext?.project.title}</strong>.
          </p>
        ) : linkOrphaned ? (
          <p className={styles.linkWarning} role="status">
            Codex now reports this task as unassigned, but it still has an
            active Coffice plan link in{" "}
            <strong>{openWorkContext?.project.title}</strong>.
          </p>
        ) : openWorkContext && assignmentRelocationUnavailable ? (
          <p className={styles.linkNotice} role="status">
            {linkChangeBlockedReason}
          </p>
        ) : null}
        {workContext ? (
          <div className={styles.workContext}>
            <span>
              {workContext.project.title} · {workContext.objective.title}
            </span>
            <strong>{workContext.workItem.title}</strong>
            <p>{workContext.workItem.expectedOutcome}</p>
            <section
              className={styles.currentProjectRules}
              data-current-project-rules="true"
              aria-labelledby="current-project-rules-heading"
            >
              <div className={styles.currentProjectRulesHeading}>
                <h4 id="current-project-rules-heading">
                  Current project rules
                </h4>
                <span>
                  {workContext.project.rules?.length
                    ? `${workContext.project.rules.length} ${workContext.project.rules.length === 1 ? "rule" : "rules"}`
                    : "Not recorded"}
                </span>
              </div>
              {workContext.project.rules?.length ? (
                <ol>
                  {workContext.project.rules.map((rule, index) => (
                    <li key={`${index}-${rule}`}>{rule}</li>
                  ))}
                </ol>
              ) : (
                <p>No project rules recorded.</p>
              )}
              <small>
                Current project context—not a snapshot stored with this result.
                Coffice does not enforce these rules or treat them as evidence.
              </small>
            </section>
            {workContext.project.contextReview ? (
              <section
                className={styles.projectContextReview}
                data-current-project-context-review="true"
                aria-labelledby="current-project-context-review-heading"
                role="note"
              >
                <div className={styles.projectContextReviewHeading}>
                  <h4 id="current-project-context-review-heading">
                    Current context needs review
                  </h4>
                  <span>
                    {workContext.project.contextReview.concerns
                      .map((concern) =>
                        concern === "stale" ? "Stale" : "Contradictory",
                      )
                      .join(" + ")}
                  </span>
                </div>
                {workContext.project.contextReview.note ? (
                  <p>{workContext.project.contextReview.note}</p>
                ) : null}
                <small>
                  Flagged{" "}
                  {compactTimestamp(workContext.project.contextReview.markedAt)}{" "}
                  by you. User-declared current project context—not inferred and
                  not a snapshot stored with this result. Review and acceptance
                  remain your decisions.
                </small>
              </section>
            ) : null}
            <section
              className={styles.projectQualityBars}
              data-current-project-quality-bars="true"
              aria-labelledby="current-project-quality-bars-heading"
            >
              <div className={styles.projectQualityBarsHeading}>
                <h4 id="current-project-quality-bars-heading">
                  Current project quality bars
                </h4>
                <span
                  data-quality-bar-readiness={
                    qualityBarReadiness?.state ?? "not_configured"
                  }
                >
                  {qualityBarReadinessLabel(
                    qualityBarReadiness?.state ?? "not_configured",
                  )}
                </span>
              </div>
              {qualityBarReadiness?.bars.length ? (
                <ul>
                  {qualityBarReadiness.bars.map((bar) => (
                    <li key={bar.bar.profileId}>
                      <strong>{bar.label}</strong>
                      <span>{qualityBarResultLabel(bar.state)}</span>
                      {bar.recordedAt ? (
                        <small>
                          Recorded {compactTimestamp(bar.recordedAt)}
                        </small>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No project quality bars selected.</p>
              )}
              <small>
                Current project standard—not a snapshot stored with this result.
                Coffice does not run checks automatically or block acceptance.
              </small>
            </section>
            <section
              className={styles.currentWorkLinks}
              data-current-work-links="true"
              aria-labelledby="current-work-links-heading"
            >
              <div className={styles.currentWorkLinksHeading}>
                <h4 id="current-work-links-heading">Current work links</h4>
                <span>
                  {workContext.workItem.relationships?.length
                    ? `${workContext.workItem.relationships.length} ${workContext.workItem.relationships.length === 1 ? "link" : "links"}`
                    : "Not recorded"}
                </span>
              </div>
              {workContext.workItem.relationships?.length ? (
                <ol>
                  {workContext.workItem.relationships.map(
                    (relationship, index) => {
                      const target = workContext.project.objectives
                        .find(
                          (objective) =>
                            objective.id === relationship.targetObjectiveId,
                        )
                        ?.workItems.find(
                          (item) => item.id === relationship.targetWorkItemId,
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
                    },
                  )}
                </ol>
              ) : (
                <p>No dependencies or handoffs recorded.</p>
              )}
              <small>
                Current work-item context—not a snapshot stored with this
                result. These links are advisory and do not determine readiness
                or acceptance.
              </small>
            </section>
            <section
              className={styles.definitionOfDone}
              data-current-definition-of-done="true"
              aria-labelledby="definition-of-done-heading"
            >
              <div className={styles.definitionOfDoneHeading}>
                <h4 id="definition-of-done-heading">
                  Current definition of done
                </h4>
                <span>
                  {workContext.workItem.definitionOfDone?.length
                    ? `${workContext.workItem.definitionOfDone.length} ${workContext.workItem.definitionOfDone.length === 1 ? "criterion" : "criteria"}`
                    : "Not recorded"}
                </span>
              </div>
              {workContext.workItem.definitionOfDone?.length ? (
                <ol>
                  {workContext.workItem.definitionOfDone.map(
                    (criterion, index) => (
                      <li key={`${index}-${criterion}`}>{criterion}</li>
                    ),
                  )}
                </ol>
              ) : (
                <p>No definition of done recorded.</p>
              )}
              <small>
                Current work-item context—not a snapshot stored with this
                result. Coffice does not verify these criteria automatically.
              </small>
            </section>
            <small>
              Attempt{" "}
              {workContext.workItem.attempts.indexOf(workContext.attempt) + 1}
              {workContext.workItem.attempts.length > 1
                ? ` of ${workContext.workItem.attempts.length}`
                : ""}
              {` · ${workContext.attempt.relationship}`}
            </small>
            {workContext.attempt.unlinkedAt ? (
              <small>
                No longer tracked here · unlinked{" "}
                {relativeTime(workContext.attempt.unlinkedAt, referenceTime)}.
              </small>
            ) : null}
            {displayingHistoricalResult ? (
              <small className={styles.currentLinkNotice}>
                Current tracking: {openWorkContext?.project.title} ·{" "}
                {openWorkContext?.workItem.title}.
              </small>
            ) : null}
            {savedComparison?.alternatives.length ? (
              <button
                ref={savedComparisonTriggerRef}
                type="button"
                className={styles.savedComparisonTrigger}
                aria-expanded={savedComparisonOpen}
                onClick={() => {
                  const first = savedComparison.alternatives[0];
                  if (!first) return;
                  setSavedComparisonStatus("");
                  setSavedComparisonBinding(first.binding);
                  window.requestAnimationFrame(() =>
                    savedComparisonSelectRef.current?.focus({
                      preventScroll: true,
                    }),
                  );
                }}
              >
                Compare saved evidence
              </button>
            ) : null}
            <p
              ref={savedComparisonStatusRef}
              className={styles.savedComparisonStatus}
              aria-live="polite"
              {...(savedComparisonStatus
                ? { role: "status", tabIndex: -1 }
                : {})}
            >
              {savedComparisonStatus}
            </p>
            {savedComparisonOpen && savedComparisonPair && savedComparison ? (
              <section
                className={styles.savedComparison}
                aria-labelledby="saved-comparison-heading"
              >
                <div className={styles.savedComparisonHeading}>
                  <div>
                    <h4 id="saved-comparison-heading">
                      Compare saved evidence
                    </h4>
                    <p>
                      Review Coffice’s saved records for two exact results. This
                      does not compare the work itself.
                    </p>
                  </div>
                  <button type="button" onClick={closeSavedComparison}>
                    Close comparison
                  </button>
                </div>
                <label className={styles.savedComparisonPicker}>
                  Saved alternative
                  <select
                    ref={savedComparisonSelectRef}
                    value={selectedAlternativeToken}
                    onChange={(event) => {
                      const index = Number(
                        event.currentTarget.value.replace("alternative-", ""),
                      );
                      const selected = savedComparison.alternatives[index - 1];
                      if (selected) {
                        setSavedComparisonBinding(selected.binding);
                        setSavedComparisonStatus(
                          `Showing saved alternative ${index} of ${savedComparison.alternatives.length}.`,
                        );
                      }
                    }}
                  >
                    {savedComparison.alternatives.map((alternative, index) => (
                      <option
                        key={`alternative-${index + 1}`}
                        value={`alternative-${index + 1}`}
                      >
                        Alternative {index + 1} · Attempt{" "}
                        {alternative.presentation.attemptNumber} · Result{" "}
                        {alternative.presentation.resultNumber}
                      </option>
                    ))}
                  </select>
                </label>
                <div className={styles.savedComparisonGrid}>
                  <SavedEvidenceCard
                    title="Selected result"
                    evidence={savedComparisonPair.reference.presentation}
                  />
                  <SavedEvidenceCard
                    title="Alternative result"
                    evidence={savedComparisonPair.alternative.presentation}
                  />
                </div>
                <p className={styles.savedComparisonPrivacy}>
                  No result content, changes, or task messages were inspected.
                  Coffice does not score, rank, or recommend either result.
                </p>
              </section>
            ) : null}
            {activeProjectDecisions.length && decisionProjectTitle ? (
              <details
                className={styles.projectDecisions}
                data-current-project-decisions={decisionProjectId}
              >
                <summary
                  aria-label={`${activeProjectDecisions.length} current project decision${activeProjectDecisions.length === 1 ? "" : "s"} for ${decisionProjectTitle}`}
                >
                  Current project decisions · {activeProjectDecisions.length}
                </summary>
                <div className={styles.projectDecisionBody}>
                  <span>
                    You recorded in Coffice · Current for {decisionProjectTitle}
                  </span>
                  <small className={styles.projectDecisionNotice}>
                    Current project context—not a snapshot stored with this
                    result.
                  </small>
                  <ul>
                    {activeProjectDecisions.map((decision) => (
                      <li
                        key={decision.id}
                        data-project-decision-id={decision.id}
                      >
                        <p>{decision.statement}</p>
                        {decision.context ? (
                          <small>{decision.context}</small>
                        ) : null}
                        <time dateTime={decision.recordedAt}>
                          {compactTimestamp(decision.recordedAt)}
                        </time>
                      </li>
                    ))}
                  </ul>
                </div>
              </details>
            ) : null}
            {exactAssessmentTarget ? (
              <>
                <ReviewAssessmentCard
                  controller={workspace}
                  target={exactAssessmentTarget}
                  scopeLabel="Exact result"
                  showAgentSelfCritique
                />
                <DecisionRequestsCard
                  controller={workspace}
                  target={exactAssessmentTarget}
                  scopeLabel="Exact result"
                />
              </>
            ) : null}
            {workAssessmentTarget ? (
              <>
                <ReviewAssessmentCard
                  controller={workspace}
                  target={workAssessmentTarget}
                  scopeLabel="Work item"
                  showAgentSelfCritique={!exactAssessmentTarget}
                />
                <DecisionRequestsCard
                  controller={workspace}
                  target={workAssessmentTarget}
                  scopeLabel="Work item"
                />
              </>
            ) : null}
            {storedResult?.review?.decision ? (
              <b
                ref={decisionStatusRef}
                tabIndex={-1}
                role="status"
                data-result-decision={storedResult.review.decision.kind}
              >
                {storedResult.review.decision.kind}
              </b>
            ) : decisionConfirmation ? (
              <div
                className={styles.actionConfirmation}
                role="group"
                aria-label="Confirm result decision"
              >
                <small>Confirm result decision</small>
                <strong>{workContext.workItem.title}</strong>
                <p>
                  {decisionConfirmation.kind === "accepted"
                    ? "Accept this result and complete the work item."
                    : decisionConfirmation.kind === "redirected"
                      ? "Request another pass and keep the work item open."
                      : "Reject this result and keep the work item open."}
                </p>
                <small>
                  Result observed{" "}
                  {relativeTime(
                    decisionConfirmation.result.observedAt,
                    referenceTime,
                  )}
                </small>
                {decisionConfirmation.kind === "accepted" ? (
                  <p id="accept-quality-bars-advisory" role="note">
                    {qualityBarReadiness?.bars.length
                      ? `Current project quality bars: ${qualityBarReadinessLabel(qualityBarReadiness.state)}. Coffice does not run checks automatically or block acceptance.`
                      : "No project quality bars are selected. Acceptance remains your decision."}
                  </p>
                ) : null}
                {decisionConfirmation.kind === "accepted" ? (
                  <p id="accept-definition-of-done-advisory" role="note">
                    {workContext.workItem.definitionOfDone?.length
                      ? `Definition of Done has ${workContext.workItem.definitionOfDone.length} current ${workContext.workItem.definitionOfDone.length === 1 ? "criterion" : "criteria"}. Coffice does not verify them automatically; acceptance is your decision.`
                      : "No Definition of Done is recorded for this work item. Acceptance is your decision."}
                  </p>
                ) : null}
                {decisionConfirmation.kind === "accepted" ? (
                  <p id="accept-work-links-advisory" role="note">
                    {workContext.workItem.relationships?.length
                      ? `This work item has ${workContext.workItem.relationships.length} current advisory work ${workContext.workItem.relationships.length === 1 ? "link" : "links"}. Coffice does not infer readiness from them; acceptance is your decision.`
                      : "No dependencies or handoffs are recorded. Acceptance is your decision."}
                  </p>
                ) : null}
                {decisionConfirmation.kind === "accepted" &&
                workContext.project.contextReview ? (
                  <p id="accept-context-review-advisory" role="note">
                    Current project context is user-flagged for review. Coffice
                    does not infer whether it affects this result or block
                    acceptance; this decision remains yours.
                  </p>
                ) : null}
                {decisionConfirmation.kind === "accepted" &&
                (acceptanceUnresolvedCount > 0 ||
                  acceptanceConflictingActions > 0) ? (
                  <p id="accept-assessment-warning" role="note">
                    {acceptanceUnresolvedCount > 0
                      ? `${acceptanceUnresolvedCount} unresolved review note${acceptanceUnresolvedCount === 1 ? "" : "s"} remain across the exact result and work item. `
                      : ""}
                    {acceptanceConflictingActions > 0
                      ? `${acceptanceConflictingActions} saved advisory next action${acceptanceConflictingActions === 1 ? " does" : "s do"} not recommend acceptance. `
                      : ""}
                    Accepting keeps these annotations and does not perform or
                    clear any advisory action.
                  </p>
                ) : null}
                <div className={styles.formActions}>
                  <button
                    type="button"
                    autoFocus
                    disabled={workspaceBusy || !workspace.persistent}
                    aria-describedby={
                      decisionConfirmation.kind === "accepted"
                        ? [
                            "accept-quality-bars-advisory",
                            "accept-definition-of-done-advisory",
                            "accept-work-links-advisory",
                            ...(workContext.project.contextReview
                              ? ["accept-context-review-advisory"]
                              : []),
                            acceptanceUnresolvedCount > 0 ||
                            acceptanceConflictingActions > 0
                              ? "accept-assessment-warning"
                              : null,
                          ]
                            .filter(Boolean)
                            .join(" ")
                        : undefined
                    }
                    onClick={() => void decideAttempt(decisionConfirmation)}
                  >
                    {workspaceBusy ? "Saving…" : "Confirm decision"}
                  </button>
                  <button
                    type="button"
                    disabled={workspaceBusy}
                    onClick={() => {
                      const kind = decisionConfirmation.kind;
                      setDecisionMode(null);
                      window.requestAnimationFrame(() => {
                        const target =
                          kind === "accepted"
                            ? acceptDecisionRef.current
                            : kind === "redirected"
                              ? redirectDecisionRef.current
                              : rejectDecisionRef.current;
                        target?.focus({ preventScroll: true });
                      });
                    }}
                  >
                    Back
                  </button>
                </div>
              </div>
            ) : resultReviewable ? (
              <div className={styles.decisionActions}>
                <button
                  ref={acceptDecisionRef}
                  type="button"
                  disabled={workspaceBusy || !workspace.persistent}
                  onClick={() =>
                    resultToReview &&
                    setDecisionMode({
                      kind: "accepted",
                      result: resultToReview,
                    })
                  }
                >
                  Accept result
                </button>
                <button
                  ref={redirectDecisionRef}
                  type="button"
                  disabled={workspaceBusy || !workspace.persistent}
                  onClick={() =>
                    resultToReview &&
                    setDecisionMode({
                      kind: "redirected",
                      result: resultToReview,
                    })
                  }
                >
                  Needs another pass
                </button>
                <button
                  ref={rejectDecisionRef}
                  type="button"
                  disabled={workspaceBusy || !workspace.persistent}
                  onClick={() =>
                    resultToReview &&
                    setDecisionMode({
                      kind: "rejected",
                      result: resultToReview,
                    })
                  }
                >
                  Reject result
                </button>
              </div>
            ) : (
              <small className={styles.workHint}>
                Review choices appear when this attempt has a completed result.
              </small>
            )}
            {workEvidence.length ? (
              <ul
                className={styles.evidenceReceipts}
                aria-label="Work receipts"
              >
                {[...workEvidence]
                  .reverse()
                  .slice(0, 3)
                  .map((record) => (
                    <li key={record.id}>
                      <span>
                        {record.kind === "verification" &&
                        record.provenance.reference?.startsWith(
                          "codex-operation:",
                        )
                          ? "Codex review activity"
                          : record.kind === "verification"
                            ? "Legacy activity · not quality proof"
                            : record.provenance.reference?.startsWith(
                                  "codex-operation:",
                                )
                              ? "Codex action activity"
                              : record.kind.replaceAll("_", " ")}
                      </span>
                      {record.summary}
                    </li>
                  ))}
              </ul>
            ) : null}
            {relocationSource && !linkChange ? (
              <div className={styles.linkActions}>
                {assignmentEvidence === "explicit_project" ? (
                  <button
                    ref={linkChangeTriggerRef}
                    type="button"
                    disabled={
                      Boolean(linkChangeBlockedReason) ||
                      linkReconciling ||
                      Boolean(activeActionMode) ||
                      Boolean(cancelOperationId)
                    }
                    onClick={() => beginLinkChange("move")}
                  >
                    {openWorkContext
                      ? linkMismatch
                        ? "Move plan link"
                        : "Change plan link"
                      : "Resume tracking"}
                  </button>
                ) : assignmentEvidence !== "explicit_unassigned" ? (
                  <button ref={linkChangeTriggerRef} type="button" disabled>
                    Change plan link
                  </button>
                ) : null}
                {openWorkContext &&
                (assignmentEvidence === "explicit_project" ||
                  assignmentEvidence === "explicit_unassigned") ? (
                  <button
                    ref={
                      assignmentEvidence === "explicit_unassigned"
                        ? linkChangeTriggerRef
                        : undefined
                    }
                    type="button"
                    disabled={
                      Boolean(linkChangeBlockedReason) ||
                      linkReconciling ||
                      Boolean(activeActionMode) ||
                      Boolean(cancelOperationId)
                    }
                    onClick={() => beginLinkChange("unlink")}
                  >
                    Unlink from plan
                  </button>
                ) : null}
              </div>
            ) : null}
            {linkChangeBlockedReason && relocationSource ? (
              <small className={styles.workHint}>
                {linkChangeBlockedReason}
              </small>
            ) : null}
          </div>
        ) : (
          <>
            <p>
              {workContextAmbiguous
                ? "This Codex task is linked to more than one saved attempt. Resolve the duplicate links in Plan before reviewing or checking a result."
                : "Link this Codex attempt to a work item so review decisions stay tied to the outcome you actually want."}
            </p>
            <button
              type="button"
              className={styles.trackButton}
              disabled={
                workContextAmbiguous ||
                !activeObjective ||
                !workspace.persistent ||
                project.holding
              }
              onClick={() => {
                setTrackingOpen((open) => !open);
                setWorkspaceMessage(null);
              }}
            >
              Track this work
            </button>
            {!activeObjective && !project.holding ? (
              <small className={styles.workHint}>
                Set a project objective from Plan before linking tasks.
              </small>
            ) : null}
            {project.holding ? (
              <small className={styles.workHint}>
                Assign this task to a Codex project before linking project work.
              </small>
            ) : null}
          </>
        )}

        {trackingOpen && activeObjective ? (
          <form className={styles.workForm} onSubmit={linkTask}>
            {activeObjective.workItems.length ? (
              <label>
                Link to
                <select
                  value={targetWorkItemId}
                  onChange={(event) =>
                    setTargetWorkItemId(event.currentTarget.value)
                  }
                >
                  <option value="new">New work item</option>
                  {activeObjective.workItems
                    .filter(
                      (item) =>
                        item.status !== "accepted" &&
                        item.status !== "cancelled",
                    )
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.title}
                      </option>
                    ))}
                </select>
              </label>
            ) : null}
            {targetWorkItemId === "new" ? (
              <>
                <label>
                  Work item
                  <input
                    autoFocus
                    value={trackTitle}
                    maxLength={320}
                    onChange={(event) =>
                      setTrackTitle(event.currentTarget.value)
                    }
                    required
                  />
                </label>
                <label>
                  Expected outcome
                  <textarea
                    value={trackOutcome}
                    maxLength={1000}
                    rows={3}
                    onChange={(event) =>
                      setTrackOutcome(event.currentTarget.value)
                    }
                    placeholder="What result would you accept?"
                    required
                  />
                </label>
              </>
            ) : targetHasAttempts ? (
              <label>
                Attempt relationship
                <select
                  value={relationship}
                  onChange={(event) =>
                    setRelationship(
                      event.currentTarget
                        .value as CodexTaskAttempt["relationship"],
                    )
                  }
                >
                  <option value="retry">Retry</option>
                  <option value="alternative">Alternative</option>
                  <option value="handoff">Handoff</option>
                </select>
              </label>
            ) : (
              <small className={styles.workHint}>
                This will be the primary attempt for the selected work item.
              </small>
            )}
            <div className={styles.formActions}>
              <button type="submit" disabled={workspaceBusy}>
                {workspaceBusy ? "Saving…" : "Link task"}
              </button>
              <button type="button" onClick={() => setTrackingOpen(false)}>
                Cancel
              </button>
            </div>
          </form>
        ) : null}
        {linkChange ? (
          <div
            className={styles.linkChange}
            role="group"
            aria-label={
              linkChange.action === "move"
                ? "Change plan link"
                : "Unlink task from plan"
            }
          >
            {linkChange.action === "move" && linkChange.step === "choose" ? (
              <>
                <small>
                  {openWorkContext ? "Move plan link" : "Resume tracking"}
                </small>
                <strong>{project.name}</strong>
                {destinationOptions.length ? (
                  <label>
                    Destination work item
                    <select
                      autoFocus
                      value={linkChange.destination ?? ""}
                      onChange={(event) =>
                        setLinkChange((current) =>
                          current
                            ? {
                                ...current,
                                destination: event.currentTarget.value,
                              }
                            : current,
                        )
                      }
                    >
                      {destinationOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.objective.title} · {option.workItem.title}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <p>
                    No planned, in-progress, or blocked work item is available
                    in this project. Open Plan to create one first.
                  </p>
                )}
                <div className={styles.formActions}>
                  <button
                    type="button"
                    disabled={
                      !selectedDestinationContext ||
                      Boolean(linkChangeBlockedReason)
                    }
                    onClick={() =>
                      setLinkChange((current) =>
                        current ? { ...current, step: "confirm" } : current,
                      )
                    }
                  >
                    Continue
                  </button>
                  <button type="button" onClick={closeLinkChange}>
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <>
                <small>
                  {linkChange.action === "move"
                    ? openWorkContext
                      ? "Confirm plan-link move"
                      : "Confirm resumed tracking"
                    : "Confirm unlink"}
                </small>
                <strong>{task.title}</strong>
                {linkChange.action === "move" && selectedDestinationContext ? (
                  <p>
                    {openWorkContext ? (
                      <>
                        From {relocationSource?.project.title} /{" "}
                        {relocationSource?.workItem.title}
                        <br />
                        To {project.name} /{" "}
                        {selectedDestinationContext.workItem.title}
                      </>
                    ) : (
                      <>
                        Resume in {project.name} /{" "}
                        {selectedDestinationContext.workItem.title}
                      </>
                    )}
                  </p>
                ) : (
                  <p>
                    Remove the active link to {relocationSource?.project.title}{" "}
                    / {relocationSource?.workItem.title}.
                  </p>
                )}
                <p>
                  {linkChange.action === "move"
                    ? openWorkContext
                      ? "Coffice changes only the plan link. It does not move or modify the Codex task. Saved results, decisions, and quality-check receipts remain in their original history and are not rerun. Future results attach to the destination work item."
                      : "Coffice opens a new continuation link without changing the Codex task. Saved results, decisions, and quality-check receipts remain in their original history and are not rerun. Future results attach to this work item."
                    : "Coffice will stop using this work item as context for future results. Saved results, decisions, and quality-check receipts remain available in Plan. This does not archive, delete, or move the Codex task."}
                </p>
                {linkChangeBlockedReason ? (
                  <p className={styles.linkWarning} role="status">
                    {linkChangeBlockedReason}
                  </p>
                ) : null}
                <div className={styles.formActions}>
                  <button
                    type="button"
                    disabled={
                      workspaceBusy ||
                      linkReconciling ||
                      Boolean(linkChangeBlockedReason)
                    }
                    onClick={() => void confirmLinkChange()}
                  >
                    {workspaceBusy
                      ? "Saving…"
                      : linkChange.action === "move"
                        ? openWorkContext
                          ? "Move link"
                          : "Resume link"
                        : "Unlink task"}
                  </button>
                  <button
                    type="button"
                    autoFocus
                    disabled={workspaceBusy}
                    onClick={() =>
                      linkChange.action === "move"
                        ? setLinkChange((current) =>
                            current ? { ...current, step: "choose" } : current,
                          )
                        : closeLinkChange()
                    }
                  >
                    Back
                  </button>
                </div>
              </>
            )}
          </div>
        ) : null}
        {workspaceMessage || workspace.error || resultChangedDuringDecision ? (
          <p
            ref={linkChangeStatusRef}
            className={styles.workspaceMessage}
            role="status"
            tabIndex={-1}
          >
            {workspace.error ??
              (resultChangedDuringDecision
                ? "A newer result arrived. Review it before deciding."
                : workspaceMessage)}
          </p>
        ) : null}
      </section>

      {workContext && (resultToReview || resultPendingStorage) ? (
        <QualityChecksSection
          controller={verifications}
          target={verificationTarget}
          workItemTitle={workContext.workItem.title}
          observedAt={
            resultToReview?.observedAt ??
            candidate?.occurredAt ??
            fallbackObservationAt
          }
          pendingStoredResult={resultPendingStorage}
          storedReceipts={workspace.workspace?.verificationReceipts ?? []}
          verificationAllowed={workspace.persistent}
          referenceTime={referenceTime}
        />
      ) : null}

      {pendingCodexRequest && actions ? (
        <PendingCodexRequestPanel
          key={pendingCodexRequest.id}
          request={pendingCodexRequest}
          actions={actions}
          displayName={displayName}
        />
      ) : null}

      <section className={styles.actionSection} aria-labelledby="steer-heading">
        <div className={styles.sectionHeading}>
          <h3 id="steer-heading">Steer in Codex</h3>
          <span>Explicit confirmation</span>
        </div>
        <p>
          Send a follow-up to this task or ask Codex for a separate review of
          its project changes. Finished tasks can also be archived after a
          separate confirmation. Coffice never stores the instruction text.
        </p>

        {!activeActionMode ? (
          <div className={styles.actionChoices}>
            <button
              ref={followUpButtonRef}
              type="button"
              disabled={
                actionUnavailable ||
                actionBusy ||
                Boolean(linkChange) ||
                linkReconciling
              }
              onClick={() => {
                if (linkChange || linkReconciling) return;
                setActionMode("follow_up");
                setActionStep("compose");
                setActionTargetTaskId(task.id);
              }}
            >
              Send follow-up
            </button>
            <button
              ref={reviewButtonRef}
              type="button"
              disabled={
                actionUnavailable ||
                actionBusy ||
                Boolean(linkChange) ||
                linkReconciling
              }
              onClick={() => {
                if (linkChange || linkReconciling) return;
                setActionMode("review");
                setActionStep("confirm");
                setActionTargetTaskId(task.id);
              }}
            >
              Request review
            </button>
            {archiveEligible ? (
              <button
                ref={archiveButtonRef}
                type="button"
                disabled={
                  archiveUnavailable ||
                  actionBusy ||
                  Boolean(linkChange) ||
                  linkReconciling
                }
                onClick={() => {
                  if (linkChange || linkReconciling) return;
                  setActionMode("archive");
                  setActionStep("confirm");
                  setActionTargetTaskId(task.id);
                }}
              >
                Archive task
              </button>
            ) : null}
          </div>
        ) : null}

        {activeActionMode === "follow_up" && actionStep === "compose" ? (
          <form
            className={styles.actionForm}
            onSubmit={(event) => {
              event.preventDefault();
              const instruction = followUpText.trim();
              if (!instruction) return;
              if (repairBindingChanged) {
                setRepairContextInserted(false);
                setRepairContextFingerprint(null);
                setPlanContextStatus(
                  "The failed check, result, plan link, or copied plan context changed. Your draft was preserved as ordinary text. Review it again before sending.",
                );
                window.requestAnimationFrame(() =>
                  followUpTextRef.current?.focus({ preventScroll: true }),
                );
                return;
              }
              setConfirmedFollowUpText(instruction);
              setActionStep("confirm");
            }}
          >
            <label>
              Follow-up instruction
              <textarea
                ref={followUpTextRef}
                autoFocus
                value={followUpText}
                maxLength={8000}
                rows={4}
                onChange={(event) => {
                  setFollowUpText(event.currentTarget.value);
                  setPlanContextStatus(null);
                }}
                placeholder="Clarify the next result you want from this task"
                required
              />
            </label>
            <div className={styles.contextInsertRow}>
              <button
                type="button"
                aria-describedby={planContextHelpId}
                disabled={planContextBlockedReason !== null}
                onClick={() => {
                  if (
                    planContextBlockedReason ||
                    planContextResult.kind !== "ready" ||
                    followUpText.length > 0
                  )
                    return;
                  setFollowUpText(planContextResult.text);
                  setPlanContextInserted(true);
                  setRepairContextInserted(false);
                  setRepairContextFingerprint(null);
                  setPlanContextStatus(
                    "Inserted from the current Coffice plan. Review and edit before sending.",
                  );
                  window.requestAnimationFrame(() => {
                    const textarea = followUpTextRef.current;
                    textarea?.focus({ preventScroll: true });
                    textarea?.setSelectionRange(
                      planContextResult.text.length,
                      planContextResult.text.length,
                    );
                  });
                }}
              >
                Insert current plan context
              </button>
              <small id={planContextHelpId}>
                {planContextBlockedReason ??
                  "Copies this task's current Coffice objective, work item, expected outcomes, and active project decisions into the editable instruction. Nothing is sent until you review and confirm."}
              </small>
            </div>
            {repairContextCandidate ? (
              <div className={styles.contextInsertRow}>
                <button
                  type="button"
                  data-repair-follow-up-insert="true"
                  aria-describedby={repairContextHelpId}
                  disabled={repairContextBlockedReason !== null}
                  onClick={() => {
                    if (
                      repairContextBlockedReason ||
                      repairContextResult.kind !== "ready" ||
                      followUpText.length > 0
                    )
                      return;
                    setFollowUpText(repairContextResult.text);
                    setPlanContextInserted(false);
                    setRepairContextInserted(true);
                    setRepairContextFingerprint(
                      repairContextResult.fingerprint,
                    );
                    setPlanContextStatus(
                      "Prepared from the current failed quality check. Review and edit before sending; Coffice has not repaired or rerun anything.",
                    );
                    window.requestAnimationFrame(() => {
                      const textarea = followUpTextRef.current;
                      textarea?.focus({ preventScroll: true });
                      textarea?.setSelectionRange(
                        repairContextResult.text.length,
                        repairContextResult.text.length,
                      );
                    });
                  }}
                >
                  Prepare repair follow-up
                </button>
                <small id={repairContextHelpId}>
                  {repairContextBlockedReason ??
                    "Copies the current plan plus the latest failed check and its status into this editable draft. Nothing is repaired, rerun, or sent until you review and confirm."}
                </small>
              </div>
            ) : null}
            <p className={styles.contextInsertStatus} role="status">
              {planContextStatus}
            </p>
            <div className={styles.formActions}>
              <button type="submit" disabled={!followUpText.trim()}>
                Review before sending
              </button>
              <button
                type="button"
                onClick={() => {
                  setFollowUpText("");
                  setConfirmedFollowUpText("");
                  setPlanContextInserted(false);
                  setRepairContextInserted(false);
                  setRepairContextFingerprint(null);
                  setPlanContextStatus(null);
                  setActionTargetTaskId(null);
                  setActionMode(null);
                  window.requestAnimationFrame(() =>
                    followUpButtonRef.current?.focus({ preventScroll: true }),
                  );
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : null}

        {activeActionMode && actionStep === "confirm" ? (
          <div
            className={styles.actionConfirmation}
            role="group"
            aria-label="Confirm Codex action"
          >
            <small>Confirm target</small>
            <strong>{displayName}</strong>
            {activeActionMode === "follow_up" ? (
              <p
                className={styles.actionPreview}
                data-follow-up-preview="true"
                aria-label="Follow-up instruction to send"
                tabIndex={0}
              >
                {confirmedFollowUpText}
              </p>
            ) : activeActionMode === "review" ? (
              <p aria-label="Review request to send">
                Ask Codex to review uncommitted changes for {project.name} in a
                separate review task.
              </p>
            ) : (
              <p aria-label="Archive request to send">
                Archive this finished task in Codex. It will leave active
                Coffice views after the source refreshes. Saved Coffice plans,
                results, decisions, and receipts remain in the local workspace.
                This does not delete the task.
              </p>
            )}
            {activeActionMode === "follow_up" &&
            (planContextInserted || repairContextInserted) ? (
              <p className={styles.privateContextNote}>
                {repairContextInserted
                  ? "Coffice plan and failed-check context were inserted into this draft. Review the exact text above; Coffice has not repaired or rerun anything and does not store the instruction."
                  : "Coffice plan context was inserted into this draft. Review the exact text above; Coffice does not store the instruction."}
              </p>
            ) : null}
            <div className={styles.formActions}>
              <button
                type="button"
                disabled={
                  actionBusy || actionUnavailable || repairBindingChanged
                }
                onClick={() => {
                  if (repairBindingChanged) {
                    setActionStep("compose");
                    setRepairContextInserted(false);
                    setRepairContextFingerprint(null);
                    setPlanContextStatus(
                      "The failed check, result, plan link, or copied plan context changed. Your draft was preserved as ordinary text. Review it again before sending.",
                    );
                    window.requestAnimationFrame(() =>
                      followUpTextRef.current?.focus({ preventScroll: true }),
                    );
                    return;
                  }
                  void runConfirmedAction();
                }}
              >
                {actionBusy
                  ? activeActionMode === "archive"
                    ? "Archiving…"
                    : "Sending…"
                  : activeActionMode === "review"
                    ? "Confirm review"
                    : activeActionMode === "archive"
                      ? "Archive task"
                      : "Confirm & send"}
              </button>
              <button
                type="button"
                autoFocus
                disabled={actionBusy}
                onClick={() => {
                  if (activeActionMode === "follow_up") {
                    setActionStep("compose");
                    window.requestAnimationFrame(() =>
                      followUpTextRef.current?.focus({ preventScroll: true }),
                    );
                  } else {
                    setActionMode(null);
                    setActionTargetTaskId(null);
                    window.requestAnimationFrame(() =>
                      (activeActionMode === "archive"
                        ? archiveButtonRef.current
                        : reviewButtonRef.current
                      )?.focus({ preventScroll: true }),
                    );
                  }
                }}
              >
                Back
              </button>
            </div>
          </div>
        ) : null}

        {cancelTarget ? (
          <div
            className={styles.actionConfirmation}
            role="group"
            aria-label="Confirm Codex cancellation"
          >
            <small>Confirm stop request</small>
            <strong>{displayName}</strong>
            <p>
              Stop this Coffice-started{" "}
              {cancelTarget.kind === "request_review" ? "review" : "follow-up"}{" "}
              in Codex. Work already completed may remain. Coffice waits for
              Codex to report the final state; if confirmation is lost, the
              outcome stays unknown and Coffice does not retry.
            </p>
            <div className={styles.formActions}>
              <button
                type="button"
                disabled={cancelBusy}
                onClick={() => void runConfirmedCancellation()}
              >
                {cancelBusy ? "Stopping…" : "Stop action"}
              </button>
              <button
                type="button"
                autoFocus
                disabled={cancelBusy}
                onClick={() => {
                  setCancelOperationId(null);
                  window.requestAnimationFrame(() =>
                    stopActionButtonRef.current?.focus({ preventScroll: true }),
                  );
                }}
              >
                Back
              </button>
            </div>
          </div>
        ) : null}

        {actionUnavailable && actions ? (
          <small className={styles.actionHint}>
            {actions.available === false
              ? (actions.error ?? "Codex actions are unavailable.")
              : task.status.stale
                ? "Wait for fresh task status before sending an action."
                : operationActive
                  ? "Coffice is already tracking a Codex action for this task."
                  : !taskActionable
                    ? "This task is not in a safe settled state. Open it in Codex to continue."
                    : "Checking Codex action availability…"}
          </small>
        ) : null}
        {actionNotice ? (
          <div
            ref={operationStatusRef}
            className={styles.operationStatus}
            role="status"
            tabIndex={-1}
          >
            <span data-operation-state={latestOperation?.state}>
              {actionNotice}
            </span>
            {latestOperation?.reviewThreadId ? (
              <a
                href={`codex://threads/${encodeURIComponent(latestOperation.reviewThreadId)}`}
              >
                Open review <span aria-hidden="true">↗</span>
              </a>
            ) : null}
            {cancellableOperation && !cancelOperationId ? (
              <button
                ref={stopActionButtonRef}
                type="button"
                disabled={cancelBusy || Boolean(linkChange) || linkReconciling}
                onClick={() => {
                  if (linkChange || linkReconciling) return;
                  setCancelOperationId(cancellableOperation.id);
                }}
              >
                Stop action
              </button>
            ) : null}
          </div>
        ) : null}
      </section>

      {!review.persistent ? (
        <p className={styles.storageWarning} role="status">
          This review choice cannot be saved because the local Coffice workspace
          is unavailable.
        </p>
      ) : null}

      <section className={styles.reviewSection}>
        <div className={styles.sectionHeading}>
          <h3>Expected outcome</h3>
          <span>
            {workContext
              ? "Coffice work item"
              : expectedOutcome
                ? "Observed task title"
                : "Missing detail"}
          </span>
        </div>
        <p className={styles.outcome}>
          {workContext?.workItem.expectedOutcome ??
            expectedOutcome ??
            "Not reported by the current metadata source for this resident agent."}
        </p>
      </section>

      <section className={styles.reviewSection}>
        <div className={styles.sectionHeading}>
          <h3>Result</h3>
          <span>Missing detail</span>
        </div>
        <p>{resultSummary(task, candidate)}</p>
      </section>

      <section className={styles.evidenceGrid} aria-label="Review evidence">
        <RepositoryEvidenceCard
          project={project}
          referenceTime={referenceTime}
        />
        <article>
          <span>Codex review activity</span>
          <strong>
            {latestCodexReviewActivity
              ? "Review request activity"
              : "No evidence reported"}
          </strong>
          <p>
            {latestCodexReviewActivity?.summary ??
              "No Codex review request activity is attached to this attempt."}
          </p>
        </article>
        <article>
          <span>Risks &amp; self-critique</span>
          <strong>
            {task.status.stale
              ? "Status evidence is stale"
              : task.status.evidence === "inferred"
                ? "Status is inferred"
                : "Not reported"}
          </strong>
          <p>No task-level risk report or self-critique is available.</p>
        </article>
      </section>

      <details className={styles.technicalDetails}>
        <summary>Technical details</summary>
        <dl>
          <div>
            <dt>Status</dt>
            <dd>{task.status.value.replaceAll("_", " ")}</dd>
          </div>
          <div>
            <dt>Evidence</dt>
            <dd>{task.status.evidence}</dd>
          </div>
          <div>
            <dt>Observed</dt>
            <dd>{relativeTime(task.status.timestamp, referenceTime)}</dd>
          </div>
          <div>
            <dt>Source</dt>
            <dd>{task.status.source ?? "Not reported"}</dd>
          </div>
          <div>
            <dt>Model</dt>
            <dd>{task.model ?? "Not reported"}</dd>
          </div>
          <div>
            <dt>Context</dt>
            <dd>{context === null ? "Not reported" : `${context}% used`}</dd>
          </div>
        </dl>
      </details>

      <p className={styles.privacyLine}>
        Coffice stores only your local work plan and structural receipts. It
        reads Codex metadata without modifying Codex state files; confirmed
        actions go through Codex, and prompt, response, and transcript bodies
        are not stored here.
      </p>
    </aside>
  );
}
