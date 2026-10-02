import { describe, expect, it } from "vitest";

import {
  createEmptyCofficeWorkspace,
  parseSerializedCofficeWorkspace,
  parseWorkspaceMutation,
  reduceCofficeWorkspace,
  serializeWorkspaceMutation,
  type ProjectQualityBar,
  type VerificationReceipt,
  type VerificationState,
  type VerificationTarget,
  type WorkspaceProject,
} from "../src/lib/coffice-workspace";
import { projectQualityBarReadiness } from "../src/lib/project-quality-bars";

const NOW = "2026-08-18T14:00:00.000Z";
const LATER = "2026-08-18T14:01:00.000Z";
const THIRD = "2026-08-18T14:02:00.000Z";

const BARS: ProjectQualityBar[] = [
  { profileId: "test", profileVersion: "1" },
  { profileId: "typecheck", profileVersion: "1" },
];

const TARGET: VerificationTarget = {
  projectId: "project-1",
  objectiveId: "objective-1",
  workItemId: "work-1",
  attemptId: "attempt-1",
  resultKey: { kind: "turn", id: "result-1" },
};

function project(qualityBars?: ProjectQualityBar[]): WorkspaceProject {
  return {
    id: TARGET.projectId,
    title: "Coffice",
    ...(qualityBars ? { qualityBars } : {}),
    createdAt: NOW,
    updatedAt: NOW,
    objectives: [
      {
        id: TARGET.objectiveId,
        title: "Ship",
        status: "active",
        createdAt: NOW,
        updatedAt: NOW,
        workItems: [
          {
            id: TARGET.workItemId,
            title: "Verify",
            expectedOutcome: "A trustworthy result",
            status: "ready_for_review",
            createdAt: NOW,
            updatedAt: NOW,
            attempts: [
              {
                id: TARGET.attemptId,
                codexTaskId: "task-1",
                relationship: "primary",
                linkedAt: NOW,
                resultCycles: [{ key: TARGET.resultKey, observedAt: NOW }],
              },
            ],
          },
        ],
      },
    ],
  };
}

function seeded(qualityBars?: ProjectQualityBar[]) {
  return reduceCofficeWorkspace(
    createEmptyCofficeWorkspace(NOW),
    { type: "project.upsert", project: project(qualityBars) },
    NOW,
  );
}

function setBars(qualityBars: ProjectQualityBar[]) {
  return {
    type: "project.qualityBars.set" as const,
    projectId: TARGET.projectId,
    qualityBars,
  };
}

function receipt(
  profileId: ProjectQualityBar["profileId"],
  state: VerificationState,
  fields: {
    id?: string;
    target?: VerificationTarget;
    profileVersion?: string;
    at?: string;
  } = {},
): VerificationReceipt {
  const at = fields.at ?? LATER;
  return {
    id: fields.id ?? `${profileId}-${state}`,
    idempotencyKey: `request-${fields.id ?? `${profileId}-${state}`}`,
    requestHash: "a".repeat(64),
    target: fields.target ?? TARGET,
    profile: {
      id: profileId,
      version: fields.profileVersion ?? "1",
    },
    checks: [
      {
        id: profileId,
        version: fields.profileVersion ?? "1",
        state,
        queuedAt: at,
        ...(state === "queued" ? {} : { startedAt: at }),
        ...(state === "passed" || state === "unknown"
          ? { completedAt: at }
          : {}),
        ...(state === "failed"
          ? { completedAt: at, failureKind: "exit" as const, exitCode: 1 }
          : {}),
      },
    ],
    state,
    queuedAt: at,
    ...(state === "queued" ? {} : { startedAt: at }),
    ...(state === "passed" || state === "failed" || state === "unknown"
      ? { completedAt: at }
      : {}),
  };
}

