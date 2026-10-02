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
  MAX_PROJECT_DECISION_CONTEXT_LENGTH,
  MAX_PROJECT_DECISION_STATEMENT_LENGTH,
  selectActiveProjectDecisions,
  selectProjectDecisionEvents,
  selectProjectDecisionHistory,
  type ActiveProjectDecisionEvent,
  type ProjectDecisionEvent,
  type ProjectDecisionSupersessionKind,
  type WorkspaceMutation,
} from "../lib/coffice-workspace";
import type { CofficeWorkspaceController } from "./use-coffice-workspace";
import styles from "./project-decision-log.module.css";

type Editor =
  | {
      kind: "record";
      projectId: string;
      projectName: string;
    }
  | {
      kind: ProjectDecisionSupersessionKind | "withdraw";
      projectId: string;
      projectName: string;
      target: ActiveProjectDecisionEvent;
    };

interface DraftFields {
  statement: string;
  context: string;
  reason: string;
}

const EMPTY_FIELDS: DraftFields = {
  statement: "",
  context: "",
  reason: "",
};

const EMPTY_PROJECT_DECISION_EVENTS: readonly ProjectDecisionEvent[] = [];

function newEventId() {
  if (typeof crypto.randomUUID === "function") {
    return `project-decision-${crypto.randomUUID()}`;
  }
  return `project-decision-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2)}`;
}

function compactTimestamp(value: string) {
  return `${value.slice(0, 16).replace("T", " ")} UTC`;
}

function eventLabel(event: ProjectDecisionEvent) {
  if (event.action === "recorded") return "Decision recorded";
  if (event.action === "withdrawn") return "Withdrawn without replacement";
  return event.supersessionKind === "correction"
    ? "Corrected previous wording"
    : "Replaced previous decision";
}

function eventStatement(
  event: ProjectDecisionEvent,
  byId: ReadonlyMap<string, ProjectDecisionEvent>,
) {
  if (event.action !== "withdrawn") return event.statement;
  const previous = byId.get(event.supersedesId);
  return previous && previous.action !== "withdrawn"
    ? previous.statement
    : "Decision withdrawn";
}

function mutationMatchesEvent(
  mutation: WorkspaceMutation,
  event: ProjectDecisionEvent,
) {
  if (mutation.type === "projectDecision.record") {
    return (
      event.action === "recorded" &&
      event.id === mutation.id &&
      event.projectId === mutation.projectId &&
      event.statement === mutation.statement &&
      event.context === mutation.context &&
      event.authorship === "user"
    );
  }
  if (mutation.type === "projectDecision.supersede") {
    return (
      event.action === "superseded" &&
      event.id === mutation.id &&
      event.projectId === mutation.projectId &&
      event.supersedesId === mutation.supersedesId &&
      event.supersessionKind === mutation.supersessionKind &&
      event.statement === mutation.statement &&
      event.context === mutation.context &&
      event.authorship === "user"
    );
  }
  if (mutation.type === "projectDecision.withdraw") {
    return (
      event.action === "withdrawn" &&
      event.id === mutation.id &&
      event.projectId === mutation.projectId &&
      event.supersedesId === mutation.supersedesId &&
      event.reason === mutation.reason &&
      event.authorship === "user"
    );
  }
  return false;
}

