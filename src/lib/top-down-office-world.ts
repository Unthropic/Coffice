import type { NormalizedStatusValue } from "./domain";

export const TOP_DOWN_WORLD = Object.freeze({
  width: 1200,
  height: 650,
  minScale: 0.84,
  maxScale: 1.12,
});

export interface TopDownWorldPoint {
  x: number;
  y: number;
}

export interface TopDownWorldRect {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TopDownWorldDimensions {
  width: number;
  height: number;
  minScale: number;
  maxScale: number;
}

export interface TopDownDeskSlot {
  index: number;
  row: number;
  column: number;
  rect: TopDownWorldRect;
  chairRect: TopDownWorldRect;
  use: TopDownWorldPoint;
  approach: TopDownWorldPoint;
  release: TopDownWorldPoint;
  spawn: TopDownWorldPoint;
}

export type TopDownWorkflowAreaId = "meeting" | "review";

export interface TopDownWorkflowSlot {
  id: string;
  deskIndex: number;
  point: TopDownWorldPoint;
}

export interface TopDownWorkflowArea {
  id: TopDownWorkflowAreaId;
  rug: TopDownWorldRect;
  furniture: readonly TopDownWorldRect[];
  slots: readonly TopDownWorkflowSlot[];
}

export interface TopDownOfficePlan {
  world: TopDownWorldDimensions;
  workstationZone: TopDownWorldRect;
  desks: readonly TopDownDeskSlot[];
  workflowAreas: readonly TopDownWorkflowArea[];
  amenities: readonly TopDownWorldRect[];
  obstacles: readonly TopDownWorldRect[];
  floorSlots: readonly TopDownWorldPoint[];
}

export type TopDownFacing = "north" | "east" | "south" | "west";
export type TopDownMotionPhase =
  | "idle"
  | "seated"
  | "attention"
  | "completed"
  | "walking"
  | "sitting"
  | "working"
  | "standing";

export interface TopDownWorldLayout {
  scale: number;
  renderedWidth: number;
  renderedHeight: number;
}

const DESK_COLUMNS = 3;
const DESK_CENTERS_X = [250, 550, 850] as const;
const DESK_TOP = 96;
const DESK_WIDTH = 220;
const DESK_HEIGHT = 96;
const DESK_ROW_PITCH = 340;
const DESK_USE_Y = 285;
const DESK_APPROACH_Y = 365;
const DESK_RELEASE_Y = 390;
const WORKFLOW_AREA_TOP = 700;
const WORKFLOW_AREA_WIDTH = 510;
const WORKFLOW_AREA_SLOT_COLUMNS = 4;
const WORKFLOW_AREA_SLOT_PITCH_Y = 124;
const WORKFLOW_AREA_SLOT_TOP = 160;
export const TOP_DOWN_ACTOR_PADDING = 34;
const ACTOR_PADDING = TOP_DOWN_ACTOR_PADDING;
const ROUTE_CORNER_CLEARANCE = ACTOR_PADDING + 2;

const BASE_AMENITIES: readonly TopDownWorldRect[] = Object.freeze([
  Object.freeze({ id: "lounge", x: 72, y: 438, width: 294, height: 176 }),
  Object.freeze({ id: "plant", x: 990, y: 466, width: 178, height: 178 }),
  Object.freeze({ id: "cabinet", x: 1028, y: 70, width: 132, height: 176 }),
  Object.freeze({ id: "entry", x: 532, y: 600, width: 150, height: 50 }),
]);

function immutablePoint(x: number, y: number): TopDownWorldPoint {
  return Object.freeze({ x, y });
}

function immutableRect(rect: TopDownWorldRect): TopDownWorldRect {
  return Object.freeze(rect);
}

function createWorkflowArea(
  id: TopDownWorkflowAreaId,
  x: number,
  top: number,
  count: number,
): TopDownWorkflowArea {
  const rowCount = Math.ceil(count / WORKFLOW_AREA_SLOT_COLUMNS);
  const height = 220 + Math.max(0, rowCount - 1) * WORKFLOW_AREA_SLOT_PITCH_Y;
  const slotStartX = x + 68;
  const slotPitchX = 124;
  return Object.freeze({
    id,
    rug: immutableRect({
      id: `${id}-rug`,
      x,
      y: top,
      width: WORKFLOW_AREA_WIDTH,
      height,
    }),
    furniture: Object.freeze([
      immutableRect({
        id: `${id}-table`,
        x: x + 171,
        y: top + 28,
        width: 168,
        height: 64,
      }),
    ]),
    slots: Object.freeze(
      Array.from({ length: count }, (_, deskIndex) =>
        Object.freeze({
          id: `${id}-slot-${deskIndex}`,
          deskIndex,
          point: immutablePoint(
            slotStartX + (deskIndex % WORKFLOW_AREA_SLOT_COLUMNS) * slotPitchX,
            top +
              WORKFLOW_AREA_SLOT_TOP +
              Math.floor(deskIndex / WORKFLOW_AREA_SLOT_COLUMNS) *
                WORKFLOW_AREA_SLOT_PITCH_Y,
          ),
        }),
      ),
    ),
  });
}

/**
 * Builds one uncapped logical room. Workstations use practical three-column
 * rows; every extra row extends the room vertically without changing desk size.
 * Furniture rectangles and interaction anchors come from this single plan.
 */
export function createTopDownOfficePlan(slotCount: number): TopDownOfficePlan {
  const count = Number.isFinite(slotCount)
    ? Math.max(0, Math.floor(slotCount))
    : 0;
  const rowCount = Math.ceil(count / DESK_COLUMNS);
  const addedRows = Math.max(0, rowCount - 1);
  const verticalGrowth = addedRows * DESK_ROW_PITCH;
  const workstationZone = immutableRect({
    id: "workstation-zone",
    x: 96,
    y: 72,
    width: 912,
    height: 221 + verticalGrowth,
  });

  const desks = Object.freeze(
    Array.from({ length: count }, (_, index): TopDownDeskSlot => {
      const row = Math.floor(index / DESK_COLUMNS);
      const column = index % DESK_COLUMNS;
      const centerX = DESK_CENTERS_X[column];
      const rowOffset = row * DESK_ROW_PITCH;
      const releaseX = centerX + (column === 0 ? -80 : 80);
      return Object.freeze({
        index,
        row,
        column,
        rect: immutableRect({
          id: `desk-${index}`,
          x: centerX - DESK_WIDTH / 2,
          y: DESK_TOP + rowOffset,
          width: DESK_WIDTH,
          height: DESK_HEIGHT,
        }),
        chairRect: immutableRect({
          id: `chair-${index}`,
          x: centerX - 37,
          y: DESK_TOP + rowOffset + DESK_HEIGHT + 15,
          width: 74,
          height: 74,
        }),
        use: immutablePoint(centerX, DESK_USE_Y + rowOffset),
        approach: immutablePoint(centerX, DESK_APPROACH_Y + rowOffset),
        release: immutablePoint(releaseX, DESK_RELEASE_Y + rowOffset),
        spawn: immutablePoint(centerX, DESK_APPROACH_Y + rowOffset),
      });
    }),
  );

  const workflowTop = WORKFLOW_AREA_TOP + verticalGrowth;
  const workflowAreas = Object.freeze([
    createWorkflowArea("meeting", 72, workflowTop, count),
    createWorkflowArea("review", 618, workflowTop, count),
  ]);
  const workflowBottom = Math.max(
    ...workflowAreas.map((area) => area.rug.y + area.rug.height),
  );
  const world = Object.freeze({
    ...TOP_DOWN_WORLD,
    height: Math.max(
      TOP_DOWN_WORLD.height + verticalGrowth,
      workflowBottom + 36,
    ),
  });

  const amenities = Object.freeze(
    BASE_AMENITIES.map((amenity) =>
      immutableRect({
        ...amenity,
        y: amenity.id === "cabinet" ? amenity.y : amenity.y + verticalGrowth,
      }),
    ),
  );
  const obstacles = Object.freeze([
    ...desks.map((desk) => desk.rect),
    ...desks.map((desk) => desk.chairRect),
    ...amenities,
    ...workflowAreas.flatMap((area) => area.furniture),
  ]);

  return Object.freeze({
    world,
    workstationZone,
    desks,
    workflowAreas,
    amenities,
    obstacles,
    floorSlots: Object.freeze(desks.map((desk) => desk.spawn)),
  });
}

export function findTopDownWorkflowArea(
  plan: TopDownOfficePlan,
  id: TopDownWorkflowAreaId,
): TopDownWorkflowArea {
  return plan.workflowAreas[id === "meeting" ? 0 : 1];
}

/**
 * Keeps a mounted room's desk ownership stable while workers reorder, change
 * status, or join. Departed workers release their slot and newcomers take the
 * lowest free slot first. If departures still leave holes, the remaining
 * assignments compact in prior-slot order so the room renders exactly one desk
 * per worker and only workers above a released slot move.
 */
export function reconcileTopDownDeskAssignments(
  previous: ReadonlyMap<string, number>,
  taskIds: readonly string[],
): ReadonlyMap<string, number> {
  const activeIds = new Set(taskIds);
  const next = new Map<string, number>();
  const usedSlots = new Set<number>();

  for (const [taskId, slot] of previous) {
    if (
      activeIds.has(taskId) &&
      Number.isInteger(slot) &&
      slot >= 0 &&
      !usedSlots.has(slot)
    ) {
      next.set(taskId, slot);
      usedSlots.add(slot);
    }
  }

  for (const taskId of taskIds) {
    if (next.has(taskId)) continue;
    let slot = 0;
    while (usedSlots.has(slot)) slot += 1;
    next.set(taskId, slot);
    usedSlots.add(slot);
  }

  const isDense = Array.from({ length: next.size }, (_, slot) =>
    usedSlots.has(slot),
  ).every(Boolean);
  if (isDense) return next;

  return new Map(
    [...next.entries()]
      .sort(([, leftSlot], [, rightSlot]) => leftSlot - rightSlot)
      .map(([taskId], slot) => [taskId, slot]),
  );
}

export const DEFAULT_TOP_DOWN_OFFICE_PLAN = createTopDownOfficePlan(3);

// Compatibility exports for the current component. New code should consume a
// complete plan so visual geometry and collision geometry cannot drift apart.
export const TOP_DOWN_DESK_SLOTS = DEFAULT_TOP_DOWN_OFFICE_PLAN.desks;
export const TOP_DOWN_WORLD_OBSTACLES = DEFAULT_TOP_DOWN_OFFICE_PLAN.obstacles;
export const TOP_DOWN_FLOOR_SLOTS: readonly TopDownWorldPoint[] = Object.freeze(
  [
    immutablePoint(300, 355),
    immutablePoint(600, 355),
    immutablePoint(900, 355),
    immutablePoint(468, 495),
    immutablePoint(684, 495),
    immutablePoint(888, 510),
  ],
);

const WORKING_STATUSES = new Set<NormalizedStatusValue>([
  "queued",
  "starting",
  "active",
  "planning",
  "thinking",
  "reading",
  "researching",
  "coding",
  "running",
  "reviewing",
]);

export function resolveTopDownWorldLayout(
  availableWidth: number,
  availableHeight: number,
  world: TopDownWorldDimensions = TOP_DOWN_WORLD,
): TopDownWorldLayout {
  const width = Number.isFinite(availableWidth)
    ? Math.max(0, availableWidth)
    : 0;
  const height = Number.isFinite(availableHeight)
    ? Math.max(0, availableHeight)
    : 0;
  const containedScale = Math.min(width / world.width, height / world.height);
  const scale = Math.min(
    world.maxScale,
    Math.max(world.minScale, containedScale || world.minScale),
  );
  const roundedScale = Math.round(scale * 1000) / 1000;

  return {
    scale: roundedScale,
    renderedWidth: world.width * roundedScale,
    renderedHeight: world.height * roundedScale,
  };
}

export function shouldCenterTopDownWorld(
  hasCentered: boolean,
  previousOverflow: boolean | null,
  nextOverflow: boolean,
): boolean {
  return !hasCentered || (nextOverflow && previousOverflow === false);
}

export function clientPointToTopDownWorld(
  clientPoint: TopDownWorldPoint,
  bounds: { left: number; top: number; width: number; height: number },
  world: Pick<TopDownWorldDimensions, "width" | "height"> = TOP_DOWN_WORLD,
): TopDownWorldPoint {
  const width = bounds.width || world.width;
  const height = bounds.height || world.height;
  return {
    x: ((clientPoint.x - bounds.left) / width) * world.width,
    y: ((clientPoint.y - bounds.top) / height) * world.height,
  };
}

export function topDownWorldPointToClient(
  worldPoint: TopDownWorldPoint,
  bounds: { left: number; top: number; width: number; height: number },
  world: Pick<TopDownWorldDimensions, "width" | "height"> = TOP_DOWN_WORLD,
): TopDownWorldPoint {
  return {
    x: bounds.left + (worldPoint.x / world.width) * bounds.width,
    y: bounds.top + (worldPoint.y / world.height) * bounds.height,
  };
}

export function clampTopDownFloorPoint(
  point: TopDownWorldPoint,
  plan: TopDownOfficePlan = DEFAULT_TOP_DOWN_OFFICE_PLAN,
): TopDownWorldPoint {
  return {
    x: Math.max(86, Math.min(plan.world.width - 86, point.x)),
    y: Math.max(306, Math.min(plan.world.height - 76, point.y)),
  };
}

export function findTopDownObstacle(
  point: TopDownWorldPoint,
  padding = ACTOR_PADDING,
  plan: TopDownOfficePlan = DEFAULT_TOP_DOWN_OFFICE_PLAN,
  ignoredObstacleIds: ReadonlySet<string> = new Set(),
): TopDownWorldRect | null {
  return (
    plan.obstacles.find(
      (obstacle) =>
        !ignoredObstacleIds.has(obstacle.id) &&
        point.x >= obstacle.x - padding &&
        point.x <= obstacle.x + obstacle.width + padding &&
        point.y >= obstacle.y - padding &&
        point.y <= obstacle.y + obstacle.height + padding,
    ) ?? null
  );
}

export function topDownSegmentHitsObstacle(
  from: TopDownWorldPoint,
  to: TopDownWorldPoint,
  obstacle: TopDownWorldRect,
  padding = ACTOR_PADDING,
): boolean {
  const left = obstacle.x - padding;
  const right = obstacle.x + obstacle.width + padding;
  const top = obstacle.y - padding;
  const bottom = obstacle.y + obstacle.height + padding;
  let minimum = 0;
  let maximum = 1;
  const dx = to.x - from.x;
  const dy = to.y - from.y;

  for (const [origin, delta, low, high] of [
    [from.x, dx, left, right],
    [from.y, dy, top, bottom],
  ] as const) {
    if (Math.abs(delta) < 0.0001) {
      if (origin < low || origin > high) return false;
      continue;
    }
    const first = (low - origin) / delta;
    const second = (high - origin) / delta;
    const entry = Math.min(first, second);
    const exit = Math.max(first, second);
    minimum = Math.max(minimum, entry);
    maximum = Math.min(maximum, exit);
    if (minimum > maximum) return false;
  }

  return maximum >= 0 && minimum <= 1;
}

function routeSegmentIsClear(
  from: TopDownWorldPoint,
  to: TopDownWorldPoint,
  plan: TopDownOfficePlan,
  ignoredObstacleIds: ReadonlySet<string>,
): boolean {
  return !plan.obstacles.some(
    (obstacle) =>
      !ignoredObstacleIds.has(obstacle.id) &&
      topDownSegmentHitsObstacle(from, to, obstacle),
  );
}

interface RouteQueueEntry {
  index: number;
  score: number;
}

class RouteMinHeap {
  private readonly entries: RouteQueueEntry[] = [];

