// @vitest-environment happy-dom

import { StrictMode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  type AttentionTransitionCueController,
  useAttentionTransitionCue,
} from "../src/components/use-attention-transition-cue";
import type {
  AttentionDisposition,
  AttentionItem,
} from "../src/lib/attention-inbox";

function item(eventKey: string): AttentionItem {
  return {
    eventKey,
    kind: "ready_for_review",
    priority: 3,
    projectId: "project-a",
    projectName: "Project A",
    taskId: `task-${eventKey}`,
    openTaskId: `task-${eventKey}`,
    taskTitle: `Task ${eventKey}`,
    occurredAt: "2026-08-12T08:00:00.000Z",
    status: "completed",
    evidence: "observed",
    stale: false,
    reason: "A new completed result is ready for review.",
    recommendedAction: "Review the result in Codex",
  };
}

function Harness({
  admissionReady,
  items,
  dispositionFor,
  onController,
}: {
  admissionReady: boolean;
  items: readonly AttentionItem[];
  dispositionFor: (eventKey: string) => AttentionDisposition | undefined;
  onController: (controller: AttentionTransitionCueController) => void;
}) {
  onController(
    useAttentionTransitionCue({ admissionReady, items, dispositionFor }),
  );
  return null;
}

describe("useAttentionTransitionCue", () => {
  let container: HTMLDivElement;
  let root: Root;
  let controller: AttentionTransitionCueController | null;
  let dispositions: Record<string, AttentionDisposition>;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    controller = null;
    dispositions = {};
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  async function render(
    items: readonly AttentionItem[],
    admissionReady = true,
  ) {
    await act(async () => {
      root.render(
        <StrictMode>
          <Harness
            admissionReady={admissionReady}
            items={items}
            dispositionFor={(eventKey) => dispositions[eventKey]}
            onController={(next) => {
              controller = next;
            }}
          />
        </StrictMode>,
      );
    });
  }

  it("baselines silently, exposes one live batch, and consumes all of it", async () => {
    await render([item("existing")]);
    expect(controller?.item).toBeNull();

    await render([item("first"), item("second"), item("existing")]);
    expect(controller?.item?.eventKey).toBe("first");
    expect(controller?.moreCount).toBe(1);

    await act(async () => controller?.consumeBatch());
    expect(controller?.item).toBeNull();
    expect(controller?.moreCount).toBe(0);

    await render([item("first"), item("second"), item("existing")]);
    expect(controller?.item).toBeNull();
  });

  it("does not consume novelty while non-authoritative and removes seen items", async () => {
    await render([item("baseline")]);
    await render([item("baseline"), item("arrived-during-outage")], false);
    expect(controller?.item).toBeNull();

    await render([item("baseline"), item("arrived-during-outage")]);
    expect(controller?.item?.eventKey).toBe("arrived-during-outage");

    dispositions["arrived-during-outage"] = {
      kind: "needs_review",
      at: "2026-08-12T08:05:00.000Z",
    };
    await render([item("baseline"), item("arrived-during-outage")]);
    expect(controller?.item).toBeNull();
    expect(controller?.moreCount).toBe(0);
  });
});