function DecisionHistory({
  events,
  byId,
}: {
  events: readonly ProjectDecisionEvent[];
  byId: ReadonlyMap<string, ProjectDecisionEvent>;
}) {
  return (
    <ol className={styles.historyList}>
      {[...events].reverse().map((event) => (
        <li key={event.id} data-project-decision-history-event={event.action}>
          <div>
            <strong>{eventLabel(event)}</strong>
            <time dateTime={event.recordedAt}>
              {compactTimestamp(event.recordedAt)}
            </time>
          </div>
          <p>{eventStatement(event, byId)}</p>
          {event.action === "withdrawn" && event.reason ? (
            <small>Reason: {event.reason}</small>
          ) : event.action !== "withdrawn" && event.context ? (
            <small>{event.context}</small>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

export function ProjectDecisionLog({
  projectId,
  projectName,
  controller,
}: {
  projectId: string;
  projectName: string;
  controller: CofficeWorkspaceController;
}) {
  const headingId = useId();
  const statusRef = useRef<HTMLParagraphElement>(null);
  const statementRef = useRef<HTMLTextAreaElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const recordButtonRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const generationRef = useRef(0);
  const latestProjectIdRef = useRef(projectId);
  const events =
    controller.workspace?.projectDecisionEvents ??
    EMPTY_PROJECT_DECISION_EVENTS;
  const projectEvents = useMemo(
    () => selectProjectDecisionEvents(events, projectId),
    [events, projectId],
  );
  const activeDecisions = useMemo(
    () => selectActiveProjectDecisions(events, projectId),
    [events, projectId],
  );
  const withdrawnHeads = useMemo(
    () =>
      projectEvents.filter((event) => event.action === "withdrawn").reverse(),
    [projectEvents],
  );
  const byId = useMemo(
    () => new Map(events.map((event) => [event.id, event])),
    [events],
  );
  const [editor, setEditor] = useState<Editor | null>(null);
  const [fields, setFields] = useState<DraftFields>(EMPTY_FIELDS);
  const [openedFingerprint, setOpenedFingerprint] = useState("none");
  const [conflictLocked, setConflictLocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const recoveryLocked =
    controller.recovery?.kind === "backup" && !controller.recoveryAcknowledged;
  const writable = controller.persistent && !recoveryLocked;
  const sourceFingerprint = useMemo(
    () => JSON.stringify(projectEvents),
    [projectEvents],
  );
  const projectChanged = Boolean(editor && editor.projectId !== projectId);
  const externalChanged = Boolean(
    editor && !projectChanged && openedFingerprint !== sourceFingerprint,
  );
  const targetChanged = Boolean(
    editor &&
    editor.kind !== "record" &&
    !projectChanged &&
    !activeDecisions.some((event) => event.id === editor.target.id),
  );
  const currentBusy = Boolean(busy && !projectChanged);

  useLayoutEffect(() => {
    latestProjectIdRef.current = projectId;
    generationRef.current += 1;
  }, [projectId]);

  const focusSoon = (target: HTMLElement | null) => {
    requestAnimationFrame(() => {
      const fallback = recordButtonRef.current;
      const focusTarget =
        target?.isConnected &&
        (!(target instanceof HTMLButtonElement) || !target.disabled)
          ? target
          : fallback?.isConnected && !fallback.disabled
            ? fallback
            : null;
      focusTarget?.focus({ preventScroll: true });
    });
  };

  const focusStatus = () =>
    requestAnimationFrame(() =>
      statusRef.current?.focus({ preventScroll: true }),
    );

  const focusEditor = (ref: { current: HTMLTextAreaElement | null }) =>
    requestAnimationFrame(() => {
      const control = ref.current;
      if (!control) return;
      control.focus();
      control.scrollIntoView({ block: "nearest", inline: "nearest" });
    });

  const openRecord = (opener: HTMLButtonElement) => {
    generationRef.current += 1;
    openerRef.current = opener;
    setEditor({ kind: "record", projectId, projectName });
    setFields(EMPTY_FIELDS);
    setOpenedFingerprint(sourceFingerprint);
    setConflictLocked(false);
    setMessage(null);
    focusEditor(statementRef);
  };

  const openSupersession = (
    kind: ProjectDecisionSupersessionKind,
    target: ActiveProjectDecisionEvent,
    opener: HTMLButtonElement,
  ) => {
    generationRef.current += 1;
    openerRef.current = opener;
    setEditor({ kind, projectId, projectName, target });
    setFields(
      kind === "correction"
        ? {
            statement: target.statement,
            context: target.context ?? "",
            reason: "",
          }
        : EMPTY_FIELDS,
    );
    setOpenedFingerprint(sourceFingerprint);
    setConflictLocked(false);
    setMessage(null);
    focusEditor(statementRef);
  };

  const openWithdrawal = (
    target: ActiveProjectDecisionEvent,
    opener: HTMLButtonElement,
  ) => {
    generationRef.current += 1;
    openerRef.current = opener;
    setEditor({ kind: "withdraw", projectId, projectName, target });
    setFields(EMPTY_FIELDS);
    setOpenedFingerprint(sourceFingerprint);
    setConflictLocked(false);
    setMessage(null);
    focusEditor(reasonRef);
  };

  const closeEditor = () => {
    generationRef.current += 1;
    const opener = openerRef.current;
    setEditor(null);
    setFields(EMPTY_FIELDS);
    setConflictLocked(false);
    setBusy(false);
    setMessage(null);
    focusSoon(opener);
  };

  const discardChangedDraft = () => {
    generationRef.current += 1;
    setEditor(null);
    setFields(EMPTY_FIELDS);
    setConflictLocked(false);
    setBusy(false);
    setMessage(null);
    focusSoon(recordButtonRef.current);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (
      !editor ||
      editor.kind === "withdraw" ||
      projectChanged ||
      targetChanged ||
      externalChanged ||
      conflictLocked ||
      !writable
    )
      return;
    const statement = fields.statement.trim();
    const context = fields.context.trim();
    if (!statement) {
      setMessage("Record the decision before saving.");
      focusStatus();
      return;
    }
    const id = newEventId();
    const mutation: WorkspaceMutation =
      editor.kind === "record"
        ? {
            type: "projectDecision.record",
            id,
            projectId: editor.projectId,
            statement,
            ...(context ? { context } : {}),
          }
        : {
            type: "projectDecision.supersede",
            id,
            projectId: editor.projectId,
            supersedesId: editor.target.id,
            supersessionKind: editor.kind,
            statement,
            ...(context ? { context } : {}),
          };
    const generation = generationRef.current;
    const openedProjectId = editor.projectId;
    setBusy(true);
    setMessage(null);
    const result = await controller.mutate(mutation);
    if (
      generation !== generationRef.current ||
      openedProjectId !== latestProjectIdRef.current
    )
      return;
    setBusy(false);
    if (!result.ok) {
      if (result.reason === "conflict") setConflictLocked(true);
      setMessage(
        result.reason === "conflict"
          ? "The workspace changed elsewhere. Your draft is intact; review the current decisions before trying again."
          : "The decision was not saved. Your draft is intact for another attempt.",
      );
      focusStatus();
      return;
    }
    const confirmed = result.workspace.projectDecisionEvents.some((item) =>
      mutationMatchesEvent(mutation, item),
    );
    if (!confirmed) {
      setMessage(
        "The workspace did not confirm this decision. Your draft is intact for another attempt.",
      );
      focusStatus();
      return;
    }
    setEditor(null);
    setFields(EMPTY_FIELDS);
    setMessage(
      mutation.type === "projectDecision.record"
        ? "Decision recorded."
        : mutation.supersessionKind === "correction"
          ? "Decision wording corrected."
          : "Decision replaced.",
    );
    focusStatus();
  };

  const withdraw = async () => {
    if (
      !editor ||
      editor.kind !== "withdraw" ||
      projectChanged ||
      targetChanged ||
      externalChanged ||
      conflictLocked ||
      !writable
    )
      return;
    const reason = fields.reason.trim();
    const mutation: WorkspaceMutation = {
      type: "projectDecision.withdraw",
      id: newEventId(),
      projectId: editor.projectId,
      supersedesId: editor.target.id,
      ...(reason ? { reason } : {}),
    };
    const generation = generationRef.current;
    const openedProjectId = editor.projectId;
    setBusy(true);
    setMessage(null);
    const result = await controller.mutate(mutation);
    if (
      generation !== generationRef.current ||
      openedProjectId !== latestProjectIdRef.current
    )
      return;
    setBusy(false);
    if (!result.ok) {
      if (result.reason === "conflict") setConflictLocked(true);
      setMessage(
        result.reason === "conflict"
          ? "The workspace changed elsewhere. The decision was not withdrawn; review the current decisions before trying again."
          : "The decision was not withdrawn. Your reason is intact for another attempt.",
      );
      focusStatus();
      return;
    }
    const confirmed = result.workspace.projectDecisionEvents.some((item) =>
      mutationMatchesEvent(mutation, item),
    );
    if (!confirmed) {
      setMessage(
        "The workspace did not confirm the withdrawal. Your reason is intact for another attempt.",
      );
      focusStatus();
      return;
    }
    setEditor(null);
    setFields(EMPTY_FIELDS);
    setMessage("Decision withdrawn. Its history is still available.");
    focusStatus();
  };

  const editorTitle =
    editor?.kind === "record"
      ? "Record decision"
      : editor?.kind === "correction"
        ? "Correct wording"
        : editor?.kind === "replacement"
          ? "Replace decision"
          : "Withdraw without replacement";

  return (
    <section
      className={styles.section}
      aria-labelledby={headingId}
      data-project-decision-log={projectId}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !editor) return;
        event.preventDefault();
        event.stopPropagation();
        if (currentBusy) return;
        closeEditor();
      }}
    >
      <div className={styles.topline}>
        <div>
          <span>User-approved choices</span>
          <h3 id={headingId}>Project decision log</h3>
          <small className={styles.count}>
            {activeDecisions.length
              ? `${activeDecisions.length} current`
              : "No current decisions"}
          </small>
        </div>
        {!editor ? (
          <button
            ref={recordButtonRef}
            type="button"
            disabled={!writable}
            onClick={(event) => openRecord(event.currentTarget)}
          >
            Record decision
          </button>
        ) : null}
      </div>
      <p className={styles.helper}>
        Only decisions you approve and record appear here. They stay private in
        Coffice and do not change tasks, results, or what Codex does.
      </p>

      {editor ? (
        <form className={styles.form} onSubmit={save}>
          <div className={styles.formHeading}>
            <strong>{editorTitle}</strong>
            {editor.kind !== "record" ? <p>{editor.target.statement}</p> : null}
          </div>
          {projectChanged ||
          targetChanged ||
          externalChanged ||
          conflictLocked ? (
            <div className={styles.conflict} role="alert">
              <strong>
                {projectChanged
                  ? "Project changed"
                  : targetChanged
                    ? "Decision changed"
                    : "Decisions changed elsewhere"}
              </strong>
              <p>
                {projectChanged
                  ? `This draft belongs to ${editor.projectName}. Discard it before recording a decision for ${projectName}.`
                  : targetChanged
                    ? "Another saved event changed this decision. Your draft is intact, but it cannot be applied to an old decision head."
                    : "Your draft is intact. Load the latest project decisions and review them before trying again."}
              </p>
              <div className={styles.conflictActions}>
                {!projectChanged && (externalChanged || conflictLocked) ? (
                  <button
                    type="button"
                    onClick={() => {
                      setOpenedFingerprint(sourceFingerprint);
                      setConflictLocked(false);
                      setMessage(
                        targetChanged
                          ? "Latest decisions loaded. This draft still targets an earlier decision; discard it and choose a current decision."
                          : "Latest decisions loaded. Review your draft before saving.",
                      );
                      focusStatus();
                    }}
                  >
                    Load latest decisions
                  </button>
                ) : null}
                {projectChanged || targetChanged ? (
                  <button type="button" onClick={discardChangedDraft}>
                    Discard draft
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
          {editor.kind === "withdraw" ? (
            <>
              <p className={styles.withdrawalNotice}>
                This removes the decision from the current list without a
                replacement. Its history is kept until this project is removed.
              </p>
              <label>
                Reason <span>optional</span>
                <textarea
                  ref={reasonRef}
                  value={fields.reason}
                  maxLength={MAX_PROJECT_DECISION_CONTEXT_LENGTH}
                  rows={3}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    setFields((current) => ({ ...current, reason: value }));
                  }}
                />
              </label>
              <div className={styles.formActions}>
                <button
                  type="button"
                  disabled={
                    currentBusy ||
                    projectChanged ||
                    targetChanged ||
                    externalChanged ||
                    conflictLocked ||
                    !writable
                  }
                  onClick={() => void withdraw()}
                >
                  {currentBusy ? "Withdrawing…" : "Confirm withdrawal"}
                </button>
                <button
                  type="button"
                  disabled={currentBusy}
                  onClick={closeEditor}
                >
                  Keep decision
                </button>
              </div>
            </>
          ) : (
            <>
              {editor.kind === "correction" ? (
                <p className={styles.modeHint}>
                  Fix the wording without changing the choice. The earlier
                  wording stays in history.
                </p>
              ) : editor.kind === "replacement" ? (
                <p className={styles.modeHint}>
                  Record the new choice. The previous decision stays in history.
                </p>
              ) : null}
              <label>
                Decision
                <textarea
                  ref={statementRef}
                  value={fields.statement}
                  maxLength={MAX_PROJECT_DECISION_STATEMENT_LENGTH}
                  rows={3}
                  required
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    setFields((current) => ({ ...current, statement: value }));
                  }}
                />
              </label>
              <label>
                Context <span>optional</span>
                <textarea
                  value={fields.context}
                  maxLength={MAX_PROJECT_DECISION_CONTEXT_LENGTH}
                  rows={3}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    setFields((current) => ({ ...current, context: value }));
                  }}
                />
              </label>
              <div className={styles.formActions}>
                <button
                  type="submit"
                  disabled={
                    currentBusy ||
                    projectChanged ||
                    targetChanged ||
                    externalChanged ||
                    conflictLocked ||
                    !writable
                  }
                >
                  {currentBusy
                    ? "Saving…"
                    : editor.kind === "record"
                      ? "Save decision"
                      : editor.kind === "correction"
                        ? "Save correction"
                        : "Replace decision"}
                </button>
                <button
                  type="button"
                  disabled={currentBusy}
                  onClick={closeEditor}
                >
                  Cancel
                </button>
              </div>
            </>
          )}
        </form>
      ) : null}

      {!activeDecisions.length ? (
        <div className={styles.empty}>
          <strong>
            {projectEvents.length
              ? "No decision is currently in effect"
              : "Nothing recorded yet"}
          </strong>
          <p>
            {projectEvents.length
              ? "Withdrawn decisions remain available in history."
              : "Record only choices you have approved for this project."}
          </p>
        </div>
      ) : (
        <div
          className={styles.currentList}
          aria-label="Current project decisions"
        >
          {activeDecisions.map((decision, index) => {
            const history = selectProjectDecisionHistory(events, decision.id);
            return (
              <article
                key={decision.id}
                data-project-decision-id={decision.id}
                data-project-decision-current="true"
              >
                <div className={styles.decisionTopline}>
                  <span>Current decision {index + 1}</span>
                  <time dateTime={decision.recordedAt}>
                    {compactTimestamp(decision.recordedAt)}
                  </time>
                </div>
                <h4>{decision.statement}</h4>
                {decision.context ? <p>{decision.context}</p> : null}
                <div className={styles.decisionActions}>
                  <button
                    type="button"
                    disabled={!writable || Boolean(editor)}
                    aria-label={`Correct wording for current decision ${index + 1}: ${decision.statement}`}
                    onClick={(event) =>
                      openSupersession(
                        "correction",
                        decision,
                        event.currentTarget,
                      )
                    }
                  >
                    Correct wording
                  </button>
                  <button
                    type="button"
                    disabled={!writable || Boolean(editor)}
                    aria-label={`Replace current decision ${index + 1}: ${decision.statement}`}
                    onClick={(event) =>
                      openSupersession(
                        "replacement",
                        decision,
                        event.currentTarget,
                      )
                    }
                  >
                    Replace decision
                  </button>
                  <button
                    type="button"
                    disabled={!writable || Boolean(editor)}
                    aria-label={`Withdraw current decision ${index + 1}: ${decision.statement}`}
                    onClick={(event) =>
                      openWithdrawal(decision, event.currentTarget)
                    }
                  >
                    Withdraw
                  </button>
                </div>
                {history.length > 1 ? (
                  <details className={styles.history}>
                    <summary>History · {history.length} events</summary>
                    <DecisionHistory events={history} byId={byId} />
                  </details>
                ) : null}
              </article>
            );
          })}
        </div>
      )}

      {withdrawnHeads.length ? (
        <details className={styles.pastDecisions}>
          <summary>Past decisions · {withdrawnHeads.length} withdrawn</summary>
          <div className={styles.withdrawnList}>
            {withdrawnHeads.map((withdrawn) => {
              const history = selectProjectDecisionHistory(
                events,
                withdrawn.id,
              );
              const previous = byId.get(withdrawn.supersedesId);
              return (
                <article
                  key={withdrawn.id}
                  data-project-decision-id={withdrawn.id}
                  data-project-decision-current="false"
                >
                  <div className={styles.decisionTopline}>
                    <span>Withdrawn</span>
                    <time dateTime={withdrawn.recordedAt}>
                      {compactTimestamp(withdrawn.recordedAt)}
                    </time>
                  </div>
                  <h4>
                    {previous && previous.action !== "withdrawn"
                      ? previous.statement
                      : "Decision withdrawn"}
                  </h4>
                  {withdrawn.reason ? <p>Reason: {withdrawn.reason}</p> : null}
                  <details className={styles.history}>
                    <summary>History · {history.length} events</summary>
                    <DecisionHistory events={history} byId={byId} />
                  </details>
                </article>
              );
            })}
          </div>
        </details>
      ) : null}

      {!writable ? (
        <p className={styles.locked}>
          {recoveryLocked
            ? "Review and acknowledge the recovered workspace before changing project decisions."
            : "The local Coffice workspace is unavailable. Project decisions cannot be changed."}
        </p>
      ) : null}
      {message ? (
        <p
          ref={statusRef}
          className={styles.message}
          role="status"
          tabIndex={-1}
        >
          {message}
        </p>
      ) : null}
    </section>
  );
}
