import { describe, expect, it } from "vitest";

import {
  authoritativeBlockedStatus,
  reduceSessionStatus,
} from "../src/lib/status";

const now = new Date("2026-07-13T12:00:00Z");

describe("reduceSessionStatus", () => {
  it("keeps authoritative blocked goal state distinct from inferred activity", () => {
    expect(authoritativeBlockedStatus("2026-07-13T11:59:45.000Z")).toEqual({
      value: "blocked",
      provenance: "observed",
      source: "codex-app-server:thread/goal/get",
      timestamp: "2026-07-13T11:59:45.000Z",
      stale: false,
      confidence: 1,
    });
  });

  it("uses the latest directly observed supported event", () => {
    const status = reduceSessionStatus(
      [
        { type: "task_started", timestamp: "2026-07-13T11:59:00Z" },
        { type: "agent_reasoning", timestamp: "2026-07-13T11:59:30Z" },
      ],
      { now },
    );

    expect(status).toMatchObject({
      value: "thinking",
      provenance: "observed",
      source: "session-jsonl:event_msg.agent_reasoning",
      stale: false,
    });
  });

  it("uses starting only briefly, then preserves generic observed activity", () => {
    expect(
      reduceSessionStatus(
        [{ type: "task_started", timestamp: "2026-07-13T11:59:50Z" }],
        { now },
      ),
    ).toMatchObject({
      value: "starting",
      provenance: "observed",
      stale: false,
    });

    expect(
      reduceSessionStatus(
        [{ type: "task_started", timestamp: "2026-07-13T11:59:00Z" }],
        { now },
      ),
    ).toMatchObject({
      value: "active",
      provenance: "observed",
      stale: false,
    });
  });

  it.each([
    ["user_message", "queued"],
    ["plan_update", "planning"],
    ["web_search_begin", "researching"],
    ["web_search_end", "active"],
    ["image_generation_begin", "running"],
    ["image_generation_end", "active"],
    ["mcp_tool_call_begin", "running"],
    ["mcp_tool_call_end", "active"],
    ["exec_command_begin", "running"],
    ["exec_command_end", "active"],
    ["patch_apply_begin", "coding"],
    ["patch_apply_end", "active"],
    ["entered_review_mode", "reviewing"],
    ["exited_review_mode", "active"],
    ["request_user_input", "waiting_for_user"],
    ["exec_approval_request", "waiting_for_user"],
    ["apply_patch_approval_request", "waiting_for_user"],
    ["request_permissions", "waiting_for_user"],
    ["elicitation_request", "waiting_for_user"],
    ["error", "failed"],
  ] as const)("maps structural %s evidence to %s", (type, value) => {
    expect(
      reduceSessionStatus([{ type, timestamp: "2026-07-13T11:59:30Z" }], {
        now,
      }),
    ).toMatchObject({ value, provenance: "observed", stale: false });
  });

  it("does not let protocol non-status errors replace the prior turn state", () => {
    expect(
      reduceSessionStatus(
        [
          { type: "agent_reasoning", timestamp: "2026-07-13T11:59:20Z" },
          {
            type: "error",
            timestamp: "2026-07-13T11:59:30Z",
            affectsTurnStatus: false,
          },
        ],
        { now },
      ),
    ).toMatchObject({
      value: "thinking",
      provenance: "observed",
      timestamp: "2026-07-13T11:59:20.000Z",
    });
  });

  it("maps unsuccessful completion to failed even for persistent staff", () => {
    expect(
      reduceSessionStatus(
        [
          {
            type: "turn_complete",
            timestamp: "2026-07-13T11:00:00Z",
            affectsTurnStatus: true,
          },
        ],
        { now, persistentStaff: true },
      ),
    ).toMatchObject({
      value: "failed",
      provenance: "observed",
      stale: false,
    });
  });

  it("marks old nonterminal observations stale without inventing a new state", () => {
    const status = reduceSessionStatus(
      [{ type: "agent_reasoning", timestamp: "2026-07-13T11:00:00Z" }],
      { now },
    );

    expect(status.value).toBe("thinking");
    expect(status.provenance).toBe("observed");
    expect(status.stale).toBe(true);
  });

  it("keeps an unresolved request current until a later structural event supersedes it", () => {
    const waiting = reduceSessionStatus(
      [{ type: "request_user_input", timestamp: "2026-07-13T11:00:00Z" }],
      { now },
    );

    expect(waiting).toMatchObject({
      value: "waiting_for_user",
      provenance: "observed",
      stale: false,
    });

    expect(
      reduceSessionStatus(
        [
          { type: "request_user_input", timestamp: "2026-07-13T11:00:00Z" },
          { type: "user_message", timestamp: "2026-07-13T11:59:30Z" },
        ],
        { now },
      ),
    ).toMatchObject({ value: "queued", stale: false });
  });

  it("falls back to inferred idle when no fine-grained evidence exists", () => {
    const status = reduceSessionStatus([], {
      now,
      fallbackTimestamp: "2026-07-13T11:59:30Z",
    });

    expect(status).toMatchObject({
      value: "idle",
      provenance: "inferred",
      source: "session-index:last-updated",
      stale: false,
    });
  });

  it("reports an unavailable source as observed offline", () => {
    expect(
      reduceSessionStatus([], { now, sourceAvailable: false }),
    ).toMatchObject({
      value: "offline",
      provenance: "observed",
      stale: true,
    });
  });

  it("keeps terminal states fresh", () => {
    expect(
      reduceSessionStatus(
        [{ type: "task_complete", timestamp: "2026-07-01T11:00:00Z" }],
        { now },
      ),
    ).toMatchObject({
      value: "completed",
      provenance: "observed",
      stale: false,
    });
  });

  it("preserves a brief authoritative completion pulse for persistent staff", () => {
    expect(
      reduceSessionStatus(
        [{ type: "task_complete", timestamp: "2026-07-13T11:59:30Z" }],
        { now, persistentStaff: true },
      ),
    ).toMatchObject({
      value: "completed",
      provenance: "observed",
      source: "session-jsonl:event_msg.task_complete",
      stale: false,
    });
  });

  it("returns persistent staff to inferred idle after the completion pulse", () => {
    expect(
      reduceSessionStatus(
        [{ type: "task_complete", timestamp: "2026-07-13T11:58:30Z" }],
        { now, persistentStaff: true },
      ),
    ).toMatchObject({
      value: "idle",
      provenance: "inferred",
      source: "session-jsonl:event_msg.task_complete",
      stale: false,
    });
  });

  it("marks old inferred staff idle evidence stale", () => {
    expect(
      reduceSessionStatus(
        [{ type: "task_complete", timestamp: "2026-07-13T11:00:00Z" }],
        { now, persistentStaff: true },
      ),
    ).toMatchObject({
      value: "idle",
      provenance: "inferred",
      stale: true,
    });
  });

  it("does not misclassify an interrupted turn as failure", () => {
    expect(
      reduceSessionStatus(
        [{ type: "turn_aborted", timestamp: "2026-07-13T11:59:00Z" }],
        { now },
      ),
    ).toMatchObject({
      value: "idle",
      provenance: "inferred",
      source: "session-jsonl:event_msg.turn_aborted",
      stale: true,
    });
  });
});
