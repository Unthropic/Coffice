import { describe, expect, it } from "vitest";
import {
  decodeCompanionSnapshot,
  retainCompanionDeskOrder,
} from "../src/components/use-companion-feed";

describe("companion feed decoding", () => {
  it("keeps existing desks stable while appending newcomers and removing departed tasks", () => {
    const snapshot = (ids: string[]) =>
      decodeCompanionSnapshot({
        source: {
          freshness: "fresh",
          refreshState: "fresh",
          health: "connected",
        },
        projects: [{ id: "garden", name: "Garden" }],
        tasks: ids.map((id) => ({
          id,
          title: id,
          projectId: "garden",
          status: { value: "active", stale: false },
        })),
      });
    const previous = snapshot(["one", "two", "departed"]);
    const next = snapshot(["new", "two", "one"]);
    next.projects[0]!.tasks.find((task) => task.id === "one")!.title =
      "Updated title";
    const retained = retainCompanionDeskOrder(previous, next);
    expect(retained.projects[0]?.tasks.map((task) => task.id)).toEqual([
      "one",
      "two",
      "new",
    ]);
    expect(retained.projects[0]?.tasks[0]?.title).toBe("Updated title");
    expect(next.projects[0]?.tasks.map((task) => task.id)).toEqual([
      "new",
      "two",
      "one",
    ]);
  });

  it("keeps project membership exact and gives unassigned tasks a common room", () => {
    const snapshot = decodeCompanionSnapshot({
      generatedAt: "2026-10-02T16:00:00.000Z",
      source: {
        freshness: "fresh",
        refreshState: "fresh",
        health: "connected",
      },
      projects: [{ id: "garden", name: "Garden" }],
      tasks: [
        {
          id: "one",
          title: "Plant things",
          projectId: "garden",
          status: { value: "active", stale: false, provenance: "observed" },
        },
        {
          id: "two",
          title: "Have a thought",
          projectId: null,
          status: { value: "idle", stale: true, provenance: "inferred" },
        },
      ],
    });
    expect(
      snapshot.projects.map((project) => [
        project.id,
        project.tasks.map((task) => task.id),
      ]),
    ).toEqual([
      ["garden", ["one"]],
      ["__unassigned__", ["two"]],
    ]);
    expect(snapshot.projects[0]?.tasks[0]?.status.evidence).toBe("observed");
    expect(snapshot.projects[1]?.tasks[0]?.status.evidence).toBe("inferred");
  });

  it("never invents a status or silently marks disconnected evidence fresh", () => {
    const snapshot = decodeCompanionSnapshot({
      source: { freshness: "fresh", health: "disconnected" },
      projects: [{ id: "garden", name: "Garden" }],
      tasks: [
        {
          id: "unknown",
          title: "Unknown status",
          projectId: "garden",
          status: { value: "magic" },
        },
        {
          id: "known",
          title: "Known status",
          projectId: "garden",
          status: { value: "active" },
        },
      ],
    });
    expect(snapshot.sourceFreshness).toBe("stale");
    expect(snapshot.refreshState).toBe("failed");
    expect(snapshot.projects[0]?.tasks).toHaveLength(1);
    expect(snapshot.projects[0]?.tasks[0]?.status.stale).toBe(true);
  });

  it("rejects unsupported envelope shapes", () => {
    expect(() => decodeCompanionSnapshot({ projects: [], tasks: [] })).toThrow(
      "Unrecognized",
    );
  });
});
