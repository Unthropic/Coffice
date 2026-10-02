// @vitest-environment happy-dom

import { readFileSync } from "node:fs";

import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { TopDownOffice } from "../src/components/top-down-office";
import type { TopDownRosterWorker } from "../src/lib/top-down-office-roster";

const workers: TopDownRosterWorker[] = [
  {
    taskId: "agent-1",
    displayName: "Mina",
    status: "active",
    attention: false,
    stale: false,
    visualIdentity: 2,
    workflowArea: "desk",
  },
  {
    taskId: "agent-2",
    displayName: "Theo",
    status: "idle",
    attention: true,
    stale: false,
    visualIdentity: 4,
    workflowArea: "desk",
  },
];

describe("top-down office", () => {
  it("renders live agents as selectable world objects with separate desks", () => {
    const markup = renderToStaticMarkup(
      <TopDownOffice
        workers={workers}
        selectedTaskId="agent-1"
        onSelectTask={vi.fn()}
      />,
    );

    expect(markup).toContain('data-topdown-room="true"');
    expect(markup).toContain('data-overhead-camera="90deg"');
    expect(markup).toContain('data-world-width="1200"');
    expect(markup).toContain('data-world-height="956"');
    expect(markup).toContain('data-motion-phase="idle"');
    expect(markup).toContain("Mina, active");
    expect(markup).toContain("Theo, idle");
    expect(markup).toContain("Desk 01, assigned to Mina");
    expect(markup).toContain('aria-pressed="true"');
  });

  it("is the production default and consumes the generated avatar sheet", () => {
    const shell = readFileSync("src/components/pixel-office.tsx", "utf8");
    const css = readFileSync(
      "src/components/top-down-office.module.css",
      "utf8",
    );

    expect(shell).toContain('data-product-office-renderer="topdown"');
    expect(shell).toContain(
      "bindTopDownRoster(project.tasks, visibleTaskLabels, {",
    );
    expect(shell).not.toContain("LegacyPixelOffice");
    expect(shell).not.toContain("renderer?:");
    expect(css).toContain(
      "/assets/topdown-office/coffice-overhead-agent-sheet-v2.png",
    );
    expect(css).toContain(
      "/assets/topdown-office/coffice-overhead-agent-work-sheet-v3.png",
    );
    expect(css).toContain(
      "/assets/topdown-office/coffice-overhead-agent-walk-left-contact-v4.png",
    );
    expect(css).toContain(
      "/assets/topdown-office/coffice-overhead-agent-walk-right-passing-v4.png",
    );
    expect(css).toContain(
      "/assets/topdown-office/coffice-overhead-agent-typing-alternate-v4.png",
    );
    expect(css).toContain(
      "/assets/topdown-office/coffice-overhead-agent-seated-rest-v4.png",
    );
    expect(css).toContain(
      "/assets/topdown-office/coffice-overhead-agent-attention-wave-v4.png",
    );
    expect(css).toContain(
      "/assets/topdown-office/coffice-overhead-agent-completion-v4.png",
    );
    expect(css).not.toMatch(/@keyframes actorWalk\s*\{/);
    expect(css).not.toContain("@keyframes shadowStep");
    expect(css).toMatch(/\.emptyRoom\s*\{[\s\S]*?top:\s*350px;/);
    expect(css).toMatch(
      /\.worldWorker\[data-facing="north"\] \.actorFacing\s*\{\s*--actor-rotation:\s*180deg;/,
    );
    expect(css).toMatch(
      /\.worldWorker\[data-facing="east"\] \.actorFacing\s*\{\s*--actor-rotation:\s*-90deg;/,
    );
    expect(css).toMatch(
      /\.worldWorker\[data-facing="south"\] \.actorFacing\s*\{\s*--actor-rotation:\s*0deg;/,
    );
    expect(css).toMatch(
      /\.worldWorker\[data-facing="west"\] \.actorFacing\s*\{\s*--actor-rotation:\s*90deg;/,
    );
    expect(css).toMatch(
      /\[data-at-desk\]\[data-motion-phase="completed"\][\s\S]*?coffice-overhead-agent-seated-rest-v4\.png/,
    );
    expect(css).toMatch(
      /\.chair\s*\{[\s\S]*?width:\s*74px;[\s\S]*?height:\s*74px;[\s\S]*?border-radius:\s*50%;/,
    );
    expect(css).not.toContain("windowWall");
  });

  it("moves the selected agent when open floor is clicked", async () => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <TopDownOffice
          workers={workers}
          selectedTaskId="agent-1"
          onSelectTask={vi.fn()}
        />,
      );
    });

    const room = host.querySelector<HTMLElement>("[data-topdown-room='true']");
    const agent = host.querySelector<HTMLElement>("[aria-label^='Mina,']");
    expect(room).not.toBeNull();
    expect(agent).not.toBeNull();
    Object.defineProperty(room, "getBoundingClientRect", {
      value: () => ({ left: 0, top: 0, width: 1000, height: 1000 }),
    });

    await act(async () => {
      room?.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          clientX: 500,
          clientY: 750,
        }),
      );
    });

    expect(agent?.style.getPropertyValue("--worker-x")).not.toBe("250px");
    expect(agent?.dataset.motionPhase).toBe("walking");
    expect(host.textContent).toContain("Mina is walking to the selected spot.");
    await act(async () => root.unmount());
    host.remove();
  });

  it("does not move an agent when furniture is clicked", async () => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <TopDownOffice
          workers={workers}
          selectedTaskId="agent-1"
          onSelectTask={vi.fn()}
        />,
      );
    });
    const lounge = host.querySelector<HTMLElement>("[data-world-obstacle]");
    const agent = host.querySelector<HTMLElement>("[aria-label^='Mina,']");
    const initialX = agent?.style.getPropertyValue("--worker-x");
    const initialY = agent?.style.getPropertyValue("--worker-y");

    await act(async () => {
      lounge?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, clientX: 500, clientY: 750 }),
      );
    });

    expect(agent?.style.getPropertyValue("--worker-x")).toBe(initialX);
    expect(agent?.style.getPropertyValue("--worker-y")).toBe(initialY);
    expect(host.textContent).not.toContain("moved to an open floor spot");
    await act(async () => root.unmount());
    host.remove();
  });

  it("rejects a direct floor target inside a furniture footprint", async () => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <TopDownOffice
          workers={workers}
          selectedTaskId="agent-1"
          onSelectTask={vi.fn()}
        />,
      );
    });

    const room = host.querySelector<HTMLElement>("[data-topdown-room='true']");
    const agent = host.querySelector<HTMLElement>("[aria-label^='Mina,']");
    const initialX = agent?.style.getPropertyValue("--worker-x");
    const initialY = agent?.style.getPropertyValue("--worker-y");
    Object.defineProperty(room, "getBoundingClientRect", {
      value: () => ({ left: 0, top: 0, width: 1200, height: 956 }),
    });

    await act(async () => {
      room?.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          clientX: 200,
          clientY: 500,
        }),
      );
    });

    expect(agent?.style.getPropertyValue("--worker-x")).toBe(initialX);
    expect(agent?.style.getPropertyValue("--worker-y")).toBe(initialY);
    expect(host.textContent).toContain(
      "That route is occupied. Choose another open floor area.",
    );
    expect(host.querySelector("[data-marker-tone='blocked']")).not.toBeNull();
    await act(async () => root.unmount());
    host.remove();
  });

  it("rejects a floor target occupied by another agent", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <TopDownOffice
          workers={workers}
          selectedTaskId="agent-1"
          onSelectTask={vi.fn()}
        />,
      );
    });
    const room = host.querySelector<HTMLElement>("[data-topdown-room='true']");
    const agent = host.querySelector<HTMLElement>("[data-assigned-desk='0']");
    const initialX = agent?.style.getPropertyValue("--worker-x");
    Object.defineProperty(room, "getBoundingClientRect", {
      value: () => ({ left: 0, top: 0, width: 1200, height: 956 }),
    });

    await act(async () => {
      room?.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          clientX: 550,
          clientY: 365,
        }),
      );
    });
    expect(agent?.style.getPropertyValue("--worker-x")).toBe(initialX);
    expect(host.textContent).toContain(
      "That route is occupied. Choose another open floor area.",
    );
    await act(async () => root.unmount());
    host.remove();
  });

  it("finishes a manual floor move standing even when the agent is active", async () => {
    vi.useFakeTimers();
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    try {
      await act(async () => {
        root.render(
          <TopDownOffice
            workers={workers}
            selectedTaskId="agent-1"
            onSelectTask={vi.fn()}
          />,
        );
      });
      const room = host.querySelector<HTMLElement>(
        "[data-topdown-room='true']",
      );
      const agent = host.querySelector<HTMLElement>("[aria-label^='Mina,']");
      Object.defineProperty(room, "getBoundingClientRect", {
        value: () => ({ left: 0, top: 0, width: 1200, height: 956 }),
      });

      await act(async () => {
        room?.dispatchEvent(
          new MouseEvent("click", {
            bubbles: true,
            clientX: 600,
            clientY: 487.5,
          }),
        );
      });
      expect(agent?.dataset.motionPhase).toBe("walking");

      await act(async () => {
        vi.advanceTimersByTime(10_000);
      });
      expect(agent?.dataset.motionPhase).toBe("idle");
      expect(agent?.dataset.atDesk).toBeUndefined();
      expect(host.textContent).toContain("Mina reached the open floor.");
    } finally {
      await act(async () => root.unmount());
      host.remove();
      vi.useRealTimers();
    }
  });

  it("animates a desk interaction through walking, sitting, and working", async () => {
    vi.useFakeTimers();
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    try {
      await act(async () => {
        root.render(
          <TopDownOffice
            workers={workers}
            selectedTaskId="agent-1"
            onSelectTask={vi.fn()}
          />,
        );
      });
      const desk = host.querySelector<HTMLElement>(
        "[aria-label='Desk 01, assigned to Mina']",
      );
      const agent = host.querySelector<HTMLElement>("[aria-label^='Mina,']");

      await act(async () => {
        desk?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      expect(agent?.dataset.motionPhase).toBe("walking");

      await act(async () => {
        vi.advanceTimersByTime(445);
      });
      expect(agent?.dataset.motionPhase).toBe("sitting");

      await act(async () => {
        vi.advanceTimersByTime(421);
      });
      expect(agent?.dataset.motionPhase).toBe("working");
      expect(agent?.dataset.atDesk).toBe("0");
      expect(agent?.dataset.facing).toBe("north");
      expect(host.textContent).toContain("Mina sat down and started working.");
    } finally {
      await act(async () => root.unmount());
      host.remove();
      vi.useRealTimers();
    }
  });

  it("settles an in-flight move immediately when reduced motion is enabled", async () => {
    vi.useFakeTimers();
    const originalMatchMedia = window.matchMedia;
    let reduced = false;
    const listeners = new Set<() => void>();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({
        get matches() {
          return reduced;
        },
        addEventListener: (_event: string, listener: () => void) =>
          listeners.add(listener),
        removeEventListener: (_event: string, listener: () => void) =>
          listeners.delete(listener),
      })),
    });
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    try {
      await act(async () => {
        root.render(
          <TopDownOffice
            workers={workers}
            selectedTaskId="agent-1"
            onSelectTask={vi.fn()}
          />,
        );
      });
      const room = host.querySelector<HTMLElement>(
        "[data-topdown-room='true']",
      );
      const agent = host.querySelector<HTMLElement>("[aria-label^='Mina,']");
      Object.defineProperty(room, "getBoundingClientRect", {
        value: () => ({ left: 0, top: 0, width: 1200, height: 956 }),
      });

      await act(async () => {
        room?.dispatchEvent(
          new MouseEvent("click", {
            bubbles: true,
            clientX: 650,
            clientY: 360,
          }),
        );
      });
      expect(agent?.dataset.motionPhase).toBe("walking");

      await act(async () => {
        reduced = true;
        for (const listener of listeners) listener();
      });
      expect(agent?.dataset.motionPhase).toBe("idle");
      expect(agent?.style.getPropertyValue("--move-duration")).toBe("0ms");
    } finally {
      await act(async () => root.unmount());
      host.remove();
      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        value: originalMatchMedia,
      });
      vi.useRealTimers();
    }
  });

  it("seats idle and completed live agents at their own desks", async () => {
    vi.useFakeTimers();
    const restingWorkers: TopDownRosterWorker[] = [
      { ...workers[0], status: "idle", attention: false },
      { ...workers[1], status: "completed", attention: false },
    ];
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    try {
      await act(async () => {
        root.render(
          <TopDownOffice
            workers={restingWorkers}
            selectedTaskId="agent-2"
            onSelectTask={vi.fn()}
          />,
        );
      });
      await act(async () => {
        vi.advanceTimersByTime(2_000);
      });

      const idleAgent = host.querySelector<HTMLElement>(
        "[data-assigned-desk='0']",
      );
      const completedAgent = host.querySelector<HTMLElement>(
        "[data-assigned-desk='1']",
      );
      expect(idleAgent?.dataset.motionPhase).toBe("seated");
      expect(idleAgent?.dataset.atDesk).toBe("0");
      expect(idleAgent?.dataset.facing).toBe("north");
      expect(completedAgent?.dataset.motionPhase).toBe("completed");
      expect(completedAgent?.dataset.atDesk).toBe("1");
      expect(completedAgent?.dataset.facing).toBe("north");
      expect(
        host.querySelector<HTMLElement>("[data-desk-assignment='0']")?.hidden,
      ).toBe(false);
      expect(
        host.querySelector<HTMLElement>("[data-desk-assignment='1']")?.hidden,
      ).toBe(true);
      expect(
        host.querySelectorAll("[data-chair-state='occupied']"),
      ).toHaveLength(2);
    } finally {
      await act(async () => root.unmount());
      host.remove();
      vi.useRealTimers();
    }
  });

  it("retries an automatic return after a nearby actor clears the aisle", async () => {
    vi.useFakeTimers();
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    const returningWorker: TopDownRosterWorker = {
      ...workers[0],
      taskId: "returning-worker",
      displayName: "Returning worker",
      status: "idle",
      attention: false,
    };
    const blockingWorker: TopDownRosterWorker = {
      ...workers[1],
      taskId: "blocking-worker",
      displayName: "Blocking worker",
      status: "idle",
      attention: false,
    };
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    try {
      await act(async () => {
        root.render(
          <TopDownOffice
            workers={[returningWorker]}
            selectedTaskId={returningWorker.taskId}
            onSelectTask={vi.fn()}
          />,
        );
      });
      const room = host.querySelector<HTMLElement>(
        "[data-topdown-room='true']",
      );
      Object.defineProperty(room, "getBoundingClientRect", {
        value: () => ({ left: 0, top: 0, width: 1200, height: 956 }),
      });

      await act(async () => {
        room?.dispatchEvent(
          new MouseEvent("click", {
            bubbles: true,
            clientX: 700,
            clientY: 400,
          }),
        );
        vi.advanceTimersByTime(5_000);
      });

      const initialWorkers = [returningWorker, blockingWorker];
      await act(async () => {
        root.render(
          <TopDownOffice
            workers={initialWorkers}
            selectedTaskId={blockingWorker.taskId}
            onSelectTask={vi.fn()}
          />,
        );
      });
      await act(async () => {
        room?.dispatchEvent(
          new MouseEvent("click", {
            bubbles: true,
            clientX: 450,
            clientY: 350,
          }),
        );
      });
      for (let elapsed = 0; elapsed < 5_000; elapsed += 500) {
        await act(async () => {
          vi.advanceTimersByTime(500);
        });
      }

      let returningAgent = host.querySelector<HTMLElement>(
        "[data-assigned-desk='0']",
      );
      const blockingAgent = host.querySelector<HTMLElement>(
        "[data-assigned-desk='1']",
      );
      expect(returningAgent?.style.getPropertyValue("--worker-x")).toBe(
        "700px",
      );
      expect(returningAgent?.style.getPropertyValue("--worker-y")).toBe(
        "400px",
      );
      expect(blockingAgent?.style.getPropertyValue("--worker-x")).toBe("450px");
      expect(blockingAgent?.style.getPropertyValue("--worker-y")).toBe("350px");
      expect(blockingAgent?.dataset.atDesk).toBeUndefined();

      const activeReturningWorker = {
        ...returningWorker,
        status: "active" as const,
      };
      const occupiedWorkers = [activeReturningWorker, blockingWorker];
      await act(async () => {
        root.render(
          <TopDownOffice
            workers={occupiedWorkers}
            selectedTaskId={returningWorker.taskId}
            onSelectTask={vi.fn()}
          />,
        );
      });
      await act(async () => {
        vi.advanceTimersByTime(200);
      });

      returningAgent = host.querySelector<HTMLElement>(
        "[data-assigned-desk='0']",
      );
      expect(returningAgent?.style.getPropertyValue("--worker-x")).toBe(
        "700px",
      );
      expect(returningAgent?.dataset.atDesk).toBeUndefined();

      await act(async () => {
        root.render(
          <TopDownOffice
            workers={occupiedWorkers}
            selectedTaskId={blockingWorker.taskId}
            onSelectTask={vi.fn()}
          />,
        );
      });
      await act(async () => {
        room?.dispatchEvent(
          new MouseEvent("click", {
            bubbles: true,
            clientX: 850,
            clientY: 500,
          }),
        );
      });
      expect(
        host.querySelector("p[aria-live='polite']")?.textContent,
      ).toContain("is walking");
      expect(
        host.querySelector<HTMLElement>("[data-assigned-desk='1']")?.dataset
          .motionPhase,
      ).toBe("walking");
      for (let elapsed = 0; elapsed < 15_000; elapsed += 500) {
        await act(async () => {
          vi.advanceTimersByTime(500);
        });
      }

      returningAgent = host.querySelector<HTMLElement>(
        "[data-assigned-desk='0']",
      );
      const clearedBlockingAgent = host.querySelector<HTMLElement>(
        "[data-assigned-desk='1']",
      );
      expect(
        clearedBlockingAgent?.style.getPropertyValue("--worker-x"),
      ).not.toBe("450px");
      expect(returningAgent?.dataset.atDesk).toBe("0");
      expect(returningAgent?.dataset.motionPhase).toBe("working");
      expect(returningAgent?.dataset.facing).toBe("north");
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      await act(async () => root.unmount());
      host.remove();
      vi.useRealTimers();
    }
  });

  it("requires an explicit agent selection before floor movement", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <TopDownOffice
          workers={workers}
          selectedTaskId={null}
          onSelectTask={vi.fn()}
        />,
      );
    });
    const room = host.querySelector<HTMLElement>("[data-topdown-room='true']");
    const agent = host.querySelector<HTMLElement>("[data-assigned-desk='0']");
    const initialX = agent?.style.getPropertyValue("--worker-x");
    Object.defineProperty(room, "getBoundingClientRect", {
      value: () => ({ left: 0, top: 0, width: 1200, height: 956 }),
    });

    await act(async () => {
      room?.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          clientX: 650,
          clientY: 360,
        }),
      );
    });
    expect(agent?.style.getPropertyValue("--worker-x")).toBe(initialX);
    expect(host.textContent).toContain(
      "Select an agent before choosing a destination.",
    );
    await act(async () => root.unmount());
    host.remove();
  });

  it("returns a surviving agent home when removed rows shrink the room", async () => {
    vi.useFakeTimers();
    const expandedWorkers = Array.from(
      { length: 8 },
      (_, index): TopDownRosterWorker => ({
        ...workers[0],
        taskId: `shrink-${index}`,
        displayName: `Shrink ${index}`,
        status: "idle",
        visualIdentity: index,
        workflowArea: "desk",
      }),
    );
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    try {
      await act(async () => {
        root.render(
          <TopDownOffice
            roomId="shrink-test"
            workers={expandedWorkers}
            selectedTaskId="shrink-0"
            onSelectTask={vi.fn()}
          />,
        );
      });
      const room = host.querySelector<HTMLElement>(
        "[data-topdown-room='true']",
      );
      Object.defineProperty(room, "getBoundingClientRect", {
        value: () => ({ left: 0, top: 0, width: 1200, height: 1760 }),
      });
      await act(async () => {
        room?.dispatchEvent(
          new MouseEvent("click", {
            bubbles: true,
            clientX: 1050,
            clientY: 900,
          }),
        );
        vi.advanceTimersByTime(15_000);
      });

      await act(async () => {
        root.render(
          <TopDownOffice
            roomId="shrink-test"
            workers={expandedWorkers.slice(0, 1)}
            selectedTaskId="shrink-0"
            onSelectTask={vi.fn()}
          />,
        );
      });
      const survivingAgent = host.querySelector<HTMLElement>(
        "[data-assigned-desk='0']",
      );
      expect(
        Number.parseFloat(
          survivingAgent?.style.getPropertyValue("--worker-y") ?? "0",
        ),
      ).toBeLessThanOrEqual(956);
      expect(host.querySelector("[data-world-height='956']")).not.toBeNull();
    } finally {
      await act(async () => root.unmount());
      host.remove();
      vi.useRealTimers();
    }
  });

  it("compacts a high-slot survivor into its new sole desk", async () => {
    vi.useFakeTimers();
    const expandedWorkers = Array.from(
      { length: 8 },
      (_, index): TopDownRosterWorker => ({
        ...workers[0],
        taskId: `compact-${index}`,
        displayName: `Compact ${index}`,
        status: "idle",
        visualIdentity: index,
      }),
    );
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    try {
      await act(async () => {
        root.render(
          <TopDownOffice
            roomId="compact-high-survivor-test"
            workers={expandedWorkers}
            selectedTaskId="compact-7"
            onSelectTask={vi.fn()}
          />,
        );
        vi.advanceTimersByTime(5_000);
      });

      await act(async () => {
        root.render(
          <TopDownOffice
            roomId="compact-high-survivor-test"
            workers={[expandedWorkers[7]]}
            selectedTaskId="compact-7"
            onSelectTask={vi.fn()}
          />,
        );
      });
      await act(async () => {
        vi.advanceTimersByTime(5_000);
      });

      const survivingAgent = host.querySelector<HTMLElement>(
        "[data-assigned-desk='0']",
      );
      expect(host.querySelectorAll("[data-desk-state]")).toHaveLength(1);
      expect(host.querySelector("[data-world-height='956']")).not.toBeNull();
      expect(survivingAgent?.style.getPropertyValue("--worker-x")).toBe(
        "250px",
      );
      expect(survivingAgent?.style.getPropertyValue("--worker-y")).toBe(
        "285px",
      );
      expect(survivingAgent?.dataset.atDesk).toBe("0");
      expect(survivingAgent?.dataset.motionPhase).toBe("seated");
    } finally {
      await act(async () => root.unmount());
      host.remove();
      vi.useRealTimers();
    }
  });

  it("returns a surviving agent home when a room shrink moves furniture over its position", async () => {
    vi.useFakeTimers();
    const expandedWorkers = Array.from(
      { length: 8 },
      (_, index): TopDownRosterWorker => ({
        ...workers[0],
        taskId: `covered-${index}`,
        displayName: `Covered ${index}`,
        status: "idle",
        visualIdentity: index,
      }),
    );
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    try {
      await act(async () => {
        root.render(
          <TopDownOffice
            roomId="covered-after-shrink-test"
            workers={expandedWorkers}
            selectedTaskId="covered-0"
            onSelectTask={vi.fn()}
          />,
        );
      });
      const room = host.querySelector<HTMLElement>(
        "[data-topdown-room='true']",
      );
      Object.defineProperty(room, "getBoundingClientRect", {
        value: () => ({ left: 0, top: 0, width: 1200, height: 1760 }),
      });
      await act(async () => {
        room?.dispatchEvent(
          new MouseEvent("click", {
            bubbles: true,
            clientX: 395,
            clientY: 746,
          }),
        );
        vi.advanceTimersByTime(15_000);
      });

      let survivingAgent = host.querySelector<HTMLElement>(
        "[data-assigned-desk='0']",
      );
      expect(
        Number.parseFloat(
          survivingAgent?.style.getPropertyValue("--worker-x") ?? "0",
        ),
      ).toBeCloseTo(395);
      expect(
        Number.parseFloat(
          survivingAgent?.style.getPropertyValue("--worker-y") ?? "0",
        ),
      ).toBeCloseTo(746);

      await act(async () => {
        root.render(
          <TopDownOffice
            roomId="covered-after-shrink-test"
            workers={expandedWorkers.slice(0, 4)}
            selectedTaskId="covered-0"
            onSelectTask={vi.fn()}
          />,
        );
      });
      await act(async () => {
        vi.advanceTimersByTime(5_000);
      });

      survivingAgent = host.querySelector<HTMLElement>(
        "[data-assigned-desk='0']",
      );
      expect(host.querySelector("[data-world-height='1296']")).not.toBeNull();
      expect(survivingAgent?.style.getPropertyValue("--worker-x")).toBe(
        "250px",
      );
      expect(survivingAgent?.style.getPropertyValue("--worker-y")).toBe(
        "285px",
      );
      expect(survivingAgent?.getAttribute("data-at-desk")).toBe("0");
    } finally {
      await act(async () => root.unmount());
      host.remove();
      vi.useRealTimers();
    }
  });

  it("renders every worker with a dedicated desk beyond the old six-agent cap", () => {
    const expandedWorkers = Array.from(
      { length: 8 },
      (_, index): TopDownRosterWorker => ({
        taskId: `agent-${index + 1}`,
        displayName: `Agent ${index + 1}`,
        status: index === 7 ? "completed" : "idle",
        attention: false,
        stale: false,
        visualIdentity: index,
        workflowArea: "desk",
      }),
    );
    const markup = renderToStaticMarkup(
      <TopDownOffice
        workers={expandedWorkers}
        selectedTaskId={null}
        onSelectTask={vi.fn()}
      />,
    );

    expect(markup.match(/data-desk-state="assigned"/g)).toHaveLength(8);
    expect(markup.match(/data-assigned-desk="/g)).toHaveLength(8);
    expect(markup).toContain("Desk 08, assigned to Agent 8");
    expect(markup).toContain('data-world-height="1760"');
    expect(markup).toContain("Agent 8, completed");
    expect(markup).toContain('data-motion-phase="completed"');
  });

  it("routes reliable Attention assignments into named workflow areas and back to desks", async () => {
    vi.useFakeTimers();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const assignedWorkers: TopDownRosterWorker[] = [
      {
        ...workers[0],
        status: "waiting_for_user",
        attention: true,
        workflowArea: "meeting",
      },
      {
        ...workers[1],
        status: "completed",
        attention: true,
        workflowArea: "meeting",
      },
    ];

    try {
      await act(async () => {
        root.render(
          <TopDownOffice
            workers={assignedWorkers}
            selectedTaskId="agent-1"
            onSelectTask={vi.fn()}
          />,
        );
      });
      await act(async () => vi.advanceTimersByTime(20_000));
      const agents = Array.from(
        host.querySelectorAll<HTMLElement>("[data-desired-area='meeting']"),
      );
      expect(agents).toHaveLength(2);
      expect(
        agents.every((agent) => agent.dataset.settledArea === "meeting"),
      ).toBe(true);
      expect(agents[0].style.getPropertyValue("--worker-x")).not.toBe(
        agents[1].style.getPropertyValue("--worker-x"),
      );
      expect(
        host
          .querySelector("[data-workflow-area='meeting']")
          ?.getAttribute("aria-label"),
      ).toContain("2 assigned agents");

      await act(async () => {
        root.render(
          <TopDownOffice
            workers={assignedWorkers.map((worker) => ({
              ...worker,
              attention: false,
              status: "idle",
              workflowArea: "desk",
            }))}
            selectedTaskId="agent-1"
            onSelectTask={vi.fn()}
          />,
        );
      });
      await act(async () => vi.advanceTimersByTime(20_000));
      expect(
        Array.from(host.querySelectorAll<HTMLElement>("[data-at-desk]")).map(
          (agent) => agent.dataset.settledArea,
        ),
      ).toEqual(["desk", "desk"]);
    } finally {
      await act(async () => root.unmount());
      host.remove();
      vi.useRealTimers();
    }
  });

  it("pins evidence-assigned agents and reserves workflow rugs from manual movement", async () => {
    vi.useFakeTimers();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const assigned = { ...workers[0], workflowArea: "review" as const };
    try {
      await act(async () => {
        root.render(
          <TopDownOffice
            workers={[assigned]}
            selectedTaskId={assigned.taskId}
            onSelectTask={vi.fn()}
          />,
        );
      });
      await act(async () => vi.advanceTimersByTime(10_000));
      const agent = host.querySelector<HTMLElement>(
        "[data-assigned-desk='0']",
      )!;
      const settledX = agent.style.getPropertyValue("--worker-x");
      const room = host.querySelector<HTMLElement>("[data-topdown-room]")!;
      Object.defineProperty(room, "getBoundingClientRect", {
        value: () => ({ left: 0, top: 0, width: 1200, height: 956 }),
      });
      await act(async () => {
        room.dispatchEvent(
          new MouseEvent("click", {
            bubbles: true,
            clientX: 500,
            clientY: 500,
          }),
        );
      });
      expect(agent.style.getPropertyValue("--worker-x")).toBe(settledX);
      expect(host.textContent).toContain(
        "assigned to the review area by current, reliable workflow evidence",
      );

      const reviewArea = host.querySelector<HTMLElement>(
        "[data-workflow-area='review']",
      )!;
      await act(async () => {
        reviewArea.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      expect(agent.style.getPropertyValue("--worker-x")).toBe(settledX);
      expect(host.textContent).toContain(
        "Shared workflow areas are assigned from Current Attention evidence.",
      );

      const desk = host.querySelector<HTMLElement>(
        "[aria-label='Desk 01, assigned to Mina']",
      )!;
      await act(async () => {
        desk.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      expect(agent.style.getPropertyValue("--worker-x")).toBe(settledX);
      expect(host.textContent).toContain(
        "assigned to the review area by current, reliable workflow evidence",
      );
    } finally {
      await act(async () => root.unmount());
      host.remove();
      vi.useRealTimers();
    }
  });

  it("renders amenity footprints from the same world rectangles used by collision", () => {
    const markup = renderToStaticMarkup(
      <TopDownOffice
        workers={workers}
        selectedTaskId={null}
        onSelectTask={vi.fn()}
      />,
    );
    expect(markup).toContain(
      "--area-x:72px;--area-y:438px;--area-width:294px;--area-height:176px",
    );
    expect(markup).toContain(
      "--area-x:1028px;--area-y:70px;--area-width:132px;--area-height:176px",
    );
    expect(markup).toContain(
      "--area-x:532px;--area-y:600px;--area-width:150px;--area-height:50px",
    );
  });
});
