// @vitest-environment happy-dom

import { StrictMode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AttentionTransitionController } from "../src/components/attention-transition-controller";
import {
  clearDesktopAlertRuntimePause,
  getDesktopAlertRuntimePause,
} from "../src/lib/desktop-alerts";
import type {
  AttentionDisposition,
  AttentionItem,
} from "../src/lib/attention-inbox";
import type { VerificationTarget } from "../src/lib/coffice-workspace";
import type { DesktopAlertSettingsController } from "../src/components/use-desktop-alert-settings";

const desktopAlerts: DesktopAlertSettingsController = {
  status: "off",
  busy: false,
  message: null,
  enabled: false,
  optedIn: false,
  coordinationAvailable: false,
  projectMutedById: new Map(),
  projectMuteBusyId: null,
  projectMuteMessage: null,
  projectMuteResetBusy: false,
  projectMuteResetAvailable: false,
  projectMuteManageable: false,
  setProjectMuted: async () => true,
  resetProjectMutes: async () => true,
  enable: async () => undefined,
  disable: () => undefined,
};

function item(
  eventKey: string,
  overrides: Partial<AttentionItem> = {},
): AttentionItem {
  return {
    eventKey,
    kind: "needs_input",
    priority: 0,
    projectId: "project-a",
    projectName: "Project A",
    taskId: `task-${eventKey}`,
    openTaskId: `task-${eventKey}`,
    taskTitle: `Task ${eventKey}`,
    occurredAt: "2026-08-12T08:00:00.000Z",
    status: "waiting_for_user",
    evidence: "observed",
    stale: false,
    reason: "Codex is waiting for your response.",
    recommendedAction: "Open the task and respond",
    ...overrides,
  };
}