  push(entry: RouteQueueEntry): void {
    let index = this.entries.push(entry) - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.entries[parent].score <= entry.score) break;
      this.entries[index] = this.entries[parent];
      index = parent;
    }
    this.entries[index] = entry;
  }

  pop(): RouteQueueEntry | undefined {
    const first = this.entries[0];
    const last = this.entries.pop();
    if (!first || !last || this.entries.length === 0) return first;

    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      if (left >= this.entries.length) break;
      const right = left + 1;
      const child =
        right < this.entries.length &&
        this.entries[right].score < this.entries[left].score
          ? right
          : left;
      if (this.entries[child].score >= last.score) break;
      this.entries[index] = this.entries[child];
      index = child;
    }
    this.entries[index] = last;
    return first;
  }

  get size(): number {
    return this.entries.length;
  }
}

function routeCoordinateKey(point: TopDownWorldPoint): string {
  return `${point.x}:${point.y}`;
}

function uniqueSorted(values: readonly number[]): number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}

const ROUTE_SPATIAL_BUCKET_SIZE = 160;

function buildRouteObstacleIndex(obstacles: readonly TopDownWorldRect[]) {
  const buckets = new Map<string, TopDownWorldRect[]>();
  const bucketCoordinate = (value: number) =>
    Math.floor(value / ROUTE_SPATIAL_BUCKET_SIZE);
  const bucketKey = (x: number, y: number) => `${x}:${y}`;

  for (const obstacle of obstacles) {
    const left = bucketCoordinate(obstacle.x - ACTOR_PADDING);
    const right = bucketCoordinate(obstacle.x + obstacle.width + ACTOR_PADDING);
    const top = bucketCoordinate(obstacle.y - ACTOR_PADDING);
    const bottom = bucketCoordinate(
      obstacle.y + obstacle.height + ACTOR_PADDING,
    );
    for (let y = top; y <= bottom; y += 1) {
      for (let x = left; x <= right; x += 1) {
        const key = bucketKey(x, y);
        const bucket = buckets.get(key);
        if (bucket) bucket.push(obstacle);
        else buckets.set(key, [obstacle]);
      }
    }
  }

  const candidates = (
    from: TopDownWorldPoint,
    to: TopDownWorldPoint,
  ): readonly TopDownWorldRect[] => {
    const left = bucketCoordinate(Math.min(from.x, to.x));
    const right = bucketCoordinate(Math.max(from.x, to.x));
    const top = bucketCoordinate(Math.min(from.y, to.y));
    const bottom = bucketCoordinate(Math.max(from.y, to.y));
    const matches = new Set<TopDownWorldRect>();
    for (let y = top; y <= bottom; y += 1) {
      for (let x = left; x <= right; x += 1) {
        for (const obstacle of buckets.get(bucketKey(x, y)) ?? []) {
          matches.add(obstacle);
        }
      }
    }
    return [...matches];
  };

  return {
    pointIsBlocked(point: TopDownWorldPoint): boolean {
      return candidates(point, point).some(
        (obstacle) =>
          point.x >= obstacle.x - ACTOR_PADDING &&
          point.x <= obstacle.x + obstacle.width + ACTOR_PADDING &&
          point.y >= obstacle.y - ACTOR_PADDING &&
          point.y <= obstacle.y + obstacle.height + ACTOR_PADDING,
      );
    },
    segmentIsClear(from: TopDownWorldPoint, to: TopDownWorldPoint): boolean {
      return !candidates(from, to).some((obstacle) =>
        topDownSegmentHitsObstacle(from, to, obstacle),
      );
    },
  };
}

