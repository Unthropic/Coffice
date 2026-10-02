"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type {
  AttentionDigest,
  AttentionDigestEntry,
} from "../lib/attention-digest";
import type { AttentionItem } from "../lib/attention-inbox";
import styles from "./actionable-digest.module.css";
import { DesktopAlertSettings } from "./desktop-alert-settings";
import type { DesktopAlertSettingsController } from "./use-desktop-alert-settings";

export type DigestSourceState =
  "fresh" | "refreshing" | "stale" | "unavailable";

interface DesktopAlertProject {
  id: string;
  name: string;
  holding?: boolean;
}

const EMPTY_DESKTOP_ALERT_PROJECTS: readonly DesktopAlertProject[] = [];

export interface ActionableDigestProps {
  ready: boolean;
  digest: AttentionDigest;
  referenceTime: number;
  sourceState: DigestSourceState;
  persistent: boolean;
  onMarkSeen: (eventKey: string) => Promise<boolean>;
  onOpenTask: (projectId: string, taskId: string) => void;
  onOpenStoredResult: (
    target: NonNullable<AttentionItem["verificationTarget"]>,
  ) => void;
  onOpenProjectPlan?: (projectId: string) => void;
  desktopAlerts: DesktopAlertSettingsController;
  desktopAlertProjects?: readonly DesktopAlertProject[];
}

const SOURCE_MESSAGES: Record<DigestSourceState, string | null> = {
  fresh: null,
  refreshing: "Refreshing now. Showing the last complete local snapshot.",
  stale: "This digest may be out of date. Check the task before acting.",
  unavailable:
    "The local source is unavailable. Showing the last confirmed local items.",
};

const CATEGORY_LABELS: Record<AttentionDigestEntry["category"], string> = {
  needs_reply: "Needs reply",
  needs_decision: "Decision needed",
  unread_results: "Unread result",
  other_actions: "Action",
};