describe("project quality bars", () => {
  it("stores canonical fixed profiles and clears them through a dedicated intent", () => {
    const set = reduceCofficeWorkspace(seeded(), setBars(BARS), LATER);
    expect(set.projects[0]).toMatchObject({
      qualityBars: BARS,
      updatedAt: LATER,
      objectives: [{ workItems: [{ status: "ready_for_review" }] }],
    });
    const cleared = reduceCofficeWorkspace(set, setBars([]), THIRD);
    expect(cleared.projects[0].qualityBars).toBeUndefined();
    expect(
      cleared.projects[0].objectives[0].workItems[0].attempts,
    ).toHaveLength(1);
  });

  it("rejects unknown versions, duplicates, and noncanonical order atomically", () => {
    const base = seeded(BARS);
    for (const qualityBars of [
      [{ profileId: "unknown", profileVersion: "1" }],
      [{ profileId: "test", profileVersion: "2" }],
      [BARS[0], BARS[0]],
      [BARS[1], BARS[0]],
    ]) {
      expect(() =>
        reduceCofficeWorkspace(
          base,
          setBars(qualityBars as ProjectQualityBar[]),
          LATER,
        ),
      ).toThrow();
      expect(base.projects[0].qualityBars).toEqual(BARS);
    }
  });

  it("migrates v1-v7 with bars absent and rejects backported fields", () => {
    for (const version of [1, 2, 3, 4, 5, 6, 7]) {
      const legacy = structuredClone(seeded()) as unknown as Record<
        string,
        unknown
      >;
      legacy.schemaVersion = version;
      delete legacy.decisionRequests;
      if (version === 1) delete legacy.verificationReceipts;
      if (version < 4) delete legacy.reviewAssessments;
      if (version < 5) delete legacy.projectDecisionEvents;
      const parsed = parseSerializedCofficeWorkspace(JSON.stringify(legacy));
      expect(parsed.schemaVersion).toBe(12);
      expect(parsed.projects[0].qualityBars).toBeUndefined();

      const injected = structuredClone(legacy) as unknown as {
        projects: Array<Record<string, unknown>>;
      };
      injected.projects[0].qualityBars = BARS;
      expect(() =>
        parseSerializedCofficeWorkspace(JSON.stringify(injected)),
      ).toThrow(/unknown field qualityBars/);
    }
  });

  it("seeds bars on a new project and protects current bars from stale upserts", () => {
    const first = reduceCofficeWorkspace(
      createEmptyCofficeWorkspace(NOW),
      {
        type: "project.upsert",
        project: {
          id: "empty-project",
          title: "Empty",
          qualityBars: BARS,
          createdAt: NOW,
          updatedAt: NOW,
          objectives: [],
        },
      },
      NOW,
    );
    expect(first.projects[0]).toMatchObject({
      qualityBars: BARS,
      objectives: [],
    });

    const stale = project([{ profileId: "build", profileVersion: "1" }]);
    stale.title = "Renamed";
    const updated = reduceCofficeWorkspace(
      seeded(BARS),
      { type: "project.upsert", project: stale },
      LATER,
    );
    expect(updated.projects[0]).toMatchObject({
      title: "Renamed",
      qualityBars: BARS,
    });

    const absent = reduceCofficeWorkspace(
      seeded(),
      { type: "project.upsert", project: stale },
      LATER,
    );
    expect(absent.projects[0].qualityBars).toBeUndefined();
  });

  it("preserves unrelated concurrent work and serializes intents deterministically", () => {
    const concurrent = reduceCofficeWorkspace(
      seeded(),
      {
        type: "workItem.upsert",
        projectId: TARGET.projectId,
        objectiveId: TARGET.objectiveId,
        workItem: {
          ...project().objectives[0].workItems[0],
          status: "accepted",
        },
      },
      LATER,
    );
    const updated = reduceCofficeWorkspace(concurrent, setBars(BARS), THIRD);
    expect(updated.projects[0]).toMatchObject({
      qualityBars: BARS,
      objectives: [{ workItems: [{ status: "accepted" }] }],
    });
    expect(serializeWorkspaceMutation(setBars(BARS))).toBe(
      serializeWorkspaceMutation(parseWorkspaceMutation(setBars(BARS))),
    );
  });

  it("projects exact-result readiness without gating user authority", () => {
    expect(projectQualityBarReadiness(project(), TARGET, [])).toEqual({
      state: "not_configured",
      bars: [],
    });

    const ready = projectQualityBarReadiness(project(BARS), TARGET, [
      receipt("test", "passed"),
      receipt("typecheck", "passed"),
    ]);
    expect(ready.state).toBe("ready");
    expect(ready.bars.map(({ label, state }) => ({ label, state }))).toEqual([
      { label: "Tests", state: "passed" },
      { label: "Type check", state: "passed" },
    ]);

    expect(
      projectQualityBarReadiness(project(BARS), TARGET, [
        receipt("test", "passed"),
      ]).state,
    ).toBe("unknown");
    expect(
      projectQualityBarReadiness(project(BARS), TARGET, [
        receipt("test", "failed"),
        receipt("typecheck", "running"),
      ]).state,
    ).toBe("not_ready");
  });

  it("uses the final retained exact receipt and ignores other targets and versions", () => {
    const otherTarget = {
      ...TARGET,
      resultKey: { kind: "turn" as const, id: "other-result" },
    };
    const readiness = projectQualityBarReadiness(project(BARS), TARGET, [
      receipt("test", "failed", { id: "old", at: LATER }),
      receipt("test", "passed", { id: "other", target: otherTarget }),
      receipt("test", "passed", { id: "wrong-version", profileVersion: "2" }),
      receipt("test", "passed", { id: "new", at: THIRD }),
      receipt("typecheck", "unknown", { id: "unknown", at: THIRD }),
    ]);
    expect(readiness.state).toBe("unknown");
    expect(readiness.bars).toMatchObject([
      { state: "passed", recordedAt: THIRD },
      { state: "unknown", recordedAt: THIRD },
    ]);
  });
});