/**
 * Builds a rectilinear Hanan grid from inflated obstacle boundaries. The
 * office has three repeating desk columns, so the number of distinct X
 * coordinates stays small even when the room grows to hundreds of desks.
 * Connecting only adjacent clear nodes avoids the quadratic all-pairs
 * visibility graph while retaining a complete route graph for axis-aligned
 * rectangular obstacles.
 */
function buildRouteGraph(
  from: TopDownWorldPoint,
  to: TopDownWorldPoint,
  plan: TopDownOfficePlan,
  ignoredObstacleIds: ReadonlySet<string>,
): {
  nodes: TopDownWorldPoint[];
  neighbors: Array<Array<{ index: number; distance: number }>>;
  startIndex: number;
  targetIndex: number;
} {
  const obstacles = plan.obstacles.filter(
    (obstacle) => !ignoredObstacleIds.has(obstacle.id),
  );
  const obstacleIndex = buildRouteObstacleIndex(obstacles);
  const xValues = [from.x, to.x];
  const yValues = [from.y, to.y];

  for (const obstacle of obstacles) {
    xValues.push(
      clampTopDownFloorPoint(
        { x: obstacle.x - ROUTE_CORNER_CLEARANCE, y: from.y },
        plan,
      ).x,
      clampTopDownFloorPoint(
        {
          x: obstacle.x + obstacle.width + ROUTE_CORNER_CLEARANCE,
          y: from.y,
        },
        plan,
      ).x,
    );
    yValues.push(
      clampTopDownFloorPoint(
        { x: from.x, y: obstacle.y - ROUTE_CORNER_CLEARANCE },
        plan,
      ).y,
      clampTopDownFloorPoint(
        {
          x: from.x,
          y: obstacle.y + obstacle.height + ROUTE_CORNER_CLEARANCE,
        },
        plan,
      ).y,
    );
  }

  const xs = uniqueSorted(xValues);
  const ys = uniqueSorted(yValues);
  const nodes: TopDownWorldPoint[] = [];
  const nodeByKey = new Map<string, number>();
  const rowIndices = new Map<number, number[]>();
  const columnIndices = new Map<number, number[]>();
  const startKey = routeCoordinateKey(from);

  for (const y of ys) {
    for (const x of xs) {
      const point = { x, y };
      const key = routeCoordinateKey(point);
      if (key !== startKey && obstacleIndex.pointIsBlocked(point)) {
        continue;
      }
      nodeByKey.set(key, nodes.length);
      const row = rowIndices.get(y);
      if (row) row.push(nodes.length);
      else rowIndices.set(y, [nodes.length]);
      const column = columnIndices.get(x);
      if (column) column.push(nodes.length);
      else columnIndices.set(x, [nodes.length]);
      nodes.push(point);
    }
  }

  const neighbors = nodes.map(
    () =>
      [] as Array<{
        index: number;
        distance: number;
      }>,
  );
  const connectLine = (indices: number[]) => {
    for (let position = 1; position < indices.length; position += 1) {
      const previous = indices[position - 1];
      const current = indices[position];
      if (!obstacleIndex.segmentIsClear(nodes[previous], nodes[current])) {
        continue;
      }
      const distance = Math.hypot(
        nodes[current].x - nodes[previous].x,
        nodes[current].y - nodes[previous].y,
      );
      neighbors[previous].push({ index: current, distance });
      neighbors[current].push({ index: previous, distance });
    }
  };

  for (const indices of rowIndices.values()) connectLine(indices);
  for (const indices of columnIndices.values()) connectLine(indices);

  return {
    nodes,
    neighbors,
    startIndex: nodeByKey.get(startKey) ?? -1,
    targetIndex: nodeByKey.get(routeCoordinateKey(to)) ?? -1,
  };
}

