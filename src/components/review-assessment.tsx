"use client";

import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";

import {
  MAX_REVIEW_ASSESSMENT_LIST_ENTRIES,
  MAX_REVIEW_ASSESSMENT_TEXT_LENGTH,
  MAX_REVIEW_ASSESSMENT_TOTAL_TEXT_LENGTH,
  reviewAssessmentTargetIdentity,
  selectReviewAssessment,
  type ReviewAssessment,
  type ReviewAssessmentDraft,
  type ReviewAssessmentTarget,
  type ReviewNextActionKind,
} from "../lib/coffice-workspace";
import type { CofficeWorkspaceController } from "./use-coffice-workspace";
import styles from "./review-assessment.module.css";

const NEXT_ACTIONS: readonly [ReviewNextActionKind, string][] = [
  ["open_in_codex", "Open in Codex"],
  ["send_follow_up", "Send a follow-up"],
  ["request_review", "Request review"],
  ["run_quality_check", "Run a quality check"],
  ["accept_result", "Accept result"],
  ["redirect_result", "Request another pass"],
  ["reject_result", "Reject result"],
];

interface DraftFields {
  reviewSummary: string;
  risks: string;
  uncertainties: string;
  blockedDecisions: string;
  nextActionKind: "" | ReviewNextActionKind;
  nextActionNote: string;
}

const EMPTY_DRAFT: DraftFields = {
  reviewSummary: "",
  risks: "",
  uncertainties: "",
  blockedDecisions: "",
  nextActionKind: "",
  nextActionNote: "",
};

function fieldsFor(assessment: ReviewAssessment | undefined): DraftFields {
  if (!assessment) return EMPTY_DRAFT;
  return {
    reviewSummary: assessment.reviewSummary ?? "",
    risks: assessment.risks.join("\n"),
    uncertainties: assessment.uncertainties.join("\n"),
    blockedDecisions: assessment.blockedDecisions.join("\n"),
    nextActionKind: assessment.nextAction?.kind ?? "",
    nextActionNote: assessment.nextAction?.note ?? "",
  };
}

function assessmentFingerprint(assessment: ReviewAssessment | undefined) {
  return assessment ? JSON.stringify(assessment) : "none";
}

