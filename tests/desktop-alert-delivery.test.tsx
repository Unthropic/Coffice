// @vitest-environment happy-dom

import { StrictMode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AttentionTransitionController } from "../src/components/attention-transition-controller";
import type { DesktopAlertSettingsController } from "../src/components/use-desktop-alert-settings";
import type {
  AttentionDisposition,
  AttentionItem,
} from "../src/lib/attention-inbox";
import type { VerificationTarget } from "../src/lib/coffice-workspace";

const core = vi.hoisted(() => ({
  claim: vi.fn(),
  digest: vi.fn(),
  holdForeground: vi.fn(),
  reportFailure: vi.fn(),
  withMutePartition: vi.fn(),
  withDeliveryOpportunity: vi.fn(),
}));

vi.mock("../src/lib/desktop-alerts", () => ({
  DESKTOP_ALERT_NOTIFICATION_TAG: "coffice-attention",
  claimDesktopAlertEventKeys: core.claim,
  digestDesktopAlertEventKey: core.digest,
  holdDesktopAlertForegroundLock: core.holdForeground,
  refreshDesktopAlertState: vi.fn(),
  reportDesktopAlertFailure: core.reportFailure,
  withDesktopAlertMutePartition: core.withMutePartition,
  withDesktopAlertDeliveryOpportunity: core.withDeliveryOpportunity,
}));

function item(
  eventKey: string,
  overrides: Partial<AttentionItem> = {},
): AttentionItem {
  return {
    eventKey,
    kind: "needs_input",
    priority: 0,
    projectId: "project-a",
    projectName: "Private project name",
    taskId: `task-${eventKey}`,
    openTaskId: `task-${eventKey}`,
    taskTitle: `Private task ${eventKey}`,
    occurredAt: "2026-08-12T08:00:00.000Z",
    status: "waiting_for_user",
    evidence: "observed",
    stale: false,
    reason: "Private reason",
    recommendedAction: "Private recommended action",
    ...overrides,
  };
}

function desktopAlerts(
  status: DesktopAlertSettingsController["status"] = "on",
): DesktopAlertSettingsController {
  return {
    status,
    busy: false,
    message: null,
    enabled: status === "on",
    optedIn: status === "on",
    coordinationAvailable: true,
    projectMutedById: new Map(),
    projectMuteBusyId: null,
    projectMuteMessage: null,
    projectMuteResetBusy: false,
    projectMuteResetAvailable: false,
    projectMuteManageable: true,
    enable: async () => undefined,
    disable: () => undefined,
    setProjectMuted: async () => true,
    resetProjectMutes: async () => true,
  };
}

class TestNotification {
  static permission: NotificationPermission = "granted";
  static instances: TestNotification[] = [];
  static throwOnConstruct = false;

  readonly title: string;
  readonly options: NotificationOptions | undefined;
  onclick: ((event: Event) => void) | null = null;
  onclose: ((event: Event) => void) | null = null;
  close = vi.fn(() => this.onclose?.(new Event("close")));

  constructor(title: string, options?: NotificationOptions) {
    if (TestNotification.throwOnConstruct) {
      throw new Error("Desktop constructor unavailable");
    }
    this.title = title;
    this.options = options;
    TestNotification.instances.push(this);
  }
}

