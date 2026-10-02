// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ActionableDigest } from "../src/components/actionable-digest";
import type { DesktopAlertSettingsController } from "../src/components/use-desktop-alert-settings";
import type { AttentionDigest } from "../src/lib/attention-digest";
import { createAttentionItem } from "../src/lib/attention-inbox";

const project = {
  id: "project-a",
  name: "Project A",
  tasks: [],
};

const task = {
  id: "task-a",
  title: "Approve the release note",
  status: {
    value: "waiting_for_user" as const,
    evidence: "observed" as const,
    timestamp: "2026-08-12T10:00:00.000Z",
  },
};

const item = createAttentionItem(project, task)!;
const digest: AttentionDigest = {
  counts: {
    needsReply: 1,
    needsDecision: 0,
    unreadResults: 0,
    otherActions: 0,
    total: 1,
  },
  groups: [
    {
      key: "project:project-a",
      projectId: "project-a",
      projectName: "Project A",
      counts: {
        needsReply: 1,
        needsDecision: 0,
        unreadResults: 0,
        otherActions: 0,
        total: 1,
      },
      items: [{ item, category: "needs_reply" }],
    },
  ],
};

function desktopAlerts(
  overrides: Partial<DesktopAlertSettingsController> = {},
): DesktopAlertSettingsController {
  return {
    status: "off",
    busy: false,
    message: null,
    enabled: false,
    optedIn: false,
    coordinationAvailable: true,
    projectMutedById: new Map(),
    projectMuteBusyId: null,
    projectMuteMessage: null,
    projectMuteResetBusy: false,
    projectMuteResetAvailable: false,
    projectMuteManageable: true,
    setProjectMuted: vi.fn().mockResolvedValue(true),
    resetProjectMutes: vi.fn().mockResolvedValue(true),
    enable: vi.fn().mockResolvedValue(undefined),
    disable: vi.fn(),
    ...overrides,
  };
}

function buttonNamed(name: string): HTMLButtonElement {
  const button = [
    ...document.querySelectorAll<HTMLButtonElement>("button"),
  ].find(
    (candidate) =>
      (candidate.getAttribute("aria-label") ?? candidate.textContent)
        ?.replace(/\s+/gu, " ")
        .trim() === name,
  );
  if (!button) throw new Error(`Missing button named "${name}".`);
  return button;
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.click();
    await Promise.resolve();
  });
}

