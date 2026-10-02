import { describe, expect, it } from "vitest";

import {
  TOP_DOWN_WORLD,
  TOP_DOWN_WORLD_OBSTACLES,
  clientPointToTopDownWorld,
  clampTopDownFloorPoint,
  createTopDownOfficePlan,
  findTopDownWorkflowArea,
  reconcileTopDownDeskAssignments,
  findTopDownObstacle,
  planTopDownRoute,
  resolveTopDownWorldLayout,
  shouldCenterTopDownWorld,
  topDownFacing,
  topDownFloorRestingPhase,
  topDownMotionDuration,
  topDownRestingPhase,
  topDownSegmentHitsObstacle,
  topDownStatusUsesDesk,
  topDownWorldPointToClient,
} from "../src/lib/top-down-office-world";

describe("top-down office world", () => {
  it("uses one uniform scale and preserves the authored aspect ratio", () => {
    for (const [width, height] of [
      [3440, 900],
      [1200, 650],
      [800, 700],
      [390, 420],
    ]) {
      const layout = resolveTopDownWorldLayout(width, height);
      expect(layout.renderedWidth / TOP_DOWN_WORLD.width).toBe(layout.scale);
      expect(layout.renderedHeight / TOP_DOWN_WORLD.height).toBe(layout.scale);
      expect(layout.renderedWidth / layout.renderedHeight).toBeCloseTo(
        TOP_DOWN_WORLD.width / TOP_DOWN_WORLD.height,
        8,
      );
    }
  });

  it("keeps small viewports scrollable instead of shrinking the world into microtype", () => {
    const layout = resolveTopDownWorldLayout(390, 240);
    expect(layout.scale).toBe(TOP_DOWN_WORLD.minScale);
    expect(layout.renderedWidth).toBeGreaterThan(390);
    expect(layout.renderedHeight).toBeGreaterThan(240);
  });

  it("recenters when a fitted desktop world becomes a pannable mobile world", () => {
    expect(shouldCenterTopDownWorld(false, null, false)).toBe(true);
    expect(shouldCenterTopDownWorld(true, false, true)).toBe(true);
    expect(shouldCenterTopDownWorld(true, true, true)).toBe(false);
    expect(shouldCenterTopDownWorld(true, true, false)).toBe(false);
  });

  it("maps pointer coordinates back into the same logical world", () => {
    expect(
      clientPointToTopDownWorld(
        { x: 350, y: 212.5 },
        { left: 50, top: 50, width: 600, height: 325 },
      ),
    ).toEqual({ x: 600, y: 325 });
  });

  it("clamps floor targets and rejects occupied furniture footprints", () => {
    expect(clampTopDownFloorPoint({ x: -20, y: 900 })).toEqual({
      x: 86,
      y: 880,
    });
    expect(findTopDownObstacle({ x: 200, y: 500 })?.id).toBe("lounge");
    expect(findTopDownObstacle({ x: 600, y: 480 })).toBeNull();
  });

  it("derives movement timing, facing, and truthful status posture", () => {
    expect(topDownMotionDuration({ x: 0, y: 0 }, { x: 10, y: 10 })).toBe(79);
    expect(topDownMotionDuration({ x: 0, y: 0 }, { x: 180, y: 0 })).toBe(1000);
    expect(topDownFacing({ x: 0, y: 0 }, { x: -20, y: 5 })).toBe("west");
    expect(topDownFacing({ x: 0, y: 0 }, { x: 5, y: -20 })).toBe("north");
    expect(topDownFacing({ x: 0, y: 0 }, { x: 20, y: 5 })).toBe("east");
    expect(topDownFacing({ x: 0, y: 0 }, { x: 5, y: 20 })).toBe("south");
    expect(topDownStatusUsesDesk("coding")).toBe(true);
    expect(topDownStatusUsesDesk("completed")).toBe(false);
    expect(topDownRestingPhase("blocked", true, false)).toBe("attention");
    expect(topDownRestingPhase("coding", false, false)).toBe("working");
    expect(topDownRestingPhase("coding", false, true)).toBe("seated");
    expect(topDownRestingPhase("completed", false, false)).toBe("completed");
    expect(topDownFloorRestingPhase(false, false)).toBe("idle");
    expect(topDownFloorRestingPhase(true, false)).toBe("attention");
  });

  it("keeps desk ownership stable across reorder, status churn, and additions", () => {
    const initial = reconcileTopDownDeskAssignments(new Map(), [
      "alpha",
      "beta",
      "gamma",
    ]);
    expect(Object.fromEntries(initial)).toEqual({
      alpha: 0,
      beta: 1,
      gamma: 2,
    });

    const reordered = reconcileTopDownDeskAssignments(initial, [
      "gamma",
      "alpha",
      "beta",
    ]);
    expect(Object.fromEntries(reordered)).toEqual({
      alpha: 0,
      beta: 1,
      gamma: 2,
    });

    const statusOnly = reconcileTopDownDeskAssignments(reordered, [
      "gamma",
      "alpha",
      "beta",
    ]);
    expect(Object.fromEntries(statusOnly)).toEqual({
      alpha: 0,
      beta: 1,
      gamma: 2,
    });

    const added = reconcileTopDownDeskAssignments(statusOnly, [
      "delta",
      "gamma",
      "alpha",
      "beta",
    ]);
    expect(Object.fromEntries(added)).toEqual({
      alpha: 0,
      beta: 1,
      gamma: 2,
      delta: 3,
    });
  });

  it("lets a newcomer fill a released desk without moving survivors", () => {
    const previous = new Map([
      ["alpha", 0],
      ["beta", 1],
      ["gamma", 2],
      ["delta", 3],
    ]);

    const next = reconcileTopDownDeskAssignments(previous, [
      "alpha",
      "gamma",
      "delta",
      "epsilon",
    ]);

    expect(Object.fromEntries(next)).toEqual({
      alpha: 0,
      gamma: 2,
      delta: 3,
      epsilon: 1,
    });
  });

  it("compacts a middle departure by shifting only higher desks", () => {
    const previous = new Map([
      ["alpha", 0],
      ["beta", 1],
      ["gamma", 2],
      ["delta", 3],
    ]);

    const next = reconcileTopDownDeskAssignments(previous, [
      "delta",
      "alpha",
      "gamma",
    ]);

    expect(Object.fromEntries(next)).toEqual({
      alpha: 0,
      gamma: 1,
      delta: 2,
    });
  });

  it("compacts a sole high-slot survivor to the first and only desk", () => {
    const previous = new Map(
      Array.from({ length: 8 }, (_, index) => [`worker-${index}`, index]),
    );

    const next = reconcileTopDownDeskAssignments(previous, ["worker-7"]);

    expect(Object.fromEntries(next)).toEqual({
      "worker-7": 0,
    });
    expect(new Set(next.values())).toEqual(new Set([0]));
  });

  it("plans a clear animated route around furniture footprints", () => {
    const from = { x: 600, y: 520 };
    const target = { x: 90, y: 350 };
    const route = planTopDownRoute(from, target);
    expect(route).not.toBeNull();
    expect(route).toHaveLength(2);

    let segmentStart = from;
    for (const point of route ?? []) {
      expect(
        TOP_DOWN_WORLD_OBSTACLES.some((obstacle) =>
          topDownSegmentHitsObstacle(segmentStart, point, obstacle),
        ),
      ).toBe(false);
      segmentStart = point;
    }

    expect(planTopDownRoute({ x: 600, y: 350 }, { x: 900, y: 400 })).toEqual([
      { x: 900, y: 400 },
    ]);
  });

  it.each([0, 1, 3, 4, 7, 8, 25, 200])(
    "creates one bounded, non-overlapping desk per requested slot: %i",
    (count) => {
      const plan = createTopDownOfficePlan(count);
      expect(plan.desks).toHaveLength(count);
      expect(new Set(plan.desks.map((desk) => desk.rect.id)).size).toBe(count);
      expect(plan.obstacles).toHaveLength(
        count * 2 +
          plan.amenities.length +
          plan.workflowAreas.reduce(
            (total, area) => total + area.furniture.length,
            0,
          ),
      );

      for (const desk of plan.desks) {
        expect(desk.column).toBe(desk.index % 3);
        expect(desk.row).toBe(Math.floor(desk.index / 3));
        expect(desk.rect.x).toBeGreaterThanOrEqual(0);
        expect(desk.rect.y).toBeGreaterThanOrEqual(0);
        expect(desk.rect.x + desk.rect.width).toBeLessThanOrEqual(
          plan.world.width,
        );
        expect(desk.rect.y + desk.rect.height).toBeLessThanOrEqual(
          plan.world.height,
        );
        for (const anchor of [
          desk.use,
          desk.approach,
          desk.release,
          desk.spawn,
        ]) {
          expect(anchor.x).toBeGreaterThan(0);
          expect(anchor.x).toBeLessThan(plan.world.width);
          expect(anchor.y).toBeGreaterThan(0);
          expect(anchor.y).toBeLessThan(plan.world.height);
          expect(
            findTopDownObstacle(anchor, 34, plan, new Set([desk.chairRect.id])),
          ).toBeNull();
        }
      }

      for (let left = 0; left < plan.desks.length; left += 1) {
        for (let right = left + 1; right < plan.desks.length; right += 1) {
          const a = plan.desks[left].rect;
          const b = plan.desks[right].rect;
          const overlaps =
            a.x < b.x + b.width &&
            a.x + a.width > b.x &&
            a.y < b.y + b.height &&
            a.y + a.height > b.y;
          expect(overlaps).toBe(false);
        }
      }
    },
  );

  it.each([0, 1, 3, 8, 25, 200])(
    "creates stable, walkable meeting and review slots for %i desks",
    (count) => {
      const plan = createTopDownOfficePlan(count);
      expect(plan.workflowAreas.map((area) => area.id)).toEqual([
        "meeting",
        "review",
      ]);

      for (const areaId of ["meeting", "review"] as const) {
        const area = findTopDownWorkflowArea(plan, areaId);
        expect(area.slots).toHaveLength(count);
        expect(area.rug.y).toBeGreaterThan(
          plan.workstationZone.y + plan.workstationZone.height,
        );
        expect(plan.obstacles).not.toContain(area.rug);
        expect(area.slots.map((slot) => slot.id)).toEqual(
          Array.from(
            { length: count },
            (_, deskIndex) => `${areaId}-slot-${deskIndex}`,
          ),
        );

        for (const slot of area.slots) {
          expect(slot.deskIndex).toBe(Number(slot.id.split("-").at(-1)));
          expect(slot.point.x).toBeGreaterThanOrEqual(area.rug.x);
          expect(slot.point.x).toBeLessThanOrEqual(area.rug.x + area.rug.width);
          expect(slot.point.y).toBeGreaterThanOrEqual(area.rug.y);
          expect(slot.point.y).toBeLessThanOrEqual(
            area.rug.y + area.rug.height,
          );
          expect(findTopDownObstacle(slot.point, 34, plan)).toBeNull();
        }
      }

      expect(createTopDownOfficePlan(count).workflowAreas).toEqual(
        plan.workflowAreas,
      );
    },
  );

  it("grows one three-column room vertically without shrinking its geometry", () => {
    const counts = [0, 1, 3, 4, 7, 25];
    const plans = counts.map(createTopDownOfficePlan);
    expect(plans.map((plan) => plan.world.width)).toEqual(
      counts.map(() => TOP_DOWN_WORLD.width),
    );
    for (let index = 1; index < plans.length; index += 1) {
      expect(plans[index].world.height).toBeGreaterThanOrEqual(
        plans[index - 1].world.height,
      );
    }
    expect(plans.at(-1)?.world.height).toBeGreaterThan(TOP_DOWN_WORLD.height);

    const largeLayout = resolveTopDownWorldLayout(
      390,
      240,
      plans.at(-1)?.world,
    );
    expect(largeLayout.scale).toBe(TOP_DOWN_WORLD.minScale);
    expect(largeLayout.renderedHeight).toBeGreaterThan(240);
  });

  it("round-trips pointer coordinates through a dynamically grown world", () => {
    const plan = createTopDownOfficePlan(25);
    const bounds = {
      left: 73,
      top: 41,
      width: plan.world.width * 0.84,
      height: plan.world.height * 0.84,
    };
    const worldPoint = { x: 847.25, y: plan.world.height - 183.5 };
    const clientPoint = topDownWorldPointToClient(
      worldPoint,
      bounds,
      plan.world,
    );
    const roundTrip = clientPointToTopDownWorld(
      clientPoint,
      bounds,
      plan.world,
    );
    expect(roundTrip.x).toBeCloseTo(worldPoint.x, 8);
    expect(roundTrip.y).toBeCloseTo(worldPoint.y, 8);
  });

  it("routes through several workstation rows without crossing furniture", () => {
    const plan = createTopDownOfficePlan(25);
    const from = plan.desks[0].release;
    const target = plan.desks[24].use;
    const ignored = new Set([plan.desks[24].chairRect.id]);
    const route = planTopDownRoute(from, target, plan, ignored);
    expect(route).not.toBeNull();
    expect(route?.at(-1)).toEqual(target);
    expect(route!.length).toBeGreaterThan(1);

    let segmentStart = from;
    for (const point of route ?? []) {
      expect(
        plan.obstacles.some(
          (obstacle) =>
            !ignored.has(obstacle.id) &&
            topDownSegmentHitsObstacle(segmentStart, point, obstacle),
        ),
      ).toBe(false);
      segmentStart = point;
    }
  });

  it.each([
    { deskCount: 100, budgetMs: 750 },
    { deskCount: 200, budgetMs: 2_000 },
  ])(
    "plans a collision-free route through $deskCount desks within a bounded budget",
    ({ deskCount, budgetMs }) => {
      const plan = createTopDownOfficePlan(deskCount);
      const from = plan.desks[0].release;
      const destinationDesk = plan.desks[deskCount - 1];
      const ignored = new Set([destinationDesk.chairRect.id]);
      const startedAt = performance.now();
      const route = planTopDownRoute(from, destinationDesk.use, plan, ignored);
      const elapsed = performance.now() - startedAt;

      expect(route).not.toBeNull();
      expect(route?.at(-1)).toEqual(destinationDesk.use);
      expect(elapsed).toBeLessThan(budgetMs);
      expect(
        planTopDownRoute(from, destinationDesk.use, plan, ignored),
      ).toEqual(route);

      let segmentStart = from;
      for (const point of route ?? []) {
        expect(
          plan.obstacles.some(
            (obstacle) =>
              !ignored.has(obstacle.id) &&
              topDownSegmentHitsObstacle(segmentStart, point, obstacle),
          ),
        ).toBe(false);
        segmentStart = point;
      }
    },
  );
});