function countLabel(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

function repliesNeededLabel(count: number): string {
  return `${count} ${count === 1 ? "reply" : "replies"} needed`;
}

function decisionsNeededLabel(count: number): string {
  return `${count} ${count === 1 ? "decision" : "decisions"} needed`;
}

function ageLabel(item: AttentionItem, referenceTime: number): string {
  if (!item.occurredAt) {
    return item.kind === "plan_link_mismatch" ||
      item.kind === "plan_link_orphaned"
      ? "Assignment time not reported"
      : "Time not reported";
  }
  const timestamp = Date.parse(item.occurredAt);
  if (!Number.isFinite(timestamp)) return "Time not reported";
  const age = Math.max(0, referenceTime - timestamp);
  if (age < 60_000) return "Just now";
  if (age < 3_600_000) return `${Math.floor(age / 60_000)}m ago`;
  if (age < 86_400_000) return `${Math.floor(age / 3_600_000)}h ago`;
  return `${Math.floor(age / 86_400_000)}d ago`;
}

function groupCountSummary(counts: AttentionDigest["counts"]): string[] {
  const labels: string[] = [];
  if (counts.needsReply) labels.push(countLabel(counts.needsReply, "reply"));
  if (counts.needsDecision)
    labels.push(countLabel(counts.needsDecision, "decision"));
  if (counts.unreadResults)
    labels.push(countLabel(counts.unreadResults, "unread result"));
  if (counts.otherActions)
    labels.push(countLabel(counts.otherActions, "other action"));
  return labels;
}

export function ActionableDigest({ ready, ...props }: ActionableDigestProps) {
  if (!ready) {
    return (
      <button
        type="button"
        className={styles.trigger}
        aria-haspopup="dialog"
        aria-expanded="false"
        aria-busy="true"
        aria-label="Digest is loading"
        data-attention-count="—"
        data-needs-reply-count="—"
        data-needs-decision-count="—"
        data-unread-result-count="—"
        disabled
      >
        <span>Digest</span>
        <span className={styles.total} aria-hidden="true">
          …
        </span>
      </button>
    );
  }
  return <ReadyActionableDigest {...props} />;
}

function ReadyActionableDigest({
  digest,
  referenceTime,
  sourceState,
  persistent,
  onMarkSeen,
  onOpenTask,
  onOpenStoredResult,
  onOpenProjectPlan,
  desktopAlerts,
  desktopAlertProjects = EMPTY_DESKTOP_ALERT_PROJECTS,
}: Omit<ActionableDigestProps, "ready">) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const { total, needsReply, needsDecision, unreadResults, otherActions } =
    digest.counts;
  const unread = unreadResults;

  const close = useCallback(() => {
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);
  useEffect(() => {
    const panel = panelRef.current;
    if (!open || !panel) return;
    const appShell = document.querySelector<HTMLElement>(".app-shell");
    const wasInert = appShell?.inert ?? false;
    const previousAriaHidden = appShell?.getAttribute("aria-hidden") ?? null;
    if (appShell) {
      appShell.inert = true;
      appShell.setAttribute("aria-hidden", "true");
    }
    const controls = () =>
      Array.from(
        panel.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), a[href], summary, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((control) => {
        const closedDetails = control.closest("details:not([open])");
        return (
          (!closedDetails ||
            control === closedDetails.querySelector("summary")) &&
          control.getClientRects().length > 0
        );
      });
    const initial =
      panel.querySelector<HTMLElement>("[data-dialog-initial-focus]") ??
      controls()[0];
    initial?.focus({ preventScroll: true });
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab") return;
      const available = controls();
      if (!available.length) return;
      const first = available[0];
      const last = available.at(-1)!;
      if (!panel.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
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
      if (!appShell) return;
      appShell.inert = wasInert;
      if (previousAriaHidden === null) appShell.removeAttribute("aria-hidden");
      else appShell.setAttribute("aria-hidden", previousAriaHidden);
    };
  }, [close, open]);

  const activate = useCallback(
    (entry: AttentionDigestEntry) => {
      void onMarkSeen(entry.item.eventKey);
      close();
      if (entry.item.verificationTarget) {
        onOpenStoredResult(entry.item.verificationTarget);
      } else if (entry.item.planProjectId) {
        onOpenProjectPlan?.(entry.item.planProjectId);
      } else if (entry.item.openTaskId) {
        onOpenTask(entry.item.projectId, entry.item.openTaskId);
      }
    },
    [close, onMarkSeen, onOpenProjectPlan, onOpenStoredResult, onOpenTask],
  );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Open digest, ${countLabel(total, "action")}, ${repliesNeededLabel(needsReply)}, ${decisionsNeededLabel(needsDecision)}, ${countLabel(unread, "unread result")}`}
        data-attention-count={total}
        data-needs-reply-count={needsReply}
        data-needs-decision-count={needsDecision}
        data-unread-result-count={unread}
        onClick={() => setOpen(true)}
      >
        <span>Digest</span>
        <span className={styles.total} aria-hidden="true">
          <b>{total}</b> {total === 1 ? "action" : "actions"}
        </span>
        {needsReply > 0 ? (
          <span className={styles.reply} aria-hidden="true">
            <b>{needsReply}</b>{" "}
            {needsReply === 1 ? "reply needed" : "replies needed"}
          </span>
        ) : null}
        {needsDecision > 0 ? (
          <span className={styles.decision} aria-hidden="true">
            <b>{needsDecision}</b> decision
            {needsDecision === 1 ? "" : "s"} needed
          </span>
        ) : null}
        {unread > 0 ? (
          <span className={styles.unread} aria-hidden="true">
            <b>{unread}</b> unread
          </span>
        ) : null}
      </button>

      {open && typeof document !== "undefined"
        ? createPortal(
            <>
              <button
                type="button"
                className={styles.backdrop}
                tabIndex={-1}
                aria-hidden="true"
                data-digest-backdrop
                onClick={close}
              />
              <section
                ref={panelRef}
                className={styles.panel}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
              >
                <header className={styles.header}>
                  <div>
                    <p className={styles.eyebrow}>Campus actions</p>
                    <h2 id={titleId}>Digest</h2>
                  </div>
                  <button
                    type="button"
                    className={styles.close}
                    {...(total === 0
                      ? { "data-dialog-initial-focus": true }
                      : {})}
                    onClick={close}
                    aria-label="Close digest"
                  >
                    ×
                  </button>
                </header>

                <div className={styles.counts} aria-label="Digest summary">
                  <span>
                    <b>{needsReply}</b>{" "}
                    {needsReply === 1 ? "reply needed" : "replies needed"}
                  </span>
                  <span>
                    <b>{needsDecision}</b>{" "}
                    {needsDecision === 1
                      ? "decision needed"
                      : "decisions needed"}
                  </span>
                  <span>
                    <b>{unreadResults}</b>{" "}
                    {unreadResults === 1 ? "unread result" : "unread results"}
                  </span>
                  <span>
                    <b>{otherActions}</b>{" "}
                    {otherActions === 1 ? "other action" : "other actions"}
                  </span>
                </div>

                {SOURCE_MESSAGES[sourceState] ? (
                  <p className={styles.sourceNotice} role="status">
                    {SOURCE_MESSAGES[sourceState]}
                  </p>
                ) : null}
                {!persistent ? (
                  <p className={styles.persistenceNotice} role="status">
                    Seen status cannot be saved while the local Coffice
                    workspace is unavailable.
                  </p>
                ) : null}

                <div className={styles.body}>
                  <DesktopAlertSettings
                    controller={desktopAlerts}
                    projects={desktopAlertProjects}
                  />
                  {total === 0 ? (
                    <div className={styles.empty}>
                      <span aria-hidden="true">✓</span>
                      <h3>All caught up</h3>
                      <p>There are no current Attention items.</p>
                    </div>
                  ) : (
                    digest.groups.map((group) => (
                      <section className={styles.group} key={group.key}>
                        <h3>
                          {group.projectName} <span>{group.counts.total}</span>
                        </h3>
                        <p className={styles.groupCounts}>
                          {groupCountSummary(group.counts).join(" · ")}
                        </p>
                        <ul>
                          {group.items.map((entry, index) => (
                            <li key={entry.item.eventKey}>
                              <button
                                type="button"
                                className={styles.item}
                                data-unread={
                                  entry.category === "unread_results"
                                }
                                {...(index === 0 && group === digest.groups[0]
                                  ? { "data-dialog-initial-focus": true }
                                  : {})}
                                onClick={() => activate(entry)}
                              >
                                <span className={styles.itemTopline}>
                                  <b>{entry.item.taskTitle}</b>
                                  {entry.category === "unread_results" ? (
                                    <i>Unread</i>
                                  ) : null}
                                </span>
                                <span className={styles.orientation}>
                                  <i>{CATEGORY_LABELS[entry.category]}</i>
                                  <span>
                                    {ageLabel(entry.item, referenceTime)}
                                  </span>
                                </span>
                                <span className={styles.reason}>
                                  {entry.item.reason}
                                </span>
                                <span className={styles.action}>
                                  {entry.item.recommendedAction} →
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      </section>
                    ))
                  )}
                </div>
              </section>
            </>,
            document.body,
          )
        : null}
    </>
  );
}
