"use client";

import { useEffect, useId, useReducer, type KeyboardEvent } from "react";

import type { AttentionItem } from "../lib/attention-inbox";
import styles from "./attention-transition-cue.module.css";

export type AttentionTransitionSourceState =
  "fresh" | "refreshing" | "stale" | "unavailable";

export interface AttentionTransitionCueProps {
  item: AttentionItem | null;
  moreCount: number;
  announcementRevision: number;
  sourceState: AttentionTransitionSourceState;
  modalOpen: boolean;
  onOpen: (eventKey: string) => void;
  onClose: () => void;
  onRequestFallbackFocus: () => void;
}

const KIND_LABELS: Readonly<Record<AttentionItem["kind"], string>> = {
  needs_input: "Needs your reply",
  decision_needed: "Decision needed",
  ready_for_review: "Result ready to review",
  task_failed: "Task failed",
  blocked: "Task blocked",
  verification_failed: "Quality check failed",
  plan_link_mismatch: "Plan link needs attention",
  plan_link_orphaned: "Plan link needs attention",
  project_review_due: "Project review due",
};

function actionLabel(item: AttentionItem): string {
  if (item.verificationTarget) return "Open stored result";
  if (item.planProjectId) return "Open project plan";
  if (item.kind === "ready_for_review") return "Review result";
  return "Open task";
}

function countLabel(count: number): string {
  return `${count} more new action${count === 1 ? "" : "s"}`;
}

interface AnnouncementState {
  revision: number;
  text: string;
  visible: boolean;
}

type AnnouncementAction =
  | { type: "announce"; revision: number; text: string }
  | { type: "suppress"; revision: number };

function announcementReducer(
  state: AnnouncementState,
  action: AnnouncementAction,
): AnnouncementState {
  if (action.type === "suppress") {
    return state.visible ? { ...state, visible: false } : state;
  }
  if (action.revision === state.revision) {
    return action.text !== state.text
      ? { revision: action.revision, text: action.text, visible: false }
      : state;
  }
  return { revision: action.revision, text: action.text, visible: true };
}

export function AttentionTransitionCue({
  item,
  moreCount,
  announcementRevision,
  sourceState,
  modalOpen,
  onOpen,
  onClose,
  onRequestFallbackFocus,
}: AttentionTransitionCueProps) {
  const headingId = useId();
  const [announcement, dispatchAnnouncement] = useReducer(announcementReducer, {
    revision: 0,
    text: "",
    visible: false,
  });
  const suppressed =
    !item ||
    modalOpen ||
    sourceState === "stale" ||
    sourceState === "unavailable";
  const remainingCount = Math.max(0, Math.floor(moreCount));
  const kindLabel = item ? KIND_LABELS[item.kind] : "";
  const taskTitle = item
    ? item.taskTitle.trim() || "Task title unavailable"
    : "";
  const projectLabel = item
    ? item.projectId === "__unassigned__"
      ? "Holding area"
      : item.projectName.trim() || "Project unavailable"
    : "";
  const announcementText = item
    ? `${kindLabel}. ${taskTitle}. ${projectLabel}.${
        remainingCount > 0 ? ` ${countLabel(remainingCount)}.` : ""
      }`
    : "";

  useEffect(() => {
    if (suppressed) {
      dispatchAnnouncement({
        type: "suppress",
        revision: announcementRevision,
      });
      return;
    }
    dispatchAnnouncement({
      type: "announce",
      revision: announcementRevision,
      text: announcementText,
    });
  }, [announcementRevision, announcementText, suppressed]);
  const exposedAnnouncement =
    !suppressed &&
    announcement.visible &&
    announcement.revision === announcementRevision &&
    announcement.text === announcementText
      ? announcement.text
      : "";
  const closeAndRestoreFocus = () => {
    onClose();
    window.requestAnimationFrame(onRequestFallbackFocus);
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    closeAndRestoreFocus();
  };

  return (
    <>
      <p
        className={styles.announcement}
        data-attention-transition-announcement="true"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {exposedAnnouncement}
      </p>
      {suppressed ? null : (
        <div className={styles.rail} data-attention-transition-cue="true">
          <section
            className={styles.cue}
            role="region"
            aria-labelledby={headingId}
            onKeyDown={handleKeyDown}
          >
            <div className={styles.copy}>
              <p className={styles.eyebrow}>New Attention</p>
              <h2 id={headingId}>{kindLabel}</h2>
              <p className={styles.identity}>
                <strong>{taskTitle}</strong>
                <span> · </span>
                <span>{projectLabel}</span>
              </p>
              {sourceState === "refreshing" ? (
                <p className={styles.refreshing}>
                  Refreshing · showing the last complete snapshot.
                </p>
              ) : null}
            </div>
            <div className={styles.actions}>
              {remainingCount > 0 ? (
                <span className={styles.more}>
                  {countLabel(remainingCount)}
                </span>
              ) : null}
              <button type="button" onClick={() => onOpen(item.eventKey)}>
                {actionLabel(item)}
              </button>
              <button
                type="button"
                className={styles.close}
                onClick={closeAndRestoreFocus}
                aria-label="Hide new Attention cues"
              >
                <span aria-hidden="true">×</span>
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