function simplifyTopDownRoute(
  from: TopDownWorldPoint,
  route: readonly TopDownWorldPoint[],
  plan: TopDownOfficePlan,
  ignoredObstacleIds: ReadonlySet<string>,
): TopDownWorldPoint[] {
  const simplified: TopDownWorldPoint[] = [];
  let anchor = from;
  let cursor = 0;
  while (cursor < route.length) {
    let furthest = route.length - 1;
    while (
      furthest > cursor &&
      !routeSegmentIsClear(anchor, route[furthest], plan, ignoredObstacleIds)
    ) {
      furthest -= 1;
    }
    simplified.push(route[furthest]);
    anchor = route[furthest];
    cursor = furthest + 1;
  }
  return simplified;
}

/**
 * Finds a deterministic collision-free route through a sparse rectilinear
 * graph built from inflated furniture boundaries. A* visits only useful parts
 * of the vertically growing room; a final line-of-sight pass removes needless
 * right-angle waypoints without weakening collision guarantees.
 */
export function planTopDownRoute(
  from: TopDownWorldPoint,
  to: TopDownWorldPoint,
  plan: TopDownOfficePlan = DEFAULT_TOP_DOWN_OFFICE_PLAN,
  ignoredObstacleIds: ReadonlySet<string> = new Set(),
): readonly TopDownWorldPoint[] | null {
  if (findTopDownObstacle(to, ACTOR_PADDING, plan, ignoredObstacleIds)) {
    return null;
  }
  if (routeSegmentIsClear(from, to, plan, ignoredObstacleIds)) return [to];

  const { nodes, neighbors, startIndex, targetIndex } = buildRouteGraph(
    from,
    to,
    plan,
    ignoredObstacleIds,
  );
  if (startIndex < 0 || targetIndex < 0) return null;
  const distances = Array(nodes.length).fill(Number.POSITIVE_INFINITY);
  const previous = Array<number>(nodes.length).fill(-1);
  const queue = new RouteMinHeap();
  distances[startIndex] = 0;
  queue.push({
    index: startIndex,
    score: Math.hypot(to.x - from.x, to.y - from.y),
  });

  while (queue.size > 0) {
    const entry = queue.pop();
    if (!entry) break;
    const current = entry.index;
    const expectedScore =
      distances[current] +
      Math.hypot(to.x - nodes[current].x, to.y - nodes[current].y);
    if (entry.score > expectedScore + 0.0001) continue;
    if (current === targetIndex) break;

    for (const neighbor of neighbors[current]) {
      const candidate = distances[current] + neighbor.distance;
      if (candidate >= distances[neighbor.index]) continue;
      distances[neighbor.index] = candidate;
      previous[neighbor.index] = current;
      queue.push({
        index: neighbor.index,
        score:
          candidate +
          Math.hypot(
            to.x - nodes[neighbor.index].x,
            to.y - nodes[neighbor.index].y,
          ),
      });
    }
  }

  if (!Number.isFinite(distances[targetIndex])) return null;
  const route: TopDownWorldPoint[] = [];
  for (
    let cursor = targetIndex;
    cursor !== startIndex;
    cursor = previous[cursor]
  ) {
    route.push(nodes[cursor]);
    if (previous[cursor] < 0) return null;
  }
  route.reverse();
  return simplifyTopDownRoute(from, route, plan, ignoredObstacleIds);
}

export function topDownMotionDuration(
  from: TopDownWorldPoint,
  to: TopDownWorldPoint,
): number {
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  return Math.max(1, Math.round((distance / 180) * 1000));
}

export function topDownFacing(
  from: TopDownWorldPoint,
  to: TopDownWorldPoint,
): TopDownFacing {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) > Math.abs(dy)) return dx >= 0 ? "east" : "west";
  return dy >= 0 ? "south" : "north";
}

export function topDownStatusUsesDesk(status: NormalizedStatusValue): boolean {
  return WORKING_STATUSES.has(status);
}

export function topDownRestingPhase(
  status: NormalizedStatusValue,
  attention: boolean,
  stale: boolean,
): TopDownMotionPhase {
  if (!stale && attention) return "attention";
  if (!stale && status === "completed") return "completed";
  return topDownStatusUsesDesk(status) && !stale ? "working" : "seated";
}

export function topDownFloorRestingPhase(
  attention: boolean,
  stale: boolean,
  status?: NormalizedStatusValue,
): TopDownMotionPhase {
  if (!stale && attention) return "attention";
  return !stale && status === "completed" ? "completed" : "idle";
}
