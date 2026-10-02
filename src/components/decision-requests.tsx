"use client";

import {
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";

import {
  MAX_DECISION_REQUEST_TEXT_LENGTH,
  reviewAssessmentTargetIdentity,
  type DecisionRequest,
  type ReviewAssessmentTarget,
} from "../lib/coffice-workspace";
import type { CofficeWorkspaceController } from "./use-coffice-workspace";
import styles from "./decision-requests.module.css";

type EditorMode =
  | { kind: "create" }
  | { kind: "edit"; id: string; fingerprint: string }
  | { kind: "resolve"; id: string; fingerprint: string };

const DECISION_TIMESTAMP_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function requestFingerprint(request: DecisionRequest | undefined): string {
  return request ? JSON.stringify(request) : "missing";
}

function decisionRequestId(): string {
  if (typeof crypto.randomUUID === "function") {
    return `decision-${crypto.randomUUID()}`;
  }
  return `decision-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function compactTimestamp(timestamp: string): string {
  return DECISION_TIMESTAMP_FORMATTER.format(new Date(timestamp));
}

export function DecisionRequestsCard({
  controller,
  target,
  scopeLabel,
}: {
  controller: CofficeWorkspaceController;
  target: ReviewAssessmentTarget;
  scopeLabel: "Exact result" | "Work item";
}) {
  const headingId = useId();
  const targetIdentity = reviewAssessmentTargetIdentity(target);
  const latestTargetIdentityRef = useRef(targetIdentity);
  const generationRef = useRef(0);
  const createButtonRef = useRef<HTMLButtonElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const editorTriggerRef = useRef<HTMLButtonElement>(null);
  const removeButtonRef = useRef<HTMLButtonElement>(null);
  const confirmRemoveRef = useRef<HTMLButtonElement>(null);
  const decisionRequests = controller.workspace?.decisionRequests;
  const requests = useMemo(
    () =>
      (decisionRequests ?? [])
        .filter(
          (request) =>
            reviewAssessmentTargetIdentity(request.target) === targetIdentity,
        )
        .sort((left, right) => {
          if (Boolean(left.resolvedAt) !== Boolean(right.resolvedAt)) {
            return left.resolvedAt ? 1 : -1;
          }
          return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
        }),
    [decisionRequests, targetIdentity],
  );
  const openRequests = requests.filter((request) => !request.resolvedAt);
  const resolvedRequests = requests.filter((request) => request.resolvedAt);
  const [editor, setEditor] = useState<EditorMode | null>(null);
  const [openedTarget, setOpenedTarget] =
    useState<ReviewAssessmentTarget | null>(null);
  const [prompt, setPrompt] = useState("");
  const [resolution, setResolution] = useState("");
  const [busy, setBusy] = useState(false);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const selectedRequest =
    editor && editor.kind !== "create"
      ? requests.find((request) => request.id === editor.id)
      : undefined;
  const contextChanged = Boolean(
    editor &&
    openedTarget &&
    reviewAssessmentTargetIdentity(openedTarget) !== targetIdentity,
  );
  const externalChanged = Boolean(
    editor &&
    editor.kind !== "create" &&
    !contextChanged &&
    requestFingerprint(selectedRequest) !== editor.fingerprint,
  );
  const recoveryLocked =
    controller.recovery?.kind === "backup" && !controller.recoveryAcknowledged;
  const writable = controller.persistent && !recoveryLocked;

  useLayoutEffect(() => {
    latestTargetIdentityRef.current = targetIdentity;
    generationRef.current += 1;
  }, [targetIdentity]);

  const focusSoon = (ref: { current: HTMLElement | null }) => {
    requestAnimationFrame(() => ref.current?.focus({ preventScroll: true }));
  };

  const openEditor = (next: EditorMode, trigger: HTMLButtonElement) => {
    const request =
      next.kind === "create"
        ? undefined
        : requests.find((candidate) => candidate.id === next.id);
    generationRef.current += 1;
    editorTriggerRef.current = trigger;
    setOpenedTarget(target);
    setEditor(next);
    setPrompt(request?.prompt ?? "");
    setResolution("");
    setRemoveId(null);
    setMessage(null);
    focusSoon(promptRef);
  };

  const closeEditor = () => {
    setEditor(null);
    setOpenedTarget(null);
    setRemoveId(null);
    focusSoon(editorTriggerRef.current ? editorTriggerRef : createButtonRef);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (
      !editor ||
      !openedTarget ||
      !writable ||
      contextChanged ||
      externalChanged
    )
      return;
    const normalizedPrompt = prompt.trim();
    const normalizedResolution = resolution.trim();
    if (editor.kind !== "resolve" && !normalizedPrompt) {
      setMessage("Describe the decision that is needed.");
      return;
    }
    const generation = generationRef.current;
    const identity = reviewAssessmentTargetIdentity(openedTarget);
    setBusy(true);
    setMessage(null);
    const result = await controller.mutate(
      editor.kind === "create"
        ? {
            type: "decisionRequest.create",
            request: {
              id: decisionRequestId(),
              target: openedTarget,
              prompt: normalizedPrompt,
            },
          }
        : editor.kind === "edit"
          ? {
              type: "decisionRequest.update",
              id: editor.id,
              prompt: normalizedPrompt,
            }
          : {
              type: "decisionRequest.resolve",
              id: editor.id,
              ...(normalizedResolution
                ? { resolution: normalizedResolution }
                : {}),
            },
    );
    if (
      generation !== generationRef.current ||
      identity !== latestTargetIdentityRef.current
    )
      return;
    setBusy(false);
    if (!result.ok) {
      setMessage(
        result.reason === "conflict"
          ? "The workspace changed elsewhere. Your draft is still here; close it and review the latest decision before retrying."
          : "This decision change was not saved. Your draft remains here.",
      );
      return;
    }
    const success =
      editor.kind === "create"
        ? "Decision request added."
        : editor.kind === "edit"
          ? "Decision request updated."
          : "Decision request resolved.";
    setEditor(null);
    setOpenedTarget(null);
    setMessage(success);
    requestAnimationFrame(() =>
      statusRef.current?.focus({ preventScroll: true }),
    );
  };

  const applyLifecycle = async (
    mutation:
      | { type: "decisionRequest.reopen"; id: string }
      | { type: "decisionRequest.remove"; id: string },
  ) => {
    if (!writable) return;
    const generation = generationRef.current;
    const identity = targetIdentity;
    setBusy(true);
    setMessage(null);
    const result = await controller.mutate(mutation);
    if (
      generation !== generationRef.current ||
      identity !== latestTargetIdentityRef.current
    )
      return;
    setBusy(false);
    if (!result.ok) {
      setMessage(
        result.reason === "conflict"
          ? "The workspace changed elsewhere. Review the latest decisions before retrying."
          : "This decision change was not saved.",
      );
      return;
    }
    setRemoveId(null);
    setMessage(
      mutation.type === "decisionRequest.reopen"
        ? "Decision request reopened."
        : "Decision request removed.",
    );
    requestAnimationFrame(() =>
      statusRef.current?.focus({ preventScroll: true }),
    );
  };

  const renderRequest = (request: DecisionRequest) => (
    <li key={request.id} data-decision-request-id={request.id}>
      <div className={styles.requestTopline}>
        <b>{request.resolvedAt ? "Resolved" : "Decision needed"}</b>
        <time dateTime={request.updatedAt}>
          Updated {compactTimestamp(request.updatedAt)}
        </time>
      </div>
      <p>{request.prompt}</p>
      {request.resolution ? (
        <p className={styles.resolution}>
          <strong>Recorded resolution</strong>
          {request.resolution}
        </p>
      ) : null}
      <div className={styles.rowActions}>
        {request.resolvedAt ? (
          <button
            type="button"
            disabled={busy || !writable || editor !== null}
            onClick={() =>
              void applyLifecycle({
                type: "decisionRequest.reopen",
                id: request.id,
              })
            }
          >
            Reopen
          </button>
        ) : (
          <>
            <button
              type="button"
              disabled={busy || !writable || editor !== null}
              onClick={(event) =>
                openEditor(
                  {
                    kind: "edit",
                    id: request.id,
                    fingerprint: requestFingerprint(request),
                  },
                  event.currentTarget,
                )
              }
            >
              Edit
            </button>
            <button
              type="button"
              disabled={busy || !writable || editor !== null}
              onClick={(event) =>
                openEditor(
                  {
                    kind: "resolve",
                    id: request.id,
                    fingerprint: requestFingerprint(request),
                  },
                  event.currentTarget,
                )
              }
            >
              Resolve
            </button>
            {removeId === request.id ? (
              <>
                <button
                  ref={confirmRemoveRef}
                  type="button"
                  disabled={busy || !writable}
                  onClick={() =>
                    void applyLifecycle({
                      type: "decisionRequest.remove",
                      id: request.id,
                    })
                  }
                >
                  Confirm remove
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setRemoveId(null);
                    focusSoon(removeButtonRef);
                  }}
                >
                  Keep request
                </button>
              </>
            ) : (
              <button
                type="button"
                disabled={busy || !writable || editor !== null}
                onClick={(event) => {
                  removeButtonRef.current = event.currentTarget;
                  setRemoveId(request.id);
                  focusSoon(confirmRemoveRef);
                }}
              >
                Remove
              </button>
            )}
          </>
        )}
      </div>
    </li>
  );

  return (
    <section
      className={styles.card}
      aria-labelledby={headingId}
      data-decision-requests={
        scopeLabel === "Exact result" ? "result" : "work-item"
      }
      data-decision-request-target={targetIdentity}
    >
      <header>
        <div>
          <span>{scopeLabel}</span>
          <h4 id={headingId}>Decision requests</h4>
        </div>
        <b>{openRequests.length} open</b>
      </header>
      <p className={styles.explanation}>
        Keep a user-owned decision visible until you resolve it. These requests
        are local to Coffice and never answer, approve, or message Codex.
      </p>
      {openRequests.length ? (
        <ul className={styles.requests}>{openRequests.map(renderRequest)}</ul>
      ) : (
        <p className={styles.empty}>No open decision requests.</p>
      )}
      {resolvedRequests.length ? (
        <details className={styles.history}>
          <summary>Resolved history ({resolvedRequests.length})</summary>
          <ul className={styles.requests}>
            {resolvedRequests.map(renderRequest)}
          </ul>
        </details>
      ) : null}
      {!editor ? (
        <button
          ref={createButtonRef}
          type="button"
          disabled={!writable}
          onClick={(event) =>
            openEditor({ kind: "create" }, event.currentTarget)
          }
        >
          Add decision request
        </button>
      ) : (
        <form data-decision-request-editor={editor.kind} onSubmit={save}>
          {contextChanged || externalChanged ? (
            <div className={styles.conflict} role="alert">
              <strong>
                {contextChanged
                  ? "Decision scope changed"
                  : "Decision changed elsewhere"}
              </strong>
              <p>
                Your draft has not been overwritten. Close it and review the
                current scope before making another change.
              </p>
            </div>
          ) : null}
          {editor.kind === "resolve" ? (
            <>
              <p className={styles.promptPreview}>{selectedRequest?.prompt}</p>
              <label>
                Recorded resolution <span>optional</span>
                <textarea
                  ref={promptRef}
                  value={resolution}
                  maxLength={MAX_DECISION_REQUEST_TEXT_LENGTH}
                  rows={3}
                  onChange={(event) => setResolution(event.currentTarget.value)}
                />
              </label>
            </>
          ) : (
            <label>
              Decision needed
              <textarea
                ref={promptRef}
                value={prompt}
                maxLength={MAX_DECISION_REQUEST_TEXT_LENGTH}
                rows={3}
                onChange={(event) => setPrompt(event.currentTarget.value)}
              />
            </label>
          )}
          <div className={styles.formActions}>
            <button
              type="submit"
              disabled={busy || !writable || contextChanged || externalChanged}
            >
              {busy
                ? "Saving…"
                : editor.kind === "create"
                  ? "Add request"
                  : editor.kind === "edit"
                    ? "Save request"
                    : "Mark resolved"}
            </button>
            <button type="button" disabled={busy} onClick={closeEditor}>
              Cancel
            </button>
          </div>
        </form>
      )}
      {!writable ? (
        <p className={styles.locked}>
          {recoveryLocked
            ? "Review and acknowledge the recovered workspace before changing decisions."
            : "The local Coffice workspace is unavailable. Decisions cannot be changed."}
        </p>
      ) : null}
      {message ? (
        <p
          ref={statusRef}
          tabIndex={-1}
          role="status"
          className={styles.message}
        >
          {message}
        </p>
      ) : null}
    </section>
  );
}