describe("ActionableDigest", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    host.className = "app-shell";
    document.body.append(host);
    root = createRoot(host);
    const visibleRect = [{} as DOMRect] as unknown as DOMRectList;
    vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue(
      visibleRect,
    );
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("waits for authoritative Attention state before claiming counts", async () => {
    await act(async () => {
      root.render(
        <ActionableDigest
          ready={false}
          digest={{
            groups: [],
            counts: {
              needsReply: 0,
              needsDecision: 0,
              unreadResults: 0,
              otherActions: 0,
              total: 0,
            },
          }}
          referenceTime={Date.parse("2026-08-12T10:05:00.000Z")}
          sourceState="fresh"
          persistent
          desktopAlerts={desktopAlerts()}
          onMarkSeen={vi.fn().mockResolvedValue(true)}
          onOpenTask={vi.fn()}
          onOpenStoredResult={vi.fn()}
        />,
      );
    });

    const trigger = buttonNamed("Digest is loading");
    expect(trigger.disabled).toBe(true);
    expect(trigger.getAttribute("aria-busy")).toBe("true");
    expect(trigger.dataset.attentionCount).toBe("—");
    expect(trigger.dataset.needsReplyCount).toBe("—");
    expect(trigger.dataset.unreadResultCount).toBe("—");
    expect(trigger.textContent).toContain("…");
    expect(trigger.textContent).not.toContain("0");
    await click(trigger);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("distinguishes total actions, replies needed, and unread results on the trigger", async () => {
    await act(async () => {
      root.render(
        <ActionableDigest
          ready
          digest={{
            ...digest,
            counts: {
              needsReply: 1,
              needsDecision: 0,
              unreadResults: 2,
              otherActions: 1,
              total: 4,
            },
          }}
          referenceTime={Date.parse("2026-08-12T10:05:00.000Z")}
          sourceState="fresh"
          persistent
          desktopAlerts={desktopAlerts()}
          onMarkSeen={vi.fn().mockResolvedValue(true)}
          onOpenTask={vi.fn()}
          onOpenStoredResult={vi.fn()}
        />,
      );
    });

    const trigger = buttonNamed(
      "Open digest, 4 actions, 1 reply needed, 0 decisions needed, 2 unread results",
    );
    expect(trigger.dataset.attentionCount).toBe("4");
    expect(trigger.dataset.needsReplyCount).toBe("1");
    expect(trigger.dataset.unreadResultCount).toBe("2");
    expect(trigger.textContent).toContain("4 actions");
    expect(trigger.textContent).toContain("1 reply needed");
    expect(trigger.textContent).toContain("2 unread");
  });

  it("summarizes groups, source health, and temporary seen storage", async () => {
    await act(async () => {
      root.render(
        <ActionableDigest
          ready
          digest={digest}
          referenceTime={Date.parse("2026-08-12T10:05:00.000Z")}
          sourceState="refreshing"
          persistent={false}
          desktopAlerts={desktopAlerts()}
          onMarkSeen={vi.fn().mockResolvedValue(false)}
          onOpenTask={vi.fn()}
          onOpenStoredResult={vi.fn()}
        />,
      );
    });

    const trigger = buttonNamed(
      "Open digest, 1 action, 1 reply needed, 0 decisions needed, 0 unread results",
    );
    expect(trigger.dataset.attentionCount).toBe("1");
    expect(trigger.dataset.needsReplyCount).toBe("1");
    expect(trigger.dataset.unreadResultCount).toBe("0");
    expect(trigger.textContent).toContain("1 action");
    expect(trigger.textContent).toContain("1 reply needed");
    expect(trigger.textContent).not.toContain("unread");
    await click(trigger);

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain("1 reply needed");
    expect(dialog?.textContent).toContain("Project A");
    expect(dialog?.textContent).toContain("1 reply");
    expect(dialog?.textContent).toContain("Needs reply");
    expect(dialog?.textContent).toContain("5m ago");
    expect(dialog?.textContent).toContain("last complete local snapshot");
    expect(dialog?.textContent).toContain("Seen status cannot be saved");
    expect(host.inert).toBe(true);
    const backdrop = document.querySelector<HTMLButtonElement>(
      "[data-digest-backdrop]",
    )!;
    expect(backdrop.tabIndex).toBe(-1);
    expect(backdrop.getAttribute("aria-hidden")).toBe("true");

    await act(async () => {
      root.render(
        <ActionableDigest
          ready
          digest={digest}
          referenceTime={Date.parse("2026-08-12T10:05:00.000Z")}
          sourceState="stale"
          persistent={false}
          desktopAlerts={desktopAlerts()}
          onMarkSeen={vi.fn().mockResolvedValue(false)}
          onOpenTask={vi.fn()}
          onOpenStoredResult={vi.fn()}
        />,
      );
    });
    expect(dialog?.textContent).toContain("digest may be out of date");
  });

  it("marks an item seen, routes to its exact task, and restores focus", async () => {
    const markSeen = vi.fn().mockResolvedValue(true);
    const openTask = vi.fn();
    await act(async () => {
      root.render(
        <ActionableDigest
          ready
          digest={digest}
          referenceTime={Date.parse("2026-08-12T10:05:00.000Z")}
          sourceState="fresh"
          persistent
          desktopAlerts={desktopAlerts()}
          onMarkSeen={markSeen}
          onOpenTask={openTask}
          onOpenStoredResult={vi.fn()}
        />,
      );
    });
    const trigger = buttonNamed(
      "Open digest, 1 action, 1 reply needed, 0 decisions needed, 0 unread results",
    );
    await click(trigger);
    const row = document.querySelector<HTMLButtonElement>("[data-unread]")!;
    const close = document.querySelector<HTMLButtonElement>(
      '[role="dialog"] button[aria-label="Close digest"]',
    )!;
    expect(document.activeElement).toBe(row);
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }));
    });
    expect(document.activeElement).toBe(close);
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Tab", shiftKey: true }),
      );
    });
    expect(document.activeElement).toBe(row);
    await click(row);
    await act(async () => {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
    });

    expect(markSeen).toHaveBeenCalledWith(item.eventKey);
    expect(openTask).toHaveBeenCalledWith("project-a", "task-a");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(host.inert).toBe(false);
  });

  it("traps keyboard focus, closes on Escape, and renders the empty state", async () => {
    await act(async () => {
      root.render(
        <ActionableDigest
          ready
          digest={{
            groups: [],
            counts: {
              needsReply: 0,
              needsDecision: 0,
              unreadResults: 0,
              otherActions: 0,
              total: 0,
            },
          }}
          referenceTime={Date.parse("2026-08-12T10:05:00.000Z")}
          sourceState="unavailable"
          persistent
          desktopAlerts={desktopAlerts()}
          onMarkSeen={vi.fn().mockResolvedValue(true)}
          onOpenTask={vi.fn()}
          onOpenStoredResult={vi.fn()}
        />,
      );
    });
    const trigger = buttonNamed(
      "Open digest, 0 actions, 0 replies needed, 0 decisions needed, 0 unread results",
    );
    expect(trigger.dataset.attentionCount).toBe("0");
    expect(trigger.dataset.needsReplyCount).toBe("0");
    expect(trigger.dataset.unreadResultCount).toBe("0");
    expect(trigger.textContent).toBe("Digest0 actions");
    await click(trigger);
    const close = document.querySelector<HTMLButtonElement>(
      "[data-dialog-initial-focus]",
    )!;
    expect(document.activeElement).toBe(close);
    expect(document.body.textContent).toContain("All caught up");
    expect(document.body.textContent).toContain("local source is unavailable");

    const settingsSummary = document.querySelector<HTMLElement>(
      "[data-desktop-alert-settings] summary",
    )!;
    settingsSummary.focus();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }));
    });
    expect(document.activeElement).toBe(close);
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Tab", shiftKey: true }),
      );
    });
    expect(document.activeElement).toBe(settingsSummary);
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    await act(async () => {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("opens the exact stored result without substituting a task route", async () => {
    const target = {
      projectId: "project-a",
      objectiveId: "objective-a",
      workItemId: "work-a",
      attemptId: "attempt-a",
      resultKey: { kind: "turn" as const, id: "turn-a" },
    };
    const resultDigest: AttentionDigest = {
      counts: {
        needsReply: 0,
        needsDecision: 0,
        unreadResults: 0,
        otherActions: 1,
        total: 1,
      },
      groups: [
        {
          ...digest.groups[0],
          counts: {
            needsReply: 0,
            needsDecision: 0,
            unreadResults: 0,
            otherActions: 1,
            total: 1,
          },
          items: [
            {
              category: "other_actions",
              item: {
                ...item,
                openTaskId: undefined,
                verificationTarget: target,
              },
            },
          ],
        },
      ],
    };
    const openTask = vi.fn();
    const openStoredResult = vi.fn();
    await act(async () => {
      root.render(
        <ActionableDigest
          ready
          digest={resultDigest}
          referenceTime={Date.parse("2026-08-12T10:05:00.000Z")}
          sourceState="fresh"
          persistent
          desktopAlerts={desktopAlerts()}
          onMarkSeen={vi.fn().mockResolvedValue(true)}
          onOpenTask={openTask}
          onOpenStoredResult={openStoredResult}
        />,
      );
    });
    await click(
      buttonNamed(
        "Open digest, 1 action, 0 replies needed, 0 decisions needed, 0 unread results",
      ),
    );
    await click(document.querySelector<HTMLButtonElement>("[data-unread]")!);
    expect(openStoredResult).toHaveBeenCalledWith(target);
    expect(openTask).not.toHaveBeenCalled();
  });

  it("opens a due project review in Plan without substituting a task route", async () => {
    const openTask = vi.fn();
    const openProjectPlan = vi.fn();
    const scheduledDigest: AttentionDigest = {
      counts: {
        needsReply: 0,
        needsDecision: 0,
        unreadResults: 0,
        otherActions: 1,
        total: 1,
      },
      groups: [
        {
          ...digest.groups[0],
          counts: {
            needsReply: 0,
            needsDecision: 0,
            unreadResults: 0,
            otherActions: 1,
            total: 1,
          },
          items: [
            {
              category: "other_actions",
              item: {
                ...item,
                kind: "project_review_due",
                taskTitle: "Scheduled project review",
                openTaskId: undefined,
                planProjectId: "project-a",
                reason: "Your scheduled project review is due.",
                recommendedAction: "Open the project plan",
              },
            },
          ],
        },
      ],
    };
    await act(async () => {
      root.render(
        <ActionableDigest
          ready
          digest={scheduledDigest}
          referenceTime={Date.parse("2026-08-12T10:05:00.000Z")}
          sourceState="fresh"
          persistent
          desktopAlerts={desktopAlerts()}
          onMarkSeen={vi.fn().mockResolvedValue(true)}
          onOpenTask={openTask}
          onOpenStoredResult={vi.fn()}
          onOpenProjectPlan={openProjectPlan}
        />,
      );
    });
    await click(
      buttonNamed(
        "Open digest, 1 action, 0 replies needed, 0 decisions needed, 0 unread results",
      ),
    );
    await click(document.querySelector<HTMLButtonElement>("[data-unread]")!);
    expect(openProjectPlan).toHaveBeenCalledWith("project-a");
    expect(openTask).not.toHaveBeenCalled();
  });
});
