// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PixelOffice } from "../src/components/pixel-office";
import type { AttentionReviewController } from "../src/components/use-attention-review-state";

const projects = [
  {
    id: "project-a",
    name: "Project A",
    tasks: [
      {
        id: "task-a",
        title: "Implement the useful office",
        kind: "temporary" as const,
        lastActivityAt: "2026-08-11T08:00:30.000Z",
        status: {
          value: "active" as const,
          evidence: "observed" as const,
          source: "test",
          timestamp: "2026-08-11T08:00:00.000Z",
          stale: false,
        },
      },
    ],
  },
  {
    id: "project-b",
    name: "Project B",
    tasks: [],
  },
];

const review: AttentionReviewController = {
  ready: true,
  persistent: true,
  initializedAt: "2026-08-11T08:00:00.000Z",
  items: [],
  dispositionFor: () => undefined,
  snoozedUntilFor: () => undefined,
  isBaselined: () => false,
  markSeen: vi.fn(async () => true),
  markReviewed: vi.fn(async () => true),
  dismiss: vi.fn(),
  snooze: vi.fn(),
  restore: vi.fn(),
};

const attentionProjectGroupsById = new Map([
  [
    "project-a",
    {
      key: "project:project-a",
      projectId: "project-a",
      projectName: "Project A",
      items: [],
      counts: {
        needsReply: 0,
        needsDecision: 0,
        unreadResults: 0,
        otherActions: 0,
        total: 0,
      },
    },
  ],
  [
    "project-b",
    {
      key: "project:project-b",
      projectId: "project-b",
      projectName: "Project B",
      items: [],
      counts: {
        needsReply: 1,
        needsDecision: 1,
        unreadResults: 1,
        otherActions: 1,
        total: 4,
      },
    },
  ],
]);