describe("desktop Attention delivery", () => {
  let container: HTMLDivElement;
  let root: Root;
  let visibility: DocumentVisibilityState;
  let dispositions: Record<string, AttentionDisposition>;
  const markSeen = vi.fn<(eventKey: string) => Promise<boolean>>();
  const openTask = vi.fn<(projectId: string, taskId: string) => void>();
  const openStoredResult = vi.fn<(target: VerificationTarget) => void>();
  const focusWindow = vi.fn();

  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    visibility = "hidden";
    dispositions = {};
    markSeen.mockReset().mockResolvedValue(false);
    openTask.mockReset();
    openStoredResult.mockReset();
    focusWindow.mockReset();
    core.claim.mockReset().mockImplementation(async (eventKeys: string[]) => ({
      kind: "claimed",
      primaryDigest: `digest:${eventKeys[0]}`,
      claimedCount: eventKeys.length,
    }));
    core.digest
      .mockReset()
      .mockImplementation(async (eventKey: string) => `digest:${eventKey}`);
    core.holdForeground.mockReset().mockResolvedValue(undefined);
    core.reportFailure.mockReset();
    core.withMutePartition
      .mockReset()
      .mockImplementation(async (values, _projectIdFor, callback) => {
        await callback({ muted: [], unmuted: values });
        return true;
      });
    core.withDeliveryOpportunity
      .mockReset()
      .mockImplementation(
        async (callback: () => Promise<() => unknown> | (() => unknown)) => ({
          kind: "acquired",
          value: await (await callback())(),
        }),
      );
    TestNotification.permission = "granted";
    TestNotification.instances = [];
    TestNotification.throwOnConstruct = false;
    vi.stubGlobal("Notification", TestNotification);
    vi.spyOn(document, "visibilityState", "get").mockImplementation(
      () => visibility,
    );
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    vi.spyOn(window, "focus").mockImplementation(focusWindow);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document
      .querySelectorAll('[aria-modal="true"]')
      .forEach((node) => node.remove());
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function flushDelivery() {
    for (let index = 0; index < 4; index += 1) {
      await act(async () => Promise.resolve());
    }
  }

  async function render(
    items: readonly AttentionItem[],
    options: {
      settings?: DesktopAlertSettingsController;
      admissionReady?: boolean;
      sourceState?: "fresh" | "refreshing" | "stale" | "unavailable";
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
            desktopAlerts={options.settings ?? desktopAlerts()}
            onMarkSeen={markSeen}
            onOpenTask={openTask}
            onOpenStoredResult={openStoredResult}
            onRequestFallbackFocus={() => undefined}
          />
        </StrictMode>,
      );
    });
    await flushDelivery();
  }

  it("silently baselines current work and sends one generic hidden-page alert for a later batch", async () => {
    await render([item("existing")]);
    expect(TestNotification.instances).toHaveLength(0);
    expect(core.claim).toHaveBeenCalledExactlyOnceWith(
      ["existing"],
      "baseline",
    );

    await render([
      item("new-secret", {
        taskTitle: "Do not expose this task",
        projectName: "Do not expose this project",
      }),
      item("existing"),
    ]);

    expect(core.claim).toHaveBeenLastCalledWith(["new-secret"], "delivered");
    expect(TestNotification.instances).toHaveLength(1);
    const notification = TestNotification.instances[0];
    expect(notification.title).toBe("Coffice");
    expect(notification.options).toEqual({
      body: "A new action is ready. Open Coffice to review it.",
      tag: "coffice-attention",
      silent: true,
    });
    expect(JSON.stringify(notification.options)).not.toContain("secret");
    expect(markSeen).not.toHaveBeenCalled();
    expect(openTask).not.toHaveBeenCalled();
  });

  it("claims muted members permanently and presents only the unmuted mixed batch", async () => {
    await render([item("existing")]);
    core.claim.mockClear();
    core.withMutePartition.mockImplementationOnce(
      async (values, _projectIdFor, callback) => {
        await callback({ muted: [values[0]], unmuted: [values[1]] });
        return true;
      },
    );

    await render([
      item("muted", { projectId: "project-muted" }),
      item("eligible", { projectId: "__unassigned__" }),
      item("existing"),
    ]);

    expect(core.claim).toHaveBeenCalledWith(["muted"], "muted");
    expect(core.claim).toHaveBeenCalledWith(["eligible"], "delivered");
    expect(TestNotification.instances).toHaveLength(1);
    expect(TestNotification.instances[0].options?.body).toContain(
      "A new action",
    );

    core.withMutePartition.mockClear();
    await render([item("eligible"), item("existing")]);
    expect(TestNotification.instances).toHaveLength(1);
  });

  it("claims an entirely muted batch without displaying or routing it", async () => {
    await render([item("existing")]);
    core.claim.mockClear();
    core.withMutePartition.mockImplementationOnce(
      async (values, _projectIdFor, callback) => {
        await callback({ muted: values, unmuted: [] });
        return true;
      },
    );

    await render([item("muted-only"), item("existing")]);

    expect(core.claim).toHaveBeenCalledWith(["muted-only"], "muted");
    expect(TestNotification.instances).toHaveLength(0);
    expect(markSeen).not.toHaveBeenCalled();
    expect(openTask).not.toHaveBeenCalled();
  });

  it("claims a foreground batch permanently without constructing or marking seen", async () => {
    visibility = "visible";
    await render([]);
    await render([item("foreground")]);

    expect(core.claim).toHaveBeenCalledExactlyOnceWith(
      ["foreground"],
      "foreground",
    );
    expect(core.withDeliveryOpportunity).not.toHaveBeenCalled();
    expect(TestNotification.instances).toHaveLength(0);
    expect(markSeen).not.toHaveBeenCalled();
  });

  it("advertises a visible page through the shared lock even while alerts are off", async () => {
    visibility = "visible";
    await render([], { settings: desktopAlerts("off") });

    expect(core.holdForeground).toHaveBeenCalled();
    expect(core.claim).not.toHaveBeenCalled();
    expect(TestNotification.instances).toHaveLength(0);
  });

  it("baselines work admitted while off when the user later enables delivery", async () => {
    await render([], { settings: desktopAlerts("off") });
    await render([item("while-off")], {
      settings: desktopAlerts("off"),
    });
    await render([item("while-off")]);
    expect(core.claim).toHaveBeenCalledExactlyOnceWith(
      ["while-off"],
      "baseline",
    );

    await render([item("later"), item("while-off")]);
    expect(core.claim).toHaveBeenLastCalledWith(["later"], "delivered");
  });

  it("maps the claimed primary digest to the exact current item and keeps the payload plural", async () => {
    core.claim.mockImplementation(async () => ({
      kind: "claimed",
      primaryDigest: "digest:second",
      claimedCount: 2,
    }));
    await render([]);
    await render([item("first"), item("second")]);

    const notification = TestNotification.instances[0];
    expect(notification.options?.body).toBe(
      "New actions are ready. Open Coffice to review them.",
    );
    await act(async () => notification.onclick?.(new Event("click")));

    expect(notification.close).toHaveBeenCalledOnce();
    expect(focusWindow).toHaveBeenCalledOnce();
    expect(markSeen).toHaveBeenCalledExactlyOnceWith("second");
    expect(openTask).toHaveBeenCalledExactlyOnceWith(
      "project-a",
      "task-second",
    );
  });

  it("revalidates freshness, current membership, and modal safety at click time", async () => {
    await render([]);
    await render([item("stale-on-click")]);
    const notification = TestNotification.instances[0];

    await render([item("stale-on-click")], { sourceState: "stale" });
    await act(async () => notification.onclick?.(new Event("click")));
    expect(focusWindow).toHaveBeenCalledOnce();
    expect(markSeen).not.toHaveBeenCalled();
    expect(openTask).not.toHaveBeenCalled();

    await render([item("stale-on-click")]);
    const modal = document.createElement("section");
    modal.setAttribute("aria-modal", "true");
    document.body.append(modal);
    await act(async () => notification.onclick?.(new Event("click")));
    expect(focusWindow).toHaveBeenCalledTimes(2);
    expect(markSeen).not.toHaveBeenCalled();

    modal.remove();
    await render([]);
    await act(async () => notification.onclick?.(new Event("click")));
    expect(focusWindow).toHaveBeenCalledTimes(3);
    expect(markSeen).not.toHaveBeenCalled();
    expect(openTask).not.toHaveBeenCalled();
  });

  it("routes an exact holding item or stored result after a failed seen receipt", async () => {
    const target: VerificationTarget = {
      projectId: "project-history",
      objectiveId: "objective-exact",
      workItemId: "work-exact",
      attemptId: "attempt-exact",
      resultKey: { kind: "revision", id: "revision-exact" },
    };
    await render([]);
    await render([
      item("holding", {
        projectId: "__unassigned__",
        openTaskId: "holding-exact",
      }),
    ]);
    await act(async () =>
      TestNotification.instances[0].onclick?.(new Event("click")),
    );
    expect(openTask).toHaveBeenCalledWith("__unassigned__", "holding-exact");

    dispositions.holding = {
      kind: "needs_review",
      at: "2026-08-12T08:05:00.000Z",
    };
    await render([
      item("stored", {
        kind: "verification_failed",
        projectId: "project-history",
        verificationTarget: target,
      }),
    ]);
    await act(async () =>
      TestNotification.instances[1].onclick?.(new Event("click")),
    );
    expect(markSeen).toHaveBeenLastCalledWith("stored");
    expect(openStoredResult).toHaveBeenCalledExactlyOnceWith(target);
  });

  it("fails quiet for duplicate claims, unavailable delivery locks, and constructor failure without retry", async () => {
    await render([]);
    core.claim.mockResolvedValue({ kind: "duplicate" });
    await render([item("duplicate")]);
    expect(TestNotification.instances).toHaveLength(0);

    core.withDeliveryOpportunity.mockResolvedValue({ kind: "unavailable" });
    await render([item("no-lock"), item("duplicate")]);
    expect(TestNotification.instances).toHaveLength(0);

    core.withDeliveryOpportunity.mockImplementation(
      async (callback: () => Promise<() => unknown> | (() => unknown)) => ({
        kind: "acquired",
        value: await (await callback())(),
      }),
    );
    core.claim.mockImplementation(async (eventKeys: string[]) => ({
      kind: "claimed",
      primaryDigest: `digest:${eventKeys[0]}`,
      claimedCount: eventKeys.length,
    }));
    TestNotification.throwOnConstruct = true;
    await render([
      item("constructor-fails"),
      item("no-lock"),
      item("duplicate"),
    ]);
    const claimsAfterFailure = core.claim.mock.calls.length;
    await render([
      item("constructor-fails"),
      item("no-lock"),
      item("duplicate"),
    ]);
    expect(core.claim).toHaveBeenCalledTimes(claimsAfterFailure);
    expect(core.reportFailure).toHaveBeenCalledWith(
      expect.stringContaining("could not display"),
    );
    expect(markSeen).not.toHaveBeenCalled();
  });

  it("awaits baseline persistence before processing a later admitted batch", async () => {
    let finishBaseline: ((value: unknown) => void) | undefined;
    core.claim.mockImplementation((eventKeys: string[], mode: string) =>
      mode === "baseline"
        ? new Promise((resolve) => {
            finishBaseline = resolve;
          })
        : Promise.resolve({
            kind: "claimed",
            primaryDigest: `digest:${eventKeys[0]}`,
            claimedCount: eventKeys.length,
          }),
    );

    await render([item("existing")]);
    await render([item("later"), item("existing")]);
    expect(TestNotification.instances).toHaveLength(0);
    expect(core.claim).toHaveBeenCalledTimes(1);

    finishBaseline?.({ kind: "claimed", claimedCount: 1 });
    await flushDelivery();
    expect(core.claim).toHaveBeenLastCalledWith(["later"], "delivered");
    expect(TestNotification.instances).toHaveLength(1);
  });

  it("abandons an old delivery after disable and silently baselines the quick re-enable", async () => {
    let markDigestStarted: (() => void) | undefined;
    const digestStarted = new Promise<void>((resolve) => {
      markDigestStarted = resolve;
    });
    let finishDigest: ((digest: string) => void) | undefined;
    core.digest.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          finishDigest = resolve;
          markDigestStarted?.();
        }),
    );

    await render([]);
    core.claim.mockClear();
    await render([item("pending-before-disable")]);
    await digestStarted;

    await render([item("pending-before-disable")], {
      settings: desktopAlerts("off"),
    });
    await render([item("pending-before-disable")]);

    expect(core.claim.mock.calls).toEqual([
      [["pending-before-disable"], "baseline"],
    ]);
    finishDigest?.("digest:pending-before-disable");
    await flushDelivery();

    expect(core.claim.mock.calls).toEqual([
      [["pending-before-disable"], "baseline"],
    ]);
    expect(TestNotification.instances).toHaveLength(0);
    expect(markSeen).not.toHaveBeenCalled();
    expect(openTask).not.toHaveBeenCalled();
  });

  it("claims foreground suppression before releasing the atomic opportunity", async () => {
    const order: string[] = [];
    core.withDeliveryOpportunity.mockImplementation(
      async (_onAcquired: () => unknown, onForeground: () => Promise<void>) => {
        order.push("opportunity");
        await onForeground();
        order.push("released");
        return { kind: "foreground" };
      },
    );
    core.claim.mockImplementation(async (_keys: string[], mode: string) => {
      if (mode === "foreground") order.push("claimed");
      return { kind: "claimed", claimedCount: 1 };
    });

    await render([]);
    await render([item("other-page-visible")]);

    expect(order).toEqual(["opportunity", "claimed", "released"]);
    expect(TestNotification.instances).toHaveLength(0);
  });

  it("claims as foreground when this page becomes visible during hashing", async () => {
    let finishDigest: ((digest: string) => void) | undefined;
    core.digest.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          finishDigest = resolve;
        }),
    );
    await render([]);
    await render([item("visible-during-hash")]);

    visibility = "visible";
    finishDigest?.("digest:visible-during-hash");
    await flushDelivery();

    expect(core.claim).toHaveBeenLastCalledWith(
      ["visible-during-hash"],
      "foreground",
    );
    expect(TestNotification.instances).toHaveLength(0);
  });

  it("rechecks local visibility immediately before the constructor commit", async () => {
    core.claim.mockImplementation(async (eventKeys: string[], mode: string) => {
      if (mode === "delivered") visibility = "visible";
      return {
        kind: "claimed",
        primaryDigest: `digest:${eventKeys[0]}`,
        claimedCount: eventKeys.length,
      };
    });
    await render([]);
    await render([item("visible-before-constructor")]);

    expect(core.claim).toHaveBeenLastCalledWith(
      ["visible-before-constructor"],
      "delivered",
    );
    expect(TestNotification.instances).toHaveLength(0);
  });

  it("closes an outstanding alert on disable and prevents its click from routing", async () => {
    await render([]);
    await render([item("disable-before-click")]);
    const notification = TestNotification.instances[0];

    await render([item("disable-before-click")], {
      settings: desktopAlerts("off"),
    });
    expect(notification.close).toHaveBeenCalledOnce();

    await act(async () => notification.onclick?.(new Event("click")));
    expect(focusWindow).toHaveBeenCalledOnce();
    expect(markSeen).not.toHaveBeenCalled();
    expect(openTask).not.toHaveBeenCalled();
  });

  it("closes the prior alert before replacing it with a later batch", async () => {
    await render([]);
    await render([item("first")]);
    const first = TestNotification.instances[0];

    await render([item("second"), item("first")]);
    expect(TestNotification.instances).toHaveLength(2);
    expect(first.close).toHaveBeenCalledOnce();
  });
});
