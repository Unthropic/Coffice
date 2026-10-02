"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { DesktopAlertSettingsController } from "./use-desktop-alert-settings";
import styles from "./desktop-alert-settings.module.css";

const STATUS_LABELS: Record<DesktopAlertSettingsController["status"], string> =
  {
    off: "Off",
    on: "On",
    blocked: "Blocked",
    unavailable: "Unavailable",
    paused: "Paused",
  };

function projectDeliveryLabels(
  projects: readonly { id: string; name: string; holding?: boolean }[],
): ReadonlyMap<string, string> {
  const baseById = new Map<string, string>();
  const counts = new Map<string, number>();
  for (const project of projects) {
    const base =
      project.holding || project.id === "__unassigned__"
        ? "Unassigned sessions"
        : project.name.trim() || "Saved project";
    baseById.set(project.id, base);
    const key = base.toLocaleLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const positions = new Map<string, number>();
  const labels = new Map<string, string>();
  for (const project of projects) {
    const base = baseById.get(project.id)!;
    const key = base.toLocaleLowerCase();
    if (counts.get(key) === 1) {
      labels.set(project.id, base);
      continue;
    }
    if (project.holding || project.id === "__unassigned__") {
      labels.set(project.id, "Unassigned sessions");
      continue;
    }
    const position = (positions.get(key) ?? 0) + 1;
    positions.set(key, position);
    const includesHolding = projects.some(
      (candidate) =>
        (candidate.holding || candidate.id === "__unassigned__") &&
        baseById.get(candidate.id)?.toLocaleLowerCase() === key,
    );
    labels.set(
      project.id,
      includesHolding
        ? `${base} (project ${position})`
        : `${base} (${position})`,
    );
  }
  return labels;
}

export function DesktopAlertSettings({
  controller,
  projects,
}: {
  controller: DesktopAlertSettingsController;
  projects: readonly { id: string; name: string; holding?: boolean }[];
}) {
  const [projectAnnouncement, setProjectAnnouncement] = useState<string | null>(
    null,
  );
  const [resetConfirmationOpen, setResetConfirmationOpen] = useState(false);
  const resetButtonRef = useRef<HTMLButtonElement>(null);
  const resetCancelRef = useRef<HTMLButtonElement>(null);
  const projectFieldsetRef = useRef<HTMLFieldSetElement>(null);
  const firstProjectControlRef = useRef<HTMLInputElement>(null);
  const projectLabels = useMemo(
    () => projectDeliveryLabels(projects),
    [projects],
  );
  useEffect(() => {
    if (resetConfirmationOpen) resetCancelRef.current?.focus();
  }, [resetConfirmationOpen]);
  const canDisable = controller.enabled;
  const canEnable = controller.status === "off";
  const actionDisabled = controller.busy || (!canDisable && !canEnable);
  const actionLabel = controller.busy
    ? "Requesting permission…"
    : canDisable
      ? "Turn off desktop alerts"
      : canEnable
        ? "Enable desktop alerts"
        : controller.status === "blocked"
          ? "Desktop alerts blocked"
          : controller.status === "paused"
            ? "Desktop alerts paused"
            : "Desktop alerts unavailable";

  return (
    <details className={styles.settings} data-desktop-alert-settings>
      <summary>
        <span>Desktop alerts</span>
        <b data-desktop-alert-status={controller.status}>
          {STATUS_LABELS[controller.status]}
        </b>
      </summary>
      <div className={styles.content}>
        <p>
          When every open Coffice page is in the background, the browser can
          show a generic alert for a new action. Coffice must remain open.
        </p>
        <p>
          Alerts never include a project name, task name, request, result, or
          other work content. Your browser or operating system may retain the
          generic alert in notification history or on a lock screen.
        </p>

        {controller.status === "blocked" ? (
          <p className={styles.notice} role="status">
            Desktop alerts are blocked by the browser. Change this site&apos;s
            notification permission in the browser if you want to enable them.
          </p>
        ) : controller.status === "unavailable" ? (
          <p className={styles.notice} role="status">
            Desktop alerts are unavailable here. The in-app cue and Digest
            remain available.
          </p>
        ) : controller.status === "paused" ? (
          <p className={styles.notice} role="status">
            Desktop delivery is paused to prevent duplicate alerts. The in-app
            cue and Digest remain available.
          </p>
        ) : controller.enabled ? (
          <p className={styles.notice}>
            Turning Coffice alerts off does not revoke the browser&apos;s
            notification permission.
          </p>
        ) : (
          <p className={styles.notice}>
            Permission is requested only when you choose Enable desktop alerts.
          </p>
        )}

        <button
          type="button"
          className={styles.action}
          disabled={actionDisabled}
          aria-busy={controller.busy || undefined}
          onClick={() => {
            if (canDisable) controller.disable();
            else if (canEnable) void controller.enable();
          }}
        >
          {actionLabel}
        </button>

        {controller.projectMuteManageable ? (
          <fieldset
            ref={projectFieldsetRef}
            className={styles.projects}
            tabIndex={-1}
          >
            <legend>Project delivery</legend>
            <p>
              Muted projects still appear in Attention, counts, the Digest, the
              in-app cue, and their office. Muting only stops future desktop
              alerts. These choices apply if desktop alerts are enabled.
            </p>
            {projects.length > 0 ? (
              <div className={styles.projectList}>
                {projects.map((project, index) => {
                  const name = projectLabels.get(project.id)!;
                  const muted = controller.projectMutedById.get(project.id);
                  const busy = controller.projectMuteBusyId === project.id;
                  return (
                    <label className={styles.project} key={project.id}>
                      <span>{name}</span>
                      <input
                        ref={index === 0 ? firstProjectControlRef : undefined}
                        type="checkbox"
                        checked={muted === false}
                        disabled={
                          muted === undefined ||
                          controller.projectMuteBusyId !== null ||
                          controller.projectMuteResetBusy
                        }
                        aria-label={`Desktop alerts for ${name}`}
                        aria-busy={busy || undefined}
                        onChange={(event) => {
                          const deliveryEnabled = event.currentTarget.checked;
                          setProjectAnnouncement(null);
                          void controller
                            .setProjectMuted(project.id, !deliveryEnabled)
                            .then((saved) => {
                              if (!saved) return;
                              setProjectAnnouncement(
                                deliveryEnabled
                                  ? `Desktop alerts enabled for ${name}.`
                                  : `Desktop alerts muted for ${name}.`,
                              );
                            });
                        }}
                      />
                    </label>
                  );
                })}
              </div>
            ) : (
              <p>No current project delivery scopes are available.</p>
            )}
            <p className={styles.retentionNote}>
              Muting does not withdraw an alert your browser or operating system
              already displayed.
            </p>
            {controller.projectMuteResetAvailable ? (
              !resetConfirmationOpen ? (
                <button
                  ref={resetButtonRef}
                  type="button"
                  className={styles.reset}
                  disabled={
                    controller.projectMuteBusyId !== null ||
                    controller.projectMuteResetBusy
                  }
                  onClick={() => setResetConfirmationOpen(true)}
                >
                  Reset all muted delivery scopes
                </button>
              ) : (
                <div
                  className={styles.resetConfirmation}
                  role="group"
                  aria-label="Confirm reset of muted delivery scopes"
                  aria-describedby="desktop-alert-reset-description"
                  onKeyDown={(event) => {
                    if (event.key !== "Escape") return;
                    event.preventDefault();
                    event.stopPropagation();
                    setResetConfirmationOpen(false);
                    window.requestAnimationFrame(() =>
                      resetButtonRef.current?.focus(),
                    );
                  }}
                >
                  <p id="desktop-alert-reset-description">
                    This resumes future desktop alerts for every project,
                    including projects not currently shown. It does not create
                    or replay an alert now.
                  </p>
                  <div>
                    <button
                      ref={resetCancelRef}
                      type="button"
                      disabled={
                        controller.projectMuteResetBusy ||
                        controller.projectMuteBusyId !== null
                      }
                      onClick={() => {
                        setResetConfirmationOpen(false);
                        window.requestAnimationFrame(() =>
                          resetButtonRef.current?.focus(),
                        );
                      }}
                    >
                      Keep current mutes
                    </button>
                    <button
                      type="button"
                      disabled={
                        controller.projectMuteResetBusy ||
                        controller.projectMuteBusyId !== null
                      }
                      aria-busy={controller.projectMuteResetBusy || undefined}
                      onClick={() => {
                        setProjectAnnouncement(null);
                        void controller.resetProjectMutes().then((saved) => {
                          if (!saved) return;
                          setProjectAnnouncement(
                            "All muted desktop-delivery scopes were reset.",
                          );
                          setResetConfirmationOpen(false);
                          window.requestAnimationFrame(() => {
                            const focusTarget =
                              firstProjectControlRef.current ??
                              resetButtonRef.current ??
                              projectFieldsetRef.current;
                            focusTarget?.focus();
                          });
                        });
                      }}
                    >
                      {controller.projectMuteResetBusy
                        ? "Resetting…"
                        : "Resume all future alerts"}
                    </button>
                  </div>
                </div>
              )
            ) : null}
          </fieldset>
        ) : null}

        <p className={styles.srStatus} role="status" aria-live="polite">
          {projectAnnouncement ?? ""}
        </p>

        {controller.projectMuteMessage ? (
          <p className={styles.message} role="status">
            {controller.projectMuteMessage}
          </p>
        ) : null}

        {controller.message ? (
          <p className={styles.message} role="status">
            {controller.message}
          </p>
        ) : null}
      </div>
    </details>
  );
}