describe("top-down project drawer modal", () => {
  let appShell: HTMLElement;
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    appShell = document.createElement("main");
    appShell.className = "app-shell";
    host = document.createElement("div");
    appShell.append(host);
    document.body.append(appShell);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    appShell.remove();
    vi.restoreAllMocks();
  });

  async function renderAndOpen(controller: AttentionReviewController = review) {
    await act(async () => {
      root.render(
        <PixelOffice
          project={projects[0]}
          projects={projects}
          onExit={vi.fn()}
          onEnterProject={vi.fn()}
          referenceTime={Date.parse("2026-08-11T08:01:00.000Z")}
          attentionProjectGroupsById={attentionProjectGroupsById}
          reviewWorkspace={{
            controller,
            visibleAttentionItems: [],
            requestedTask: null,
            onOpenTask: vi.fn(),
            onRequestHandled: vi.fn(),
          }}
        />,
      );
    });
    const trigger = host.querySelector<HTMLButtonElement>(
      '[aria-controls="project-door-rail"]',
    )!;
    trigger.focus();
    await act(async () => trigger.click());
    return trigger;
  }

  it("focuses the search and isolates the complete application background", async () => {
    appShell.setAttribute("aria-hidden", "previous-value");

    await renderAndOpen();

    const drawer = document.body.querySelector<HTMLElement>(
      '#project-door-rail[role="dialog"]',
    )!;
    const search = drawer.querySelector<HTMLInputElement>(
      '[aria-label="Search projects"]',
    )!;
    expect(drawer.getAttribute("aria-modal")).toBe("true");
    expect(document.activeElement).toBe(search);
    expect(appShell.inert).toBe(true);
    expect(appShell.getAttribute("aria-hidden")).toBe("true");
    expect(appShell.contains(drawer)).toBe(false);

    const outside = document.createElement("button");
    document.body.append(outside);
    outside.focus();
    expect(document.activeElement).toBe(search);
    outside.remove();
  });

  it("shows exact project action counts while retaining Live for a zero-action project", async () => {
    await renderAndOpen();

    const projectA = document.body.querySelector<HTMLButtonElement>(
      '#project-door-rail [data-project-id="project-a"]',
    )!;
    const projectB = document.body.querySelector<HTMLButtonElement>(
      '#project-door-rail [data-project-id="project-b"]',
    )!;
    expect(projectA.dataset.attentionCount).toBe("0");
    expect(projectA.dataset.needsReplyCount).toBe("0");
    expect(projectA.dataset.needsDecisionCount).toBe("0");
    expect(projectA.dataset.unreadResultCount).toBe("0");
    expect(projectA.textContent).toContain("0 actions");
    expect(projectA.textContent).toContain("Live");
    expect(projectA.getAttribute("aria-label")).toContain(
      "0 current actions, 0 replies needed, 0 decisions needed, 0 unread results. Session activity: session file changed within the last minute.",
    );
    expect(projectB.dataset.attentionCount).toBe("4");
    expect(projectB.dataset.needsReplyCount).toBe("1");
    expect(projectB.dataset.needsDecisionCount).toBe("1");
    expect(projectB.dataset.unreadResultCount).toBe("1");
    expect(projectB.textContent).toContain("4 actions");
    expect(projectB.textContent).toContain("1 reply needed");
    expect(projectB.textContent).toContain("1 decision needed");
    expect(projectB.textContent).toContain("1 unread");
    expect(projectB.getAttribute("aria-label")).toContain(
      "4 current actions, 1 reply needed, 1 decision needed, 1 unread result.",
    );
  });

  it("keeps office and drawer action counts unknown until Attention is ready", async () => {
    await renderAndOpen({ ...review, ready: false });

    const attention = host.querySelector<HTMLButtonElement>(
      '[aria-label="Attention for Project A is loading"]',
    )!;
    expect(attention.disabled).toBe(true);
    expect(attention.dataset.attentionCount).toBe("—");
    expect(attention.dataset.needsReplyCount).toBe("—");
    expect(attention.dataset.needsDecisionCount).toBe("—");
    expect(attention.dataset.unreadResultCount).toBe("—");
    expect(attention.textContent).toContain("—");

    const rows = [
      ...document.body.querySelectorAll<HTMLButtonElement>(
        "#project-door-rail [data-project-id]",
      ),
    ];
    expect(rows.every((row) => row.dataset.attentionCount === "—")).toBe(true);
    expect(rows.every((row) => row.dataset.needsReplyCount === "—")).toBe(true);
    expect(rows.every((row) => row.dataset.needsDecisionCount === "—")).toBe(
      true,
    );
    expect(rows.every((row) => row.dataset.unreadResultCount === "—")).toBe(
      true,
    );
    expect(rows.every((row) => row.textContent?.includes("Actions —"))).toBe(
      true,
    );
  });

  it("contains forward and reverse tab navigation", async () => {
    await renderAndOpen();

    const drawer =
      document.body.querySelector<HTMLElement>("#project-door-rail")!;
    const close = drawer.querySelector<HTMLButtonElement>(
      '[aria-label="Close projects"]',
    )!;
    const viewAll = Array.from(drawer.querySelectorAll("button")).at(-1)!;

    viewAll.focus();
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
    );
    expect(document.activeElement).toBe(close);

    close.focus();
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Tab",
        shiftKey: true,
        bubbles: true,
      }),
    );
    expect(document.activeElement).toBe(viewAll);
  });

  it("closes on Escape, restores the exact background state, and returns focus", async () => {
    appShell.setAttribute("aria-hidden", "previous-value");
    appShell.inert = false;
    const trigger = await renderAndOpen();

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });

    expect(document.body.querySelector("#project-door-rail")).toBeNull();
    expect(appShell.inert).toBe(false);
    expect(appShell.hasAttribute("inert")).toBe(false);
    expect(appShell.getAttribute("aria-hidden")).toBe("previous-value");
    expect(document.activeElement).toBe(trigger);
  });
});
