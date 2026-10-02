// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AttentionTransitionCue } from "../src/components/attention-transition-cue";
import type { AttentionItem } from "../src/lib/attention-inbox";

const item: AttentionItem = {
  eventKey: "task-a:waiting_for_user:2026-08-12T10:00:00.000Z",
  kind: "needs_input",
  priority: 0,
  projectId: "project-a",
  projectName: "Project A",
  taskId: "task-a",
  openTaskId: "task-a",
  taskTitle: "Approve the release note",
  occurredAt: "2026-08-12T10:00:00.000Z",
  status: "waiting_for_user",
  evidence: "observed",
  stale: false,
  reason: "Codex is waiting for your response.",
  recommendedAction: "Open the task and respond",
};

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

describe("AttentionTransitionCue", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  async function render(
    overrides: Partial<
      React.ComponentProps<typeof AttentionTransitionCue>
    > = {},
  ) {
    const props: React.ComponentProps<typeof AttentionTransitionCue> = {
      item,
      moreCount: 0,
      announcementRevision: 1,
      sourceState: "fresh",
      modalOpen: false,
      onOpen: vi.fn(),
      onClose: vi.fn(),
      onRequestFallbackFocus: vi.fn(),
      ...overrides,
    };
    await act(async () => root.render(<AttentionTransitionCue {...props} />));
    return props;
  }

  it("renders only an admitted, unobscured fresh or refreshing cue", async () => {
    await render({ item: null });
    expect(host.textContent).toBe("");

    await render({ sourceState: "stale" });
    expect(host.textContent).toBe("");

    await render({ sourceState: "unavailable" });
    expect(host.textContent).toBe("");

    await render({ modalOpen: true });
    expect(host.textContent).toBe("");

    await render({ sourceState: "refreshing" });
    expect(host.textContent).toContain("Needs your reply");
    expect(host.textContent).toContain("last complete snapshot");
  });

  it("announces safe identity and queue count without exposing action prose", async () => {
    await render({ moreCount: 2 });

    const region = host.querySelector('[role="region"]');
    const status = host.querySelector('[role="status"]');
    expect(region?.getAttribute("aria-labelledby")).toBeTruthy();
    expect(status?.getAttribute("aria-live")).toBe("polite");
    expect(status?.getAttribute("aria-atomic")).toBe("true");
    expect(status?.textContent).toContain("Needs your reply");
    expect(status?.textContent).toContain("Approve the release note");
    expect(status?.textContent).toContain("Project A");
    expect(status?.textContent).toContain("2 more new actions");
    expect(host.textContent).not.toContain(item.reason);
    expect(host.textContent).not.toContain(item.recommendedAction);
  });

  it.each([
    ["needs_input", "Needs your reply", "Open task"],
    ["ready_for_review", "Result ready to review", "Review result"],
    ["task_failed", "Task failed", "Open task"],
    ["blocked", "Task blocked", "Open task"],
    ["verification_failed", "Quality check failed", "Open stored result"],
    ["plan_link_mismatch", "Plan link needs attention", "Open task"],
    ["plan_link_orphaned", "Plan link needs attention", "Open task"],
  ] as const)(
    "maps %s to its safe copy and action",
    async (kind, label, action) => {
      await render({
        item: {
          ...item,
          kind,
          ...(kind === "verification_failed"
            ? {
                verificationTarget: {
                  projectId: "project-a",
                  objectiveId: "objective-a",
                  workItemId: "work-a",
                  attemptId: "attempt-a",
                  resultKey: { kind: "turn", id: "turn-a" },
                },
              }
            : {}),
        },
      });

      expect(host.querySelector("h2")?.textContent).toBe(label);
      expect(buttonNamed(action)).toBeTruthy();
    },
  );

  it("routes the exact event without closing or requesting fallback focus", async () => {
    const onOpen = vi.fn();
    const onClose = vi.fn();
    const onRequestFallbackFocus = vi.fn();
    await render({ onOpen, onClose, onRequestFallbackFocus });

    await act(async () => buttonNamed("Open task").click());

    expect(onOpen).toHaveBeenCalledWith(item.eventKey);
    expect(onClose).not.toHaveBeenCalled();
    expect(onRequestFallbackFocus).not.toHaveBeenCalled();
  });

  it("closes the batch and requests fallback focus after close or local Escape", async () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    const onClose = vi.fn();
    const onRequestFallbackFocus = vi.fn();
    await render({ onClose, onRequestFallbackFocus });

    await act(async () => buttonNamed("Hide new Attention cues").click());
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onRequestFallbackFocus).not.toHaveBeenCalled();
    frames.shift()?.(0);
    expect(onRequestFallbackFocus).toHaveBeenCalledTimes(1);

    const openButton = buttonNamed("Open task");
    openButton.focus();
    await act(async () => {
      openButton.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(onClose).toHaveBeenCalledTimes(2);
    frames.shift()?.(0);
    expect(onRequestFallbackFocus).toHaveBeenCalledTimes(2);

    await act(async () => {
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("labels the exact holding route and renders hostile strings as plain text", async () => {
    await render({
      item: {
        ...item,
        projectName: '<img src=x onerror="alert(1)">',
        taskTitle: '<script data-hostile="true">alert(1)</script>',
      },
    });

    expect(host.textContent).toContain(
      '<script data-hostile="true">alert(1)</script>',
    );
    expect(host.textContent).toContain('<img src=x onerror="alert(1)">');
    expect(host.querySelector("script")).toBeNull();
    expect(host.querySelector("img")).toBeNull();
    expect(host.querySelector("[data-hostile]")).toBeNull();

    await render({
      item: {
        ...item,
        projectId: "__unassigned__",
        projectName: '<img src=x onerror="alert(1)">',
      },
    });
    expect(host.textContent).toContain("Holding area");
    expect(host.textContent).not.toContain("<img");
  });
});
