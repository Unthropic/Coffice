import { readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const failure = vi.hoisted(() => ({ nextTemporaryWrite: false }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    open: async (...args: unknown[]) => {
      const handle = (await Reflect.apply(
        actual.open,
        undefined,
        args,
      )) as Awaited<ReturnType<typeof actual.open>>;
      if (!failure.nextTemporaryWrite || args[1] !== "wx") return handle;
      failure.nextTemporaryWrite = false;
      return new Proxy(handle, {
        get(target, property, receiver) {
          if (property === "writeFile") {
            return async () => {
              throw new Error("simulated workspace write failure");
            };
          }
          const value = Reflect.get(target, property, receiver);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    },
  };
});

import { CofficeWorkspaceStore } from "../src/lib/coffice-workspace-store";

const roots: string[] = [];

afterEach(async () => {
  failure.nextTemporaryWrite = false;
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Coffice workspace atomic-write cleanup", () => {
  it("removes a temporary file when writing it fails", async () => {
    const directory = path.join(
      os.tmpdir(),
      `coffice-store-failure-${process.pid}-${Date.now()}`,
    );
    roots.push(directory);
    const store = new CofficeWorkspaceStore({ directory });
    failure.nextTemporaryWrite = true;

    await expect(store.load()).rejects.toThrow(
      "simulated workspace write failure",
    );
    expect(
      (await readdir(directory)).filter((name) => name.endsWith(".tmp")),
    ).toEqual([]);
  });

  it("leaves no receipt or temporary file after a verification write fails", async () => {
    const directory = path.join(
      os.tmpdir(),
      `coffice-store-verification-failure-${process.pid}-${Date.now()}`,
    );
    roots.push(directory);
    const now = "2026-08-11T12:00:00.000Z";
    const store = new CofficeWorkspaceStore({ directory, now: () => now });
    await store.load();
    await store.mutate(0, "seed", {
      type: "project.upsert",
      project: {
        id: "project",
        title: "Project",
        createdAt: now,
        updatedAt: now,
        objectives: [
          {
            id: "objective",
            title: "Objective",
            status: "active",
            createdAt: now,
            updatedAt: now,
            workItems: [
              {
                id: "work",
                title: "Work",
                expectedOutcome: "Verified",
                status: "ready_for_review",
                createdAt: now,
                updatedAt: now,
                attempts: [
                  {
                    id: "attempt",
                    codexTaskId: "task",
                    relationship: "primary",
                    linkedAt: now,
                    resultCycles: [
                      {
                        key: { kind: "turn", id: "result" },
                        observedAt: now,
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    });
    failure.nextTemporaryWrite = true;
    await expect(
      store.startVerification({
        id: "verification",
        idempotencyKey: "verification-request",
        target: {
          projectId: "project",
          objectiveId: "objective",
          workItemId: "work",
          attemptId: "attempt",
          resultKey: { kind: "turn", id: "result" },
        },
        profile: { id: "focused", version: "1" },
        checks: [{ id: "unit", version: "1" }],
      }),
    ).rejects.toThrow("simulated workspace write failure");
    expect(
      (await readdir(directory)).filter((name) => name.endsWith(".tmp")),
    ).toEqual([]);
    expect((await store.load()).workspace.verificationReceipts).toEqual([]);
  });

  it("leaves no assessment or mutation receipt after its write fails", async () => {
    const directory = path.join(
      os.tmpdir(),
      `coffice-store-assessment-failure-${process.pid}-${Date.now()}`,
    );
    roots.push(directory);
    const now = "2026-08-11T12:00:00.000Z";
    const store = new CofficeWorkspaceStore({ directory, now: () => now });
    await store.load();
    await store.mutate(0, "seed", {
      type: "project.upsert",
      project: {
        id: "project",
        title: "Project",
        createdAt: now,
        updatedAt: now,
        objectives: [
          {
            id: "objective",
            title: "Objective",
            status: "active",
            createdAt: now,
            updatedAt: now,
            workItems: [
              {
                id: "work",
                title: "Work",
                expectedOutcome: "A reviewable plan.",
                status: "planned",
                createdAt: now,
                updatedAt: now,
                attempts: [],
              },
            ],
          },
        ],
      },
    });
    failure.nextTemporaryWrite = true;
    await expect(
      store.mutate(1, "assessment-set", {
        type: "assessment.set",
        assessment: {
          target: {
            projectId: "project",
            objectiveId: "objective",
            workItemId: "work",
          },
          reviewSummary: "Keep this only after a durable write.",
          risks: [],
          uncertainties: [],
          blockedDecisions: [],
        },
      }),
    ).rejects.toThrow("simulated workspace write failure");
    expect(
      (await readdir(directory)).filter((name) => name.endsWith(".tmp")),
    ).toEqual([]);
    const reloaded = (await store.load()).workspace;
    expect(reloaded.reviewAssessments).toEqual([]);
    expect(reloaded.mutationReceipts.map((receipt) => receipt.id)).toEqual([
      "seed",
    ]);
  });

  it("leaves no project decision event or receipt after its write fails", async () => {
    const directory = path.join(
      os.tmpdir(),
      `coffice-store-decision-failure-${process.pid}-${Date.now()}`,
    );
    roots.push(directory);
    const now = "2026-08-11T12:00:00.000Z";
    const store = new CofficeWorkspaceStore({ directory, now: () => now });
    await store.load();
    await store.mutate(0, "seed", {
      type: "project.upsert",
      project: {
        id: "project",
        title: "Project",
        createdAt: now,
        updatedAt: now,
        objectives: [],
      },
    });
    failure.nextTemporaryWrite = true;
    await expect(
      store.mutate(1, "decision-record", {
        type: "projectDecision.record",
        id: "decision-event",
        projectId: "project",
        statement: "Persist this only when the atomic write succeeds.",
      }),
    ).rejects.toThrow("simulated workspace write failure");
    expect(
      (await readdir(directory)).filter((name) => name.endsWith(".tmp")),
    ).toEqual([]);
    const reloaded = (await store.load()).workspace;
    expect(reloaded.projectDecisionEvents).toEqual([]);
    expect(reloaded.mutationReceipts.map((receipt) => receipt.id)).toEqual([
      "seed",
    ]);
  });
});