function lines(value: string): string[] {
  return value
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function draftFor(
  target: ReviewAssessmentTarget,
  fields: DraftFields,
): { draft?: ReviewAssessmentDraft; error?: string } {
  const reviewSummary = fields.reviewSummary.trim();
  const risks = lines(fields.risks);
  const uncertainties = lines(fields.uncertainties);
  const blockedDecisions = lines(fields.blockedDecisions);
  const nextActionNote = fields.nextActionNote.trim();
  if (nextActionNote && !fields.nextActionKind) {
    return { error: "Choose an advisory next action for its note." };
  }
  const all = [
    ...(reviewSummary ? [reviewSummary] : []),
    ...risks,
    ...uncertainties,
    ...blockedDecisions,
    ...(nextActionNote ? [nextActionNote] : []),
  ];
  if (
    [risks, uncertainties, blockedDecisions].some(
      (entries) => entries.length > MAX_REVIEW_ASSESSMENT_LIST_ENTRIES,
    )
  ) {
    return {
      error: `Use no more than ${MAX_REVIEW_ASSESSMENT_LIST_ENTRIES} lines in each list.`,
    };
  }
  if (all.some((entry) => entry.length > MAX_REVIEW_ASSESSMENT_TEXT_LENGTH)) {
    return {
      error: `Keep every note or list line within ${MAX_REVIEW_ASSESSMENT_TEXT_LENGTH} characters.`,
    };
  }
  if (
    all.reduce((total, entry) => total + entry.length, 0) >
    MAX_REVIEW_ASSESSMENT_TOTAL_TEXT_LENGTH
  ) {
    return {
      error: `Keep the assessment within ${MAX_REVIEW_ASSESSMENT_TOTAL_TEXT_LENGTH} characters in total.`,
    };
  }
  if (!all.length && !fields.nextActionKind) {
    return { error: "Record at least one meaningful assessment field." };
  }
  return {
    draft: {
      target,
      ...(reviewSummary ? { reviewSummary } : {}),
      risks,
      uncertainties,
      blockedDecisions,
      ...(fields.nextActionKind
        ? {
            nextAction: {
              kind: fields.nextActionKind,
              ...(nextActionNote ? { note: nextActionNote } : {}),
            },
          }
        : {}),
    },
  };
}

export function unresolvedReviewAssessmentCount(
  assessment: ReviewAssessment | undefined,
): number {
  return assessment
    ? assessment.risks.length +
        assessment.uncertainties.length +
        assessment.blockedDecisions.length
    : 0;
}

function RecordedAssessment({ assessment }: { assessment: ReviewAssessment }) {
  const groups = [
    ["Risks", assessment.risks],
    ["Uncertainties", assessment.uncertainties],
    ["Decisions needed", assessment.blockedDecisions],
  ] as const;
  const actionLabel = NEXT_ACTIONS.find(
    ([kind]) => kind === assessment.nextAction?.kind,
  )?.[1];
  return (
    <div className={styles.recorded}>
      {assessment.reviewSummary ? (
        <div>
          <strong>Your assessment</strong>
          <p>{assessment.reviewSummary}</p>
        </div>
      ) : null}
      {groups.map(([label, entries]) =>
        entries.length ? (
          <div key={label}>
            <strong>{label}</strong>
            <ul>
              {entries.map((entry, index) => (
                <li key={`${index}:${entry}`}>{entry}</li>
              ))}
            </ul>
          </div>
        ) : null,
      )}
      {actionLabel ? (
        <div>
          <strong>Advisory next action</strong>
          <p>{actionLabel}</p>
          {assessment.nextAction?.note ? (
            <p className={styles.actionNote}>{assessment.nextAction.note}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function ReviewAssessmentCard({
  controller,
  target,
  scopeLabel,
  showAgentSelfCritique = false,
}: {
  controller: CofficeWorkspaceController;
  target: ReviewAssessmentTarget;
  scopeLabel: "Exact result" | "Work item";
  showAgentSelfCritique?: boolean;
}) {
  const headingId = useId();
  const statusRef = useRef<HTMLParagraphElement>(null);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const summaryRef = useRef<HTMLTextAreaElement>(null);
  const clearButtonRef = useRef<HTMLButtonElement>(null);
  const confirmClearRef = useRef<HTMLButtonElement>(null);
  const generationRef = useRef(0);
  const targetIdentity = reviewAssessmentTargetIdentity(target);
  const latestTargetIdentityRef = useRef(targetIdentity);
  const assessment = selectReviewAssessment(
    controller.workspace?.reviewAssessments ?? [],
    target,
  );
  const sourceFingerprint = assessmentFingerprint(assessment);
  const [editing, setEditing] = useState(false);
  const [openedTarget, setOpenedTarget] =
    useState<ReviewAssessmentTarget | null>(null);
  const [openedFingerprint, setOpenedFingerprint] = useState("none");
  const [fields, setFields] = useState<DraftFields>(EMPTY_DRAFT);
  const [busy, setBusy] = useState(false);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const openedIdentity = openedTarget
    ? reviewAssessmentTargetIdentity(openedTarget)
    : null;
  const contextChanged = editing && openedIdentity !== targetIdentity;
  const externalChanged =
    editing && !contextChanged && openedFingerprint !== sourceFingerprint;
  const recoveryLocked =
    controller.recovery?.kind === "backup" && !controller.recoveryAcknowledged;
  const writable = controller.persistent && !recoveryLocked;

  const focusSoon = (ref: { current: HTMLElement | null }) => {
    requestAnimationFrame(() => ref.current?.focus({ preventScroll: true }));
  };

  useLayoutEffect(() => {
    latestTargetIdentityRef.current = targetIdentity;
    generationRef.current += 1;
  }, [targetIdentity]);

  const openEditor = () => {
    generationRef.current += 1;
    setOpenedTarget(target);
    setOpenedFingerprint(sourceFingerprint);
    setFields(fieldsFor(assessment));
    setConfirmingClear(false);
    setMessage(null);
    setEditing(true);
    focusSoon(summaryRef);
  };

  const loadCurrent = () => {
    generationRef.current += 1;
    setOpenedTarget(target);
    setOpenedFingerprint(sourceFingerprint);
    setFields(fieldsFor(assessment));
    setConfirmingClear(false);
    setBusy(false);
    setMessage("Current scope loaded. Review your draft before saving.");
    focusSoon(summaryRef);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!openedTarget || contextChanged || externalChanged || !writable) return;
    const normalized = draftFor(openedTarget, fields);
    if (!normalized.draft) {
      setMessage(normalized.error ?? "This assessment is not valid.");
      return;
    }
    const generation = generationRef.current;
    const identity = openedIdentity;
    setBusy(true);
    setMessage(null);
    const result = await controller.mutate({
      type: "assessment.set",
      assessment: normalized.draft,
    });
    if (
      generation !== generationRef.current ||
      identity !== latestTargetIdentityRef.current
    )
      return;
    setBusy(false);
    if (!result.ok) {
      setMessage(
        result.reason === "conflict"
          ? "The workspace changed elsewhere. Load the latest assessment before saving again."
          : "Your draft was not saved. It remains here for another attempt.",
      );
      return;
    }
    setEditing(false);
    setMessage("Assessment saved.");
    requestAnimationFrame(() =>
      statusRef.current?.focus({ preventScroll: true }),
    );
  };

  const clear = async () => {
    if (!openedTarget || contextChanged || externalChanged || !writable) return;
    const generation = generationRef.current;
    const identity = openedIdentity;
    setBusy(true);
    const result = await controller.mutate({
      type: "assessment.clear",
      target: openedTarget,
    });
    if (
      generation !== generationRef.current ||
      identity !== latestTargetIdentityRef.current
    )
      return;
    setBusy(false);
    if (!result.ok) {
      setMessage(
        "The assessment was not cleared. Review the latest state and try again.",
      );
      return;
    }
    setEditing(false);
    setConfirmingClear(false);
    setMessage("Assessment cleared.");
    requestAnimationFrame(() =>
      statusRef.current?.focus({ preventScroll: true }),
    );
  };

  return (
    <section
      className={styles.card}
      aria-labelledby={headingId}
      data-review-assessment={
        scopeLabel === "Exact result" ? "result" : "work-item"
      }
      data-review-assessment-target={targetIdentity}
    >
      <header>
        <div>
          <span>{scopeLabel}</span>
          <h4 id={headingId}>Review notes &amp; next step</h4>
        </div>
        <b>{assessment ? "You recorded" : "Nothing recorded"}</b>
      </header>
      {assessment ? (
        <details className={styles.savedDetails}>
          <summary>Review saved notes</summary>
          <RecordedAssessment assessment={assessment} />
        </details>
      ) : null}
      {!editing ? (
        <button
          ref={editButtonRef}
          type="button"
          onClick={openEditor}
          disabled={!writable}
        >
          {assessment ? "Edit notes" : "Record notes"}
        </button>
      ) : (
        <form onSubmit={save}>
          {contextChanged || externalChanged ? (
            <div className={styles.conflict} role="alert">
              <strong>
                {contextChanged
                  ? "Review scope changed"
                  : "Assessment changed elsewhere"}
              </strong>
              <p>
                {contextChanged
                  ? "This draft remains attached to its original scope. Load the current scope deliberately before editing it."
                  : "Your draft has not been overwritten. Load the latest saved version before continuing."}
              </p>
              <button type="button" onClick={loadCurrent}>
                Load current scope
              </button>
            </div>
          ) : null}
          <label>
            Your assessment <span>optional</span>
            <textarea
              ref={summaryRef}
              value={fields.reviewSummary}
              maxLength={MAX_REVIEW_ASSESSMENT_TEXT_LENGTH}
              rows={3}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setFields((current) => ({ ...current, reviewSummary: value }));
              }}
            />
          </label>
          {(
            [
              ["Risks", "risks"],
              ["Uncertainties", "uncertainties"],
              ["Decisions needed", "blockedDecisions"],
            ] as const
          ).map(([label, field]) => (
            <label key={field}>
              {label} <span>one per line, optional</span>
              <textarea
                value={fields[field]}
                rows={2}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setFields((current) => ({ ...current, [field]: value }));
                }}
              />
            </label>
          ))}
          <label>
            Advisory next action <span>optional</span>
            <select
              value={fields.nextActionKind}
              onChange={(event) => {
                const value = event.currentTarget
                  .value as DraftFields["nextActionKind"];
                setFields((current) => ({ ...current, nextActionKind: value }));
              }}
            >
              <option value="">No advisory action</option>
              {NEXT_ACTIONS.map(([kind, label]) => (
                <option key={kind} value={kind}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Next-action note <span>optional</span>
            <textarea
              value={fields.nextActionNote}
              maxLength={MAX_REVIEW_ASSESSMENT_TEXT_LENGTH}
              rows={2}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setFields((current) => ({ ...current, nextActionNote: value }));
              }}
            />
          </label>
          <div className={styles.actions}>
            <button
              type="submit"
              disabled={busy || contextChanged || externalChanged || !writable}
            >
              {busy ? "Saving…" : "Save notes"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setEditing(false);
                focusSoon(editButtonRef);
              }}
            >
              Cancel
            </button>
            {assessment ? (
              confirmingClear ? (
                <>
                  <button
                    ref={confirmClearRef}
                    type="button"
                    disabled={busy || !writable}
                    onClick={() => void clear()}
                  >
                    Confirm clear
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setConfirmingClear(false);
                      focusSoon(clearButtonRef);
                    }}
                  >
                    Keep notes
                  </button>
                </>
              ) : (
                <button
                  ref={clearButtonRef}
                  type="button"
                  disabled={busy || !writable}
                  onClick={() => {
                    setConfirmingClear(true);
                    focusSoon(confirmClearRef);
                  }}
                >
                  Clear notes
                </button>
              )
            ) : null}
          </div>
        </form>
      )}
      {!writable ? (
        <p className={styles.locked}>
          {recoveryLocked
            ? "Review and acknowledge the recovered workspace before changing notes."
            : "The local Coffice workspace is unavailable. Notes cannot be changed."}
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
      {showAgentSelfCritique ? (
        <p className={styles.selfCritique}>
          Agent self-critique: not reported.
        </p>
      ) : null}
    </section>
  );
}