describe("AttentionTransitionController", () => {
  let container: HTMLDivElement;
  let root: Root;
  let dispositions: Record<string, AttentionDisposition>;
  const markSeen = vi.fn<(eventKey: string) => Promise<boolean>>();
  const openTask = vi.fn<(projectId: string, taskId: string) => void>();
  const openStoredResult = vi.fn<(target: VerificationTarget) => void>();
  const requestFallbackFocus = vi.fn<() => void>();

  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    dispositions = {};
    markSeen.mockReset().mockResolvedValue(true);
    openTask.mockReset();
    openStoredResult.mockReset();
    requestFallbackFocus.mockReset();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    clearDesktopAlertRuntimePause();
    document
      .querySelectorAll('[aria-modal="true"]')
      .forEach((node) => node.remove());
    container.remove();
    vi.restoreAllMocks();
  });

  async function render(
    items: readonly AttentionItem[],
    options: {
      admissionReady?: boolean;
      sourceState?: "fresh" | "refreshing" | "stale" | "unavailable";
      desktopAlerts?: DesktopAlertSettingsController;
    } = {},
  ) {
    await act(async () => {
      root.render(
        <StrictMode>
          <AttentionTransitionController
            admissionReady={options.admissionReady ?? true}
            items={items}
            dispositionFor={(eventKey) => dispositions[eventKey]}
            sourceState={options.sourceState ?? "fresh"}
            desktopAlerts={options.desktopAlerts ?? desktopAlerts}
            onMarkSeen={markSeen}
            onOpenTask={openTask}
            onOpenStoredResult={openStoredResult}
            onRequestFallbackFocus={requestFallbackFocus}
          />
        </StrictMode>,
      );
    });
  }

  function cue(): HTMLElement | null {
    return container.querySelector("[data-attention-transition-cue]");
  }

  function button(label: string): HTMLButtonElement {
    const match = [...container.querySelectorAll("button")].find(
      (candidate) => candidate.textContent?.trim() === label,
    );
    if (!(match instanceof HTMLButtonElement)) {
      throw new Error(`Button not found: ${label}`);
    }
    return match;
  }

  it("silently baselines in Strict Mode and cues only a later event", async () => {
    await render([item("existing")]);
    expect(cue()).toBeNull();

    await render([item("new"), item("existing")]);
    expect(cue()?.textContent).toContain("Task new");
    expect(markSeen).not.toHaveBeenCalled();
    expect(openTask).not.toHaveBeenCalled();
  });

  it("dismisses the whole session batch without changing Attention", async () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    await render([]);
    await render([item("first"), item("second")]);
    expect(cue()?.textContent).toContain("1 more new action");

    await act(async () => button("×").click());
    expect(cue()).toBeNull();
    expect(requestFallbackFocus).toHaveBeenCalledOnce();
    expect(markSeen).not.toHaveBeenCalled();
    expect(openTask).not.toHaveBeenCalled();
    expect(openStoredResult).not.toHaveBeenCalled();
  });

  it("marks seen and opens the exact live or holding task only from Open", async () => {
    markSeen.mockResolvedValue(false);
    await render([]);
    await render([
      item("holding", {
        projectId: "__unassigned__",
        projectName: "Unassigned Sessions",
        openTaskId: "task-holding-exact",
      }),
    ]);

    await act(async () => button("Open task").click());
    expect(markSeen).toHaveBeenCalledExactlyOnceWith("holding");
    expect(openTask).toHaveBeenCalledExactlyOnceWith(
      "__unassigned__",
      "task-holding-exact",
    );
    expect(openStoredResult).not.toHaveBeenCalled();
  });

  it("gives an exact stored-result target precedence over a live task route", async () => {
    const target: VerificationTarget = {
      projectId: "project-history",
      objectiveId: "objective-exact",
      workItemId: "work-exact",
      attemptId: "attempt-exact",
      resultKey: { kind: "revision", id: "revision-exact" },
    };
    await render([]);
    await render([
      item("stored", {
        kind: "verification_failed",
        projectId: "project-history",
        openTaskId: "task-current",
        verificationTarget: target,
      }),
    ]);

    await act(async () => button("Open stored result").click());
    expect(markSeen).toHaveBeenCalledExactlyOnceWith("stored");
    expect(openStoredResult).toHaveBeenCalledExactlyOnceWith(target);
    expect(openTask).not.toHaveBeenCalled();
  });

  it("revalidates the latest item at click time and fails quiet if it vanished", async () => {
    const mutableItems = [item("vanishes")];
    await render([]);
    await render(mutableItems);
    const open = button("Open task");
    mutableItems.splice(0);

    await act(async () => open.click());
    expect(cue()).toBeNull();
    expect(markSeen).not.toHaveBeenCalled();
    expect(openTask).not.toHaveBeenCalled();
  });

  it("suppresses an admitted cue while a modal exists and resumes afterward", async () => {
    await render([]);
    await render([item("modal-safe")]);
    expect(cue()).not.toBeNull();
    const announcement = container.querySelector(
      "[data-attention-transition-announcement]",
    );
    expect(announcement?.textContent).toContain("Task modal-safe");

    const modal = document.createElement("section");
    modal.setAttribute("aria-modal", "true");
    await act(async () => {
      document.body.append(modal);
      await Promise.resolve();
    });
    expect(cue()).toBeNull();
    expect(announcement?.textContent).toBe("");

    await act(async () => {
      modal.remove();
      await Promise.resolve();
    });
    expect(cue()?.textContent).toContain("Task modal-safe");
    expect(announcement?.textContent).toBe("");

    await render([item("modal-safe"), item("later")]);
    expect(announcement?.textContent).toContain("1 more new action");
  });

  it("does not route or mark a malformed item without an exact target", async () => {
    await render([]);
    await render([
      item("missing-route", {
        openTaskId: undefined,
      }),
    ]);

    await act(async () => button("Open task").click());
    expect(cue()).toBeNull();
    expect(markSeen).not.toHaveBeenCalled();
    expect(openTask).not.toHaveBeenCalled();
    expect(openStoredResult).not.toHaveBeenCalled();
  });

  it("never substitutes a live task route for a malformed stored-result target", async () => {
    await render([]);
    await render([
      item("malformed-result", {
        openTaskId: "task-must-not-open",
        verificationTarget: {
          projectId: "project-a",
          objectiveId: "objective-a",
          workItemId: "work-a",
          attemptId: "attempt-a",
          resultKey: { kind: "revision", id: "   " },
        },
      }),
    ]);

    await act(async () => button("Open stored result").click());
    expect(cue()).toBeNull();
    expect(markSeen).not.toHaveBeenCalled();
    expect(openTask).not.toHaveBeenCalled();
    expect(openStoredResult).not.toHaveBeenCalled();
  });

  it("rejects a stored-result target that crosses the item's exact project", async () => {
    await render([]);
    await render([
      item("cross-project-result", {
        projectId: "project-a",
        openTaskId: "task-must-not-open",
        verificationTarget: {
          projectId: "project-b",
          objectiveId: "objective-b",
          workItemId: "work-b",
          attemptId: "attempt-b",
          resultKey: { kind: "turn", id: "turn-b" },
        },
      }),
    ]);

    await act(async () => button("Open stored result").click());
    expect(markSeen).not.toHaveBeenCalled();
    expect(openTask).not.toHaveBeenCalled();
    expect(openStoredResult).not.toHaveBeenCalled();
  });

  it("pauses an enabled desktop channel when transition memory saturates", async () => {
    const enabledDesktopAlerts: DesktopAlertSettingsController = {
      ...desktopAlerts,
      status: "on",
      enabled: true,
    };
    const baseline = Array.from({ length: 4_095 }, (_, index) =>
      item(`baseline-${index}`),
    );
    await render(baseline, { desktopAlerts: enabledDesktopAlerts });
    await render([...baseline, item("overflow-a"), item("overflow-b")], {
      desktopAlerts: enabledDesktopAlerts,
    });

    expect(getDesktopAlertRuntimePause()).toContain(
      "duplicate-prevention safety limit",
    );
  });
});
