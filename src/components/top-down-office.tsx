"use client";

import {
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type {
  TopDownRosterWorker,
  TopDownWorkflowArea,
} from "../lib/top-down-office-roster";
import {
  TOP_DOWN_ACTOR_PADDING,
  createTopDownOfficePlan,
  reconcileTopDownDeskAssignments,
  type TopDownFacing,
  type TopDownMotionPhase,
  type TopDownOfficePlan,
  type TopDownWorldPoint,
  clampTopDownFloorPoint,
  clientPointToTopDownWorld,
  findTopDownObstacle,
  findTopDownWorkflowArea,
  planTopDownRoute,
  resolveTopDownWorldLayout,
  shouldCenterTopDownWorld,
  topDownFacing,
  topDownFloorRestingPhase,
  topDownMotionDuration,
  topDownRestingPhase,
} from "../lib/top-down-office-world";
import styles from "./top-down-office.module.css";

const STATUS_CUES: Partial<Record<TopDownRosterWorker["status"], string>> = {
  queued: "↗",
  starting: "↗",
  active: "●",
  planning: "◇",
  thinking: "…",
  reading: "▤",
  researching: "⌕",
  coding: "⌘",
  running: "▶",
  reviewing: "✓",
  waiting_for_user: "?",
  blocked: "!",
  failed: "!",
  completed: "✓",
};

interface ActorMotion {
  position: TopDownWorldPoint;
  phase: TopDownMotionPhase;
  facing: TopDownFacing;
  durationMs: number;
  deskIndex: number | null;
  settledArea: TopDownWorkflowArea | null;
  headingArea: TopDownWorkflowArea | null;
}

interface DestinationMarker {
  key: number;
  position: TopDownWorldPoint;
  tone: "route" | "blocked";
}

interface PendingMotion {
  target: TopDownWorldPoint;
  finalPhase: TopDownMotionPhase;
  deskIndex: number | null;
  targetArea: TopDownWorkflowArea | null;
}

const mountedProjectDeskAssignments = new Map<
  string,
  ReadonlyMap<string, number>
>();

export interface TopDownOfficeProps {
  roomId?: string;
  workers: readonly TopDownRosterWorker[];
  selectedTaskId: string | null;
  onSelectTask: (taskId: string, focusTarget: HTMLElement | null) => void;
}

export function AvatarSprite({
  identity,
  className = "",
}: {
  identity: number;
  className?: string;
}) {
  const cell = Math.abs(identity) % 6;
  const style = {
    "--sprite-x": String((cell % 3) * 50) + "%",
    "--sprite-y": String(Math.floor(cell / 3) * 100) + "%",
  } as CSSProperties;

  return (
    <span
      className={styles.avatarSprite + " " + className}
      style={style}
      aria-hidden="true"
    />
  );
}

function initialActorMotion(
  worker: TopDownRosterWorker,
  deskIndex: number,
  officePlan: TopDownOfficePlan,
): ActorMotion {
  const restingPhase = topDownRestingPhase(
    worker.status,
    worker.attention,
    worker.stale,
  );
  const desk = officePlan.desks[deskIndex];
  return {
    position: desk?.spawn ?? { x: officePlan.world.width / 2, y: 360 },
    phase:
      restingPhase === "working" || restingPhase === "seated"
        ? "idle"
        : restingPhase,
    facing: "north",
    durationMs: 0,
    deskIndex: null,
    settledArea: null,
    headingArea: null,
  };
}

function withNearbyActorObstacles(
  officePlan: TopDownOfficePlan,
  actorMotions: Readonly<Record<string, ActorMotion>>,
  movingTaskId: string,
  from: TopDownWorldPoint,
  to: TopDownWorldPoint,
): TopDownOfficePlan {
  const margin = 120;
  const left = Math.min(from.x, to.x) - margin;
  const right = Math.max(from.x, to.x) + margin;
  const top = Math.min(from.y, to.y) - margin;
  const bottom = Math.max(from.y, to.y) + margin;
  const actorObstacles = Object.entries(actorMotions)
    .filter(([taskId, motion]) => {
      return (
        taskId !== movingTaskId &&
        motion.position.x >= left &&
        motion.position.x <= right &&
        motion.position.y >= top &&
        motion.position.y <= bottom
      );
    })
    .map(([taskId, motion]) => ({
      id: `actor-${taskId}`,
      x: motion.position.x - 24,
      y: motion.position.y - 24,
      width: 48,
      height: 48,
    }));

  return actorObstacles.length
    ? { ...officePlan, obstacles: [...officePlan.obstacles, ...actorObstacles] }
    : officePlan;
}

function deskLabel(index: number): string {
  return `Desk ${String(index + 1).padStart(2, "0")}`;
}

const WORKFLOW_AREA_COPY = {
  meeting: {
    label: "Meeting area",
    purpose: "Current Attention · needs reply",
  },
  review: {
    label: "Review area",
    purpose: "Current Attention · exact result to review",
  },
} as const;

function workflowAreaLabel(area: TopDownWorkflowArea): string {
  return area === "desk" ? "their desk" : WORKFLOW_AREA_COPY[area].label;
}

function pinnedMovementMessage(worker: TopDownRosterWorker): string {
  if (worker.workflowArea === "desk") return "";
  return `${worker.displayName} is assigned to the ${WORKFLOW_AREA_COPY[worker.workflowArea].label.toLowerCase()} by current, reliable workflow evidence.`;
}

function worldRectStyle(rect: {
  x: number;
  y: number;
  width: number;
  height: number;
}): CSSProperties {
  return {
    "--area-x": rect.x + "px",
    "--area-y": rect.y + "px",
    "--area-width": rect.width + "px",
    "--area-height": rect.height + "px",
  } as CSSProperties;
}

function sameTaskIds(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((taskId, index) => taskId === right[index])
  );
}

function actorMotionIsValidForPlan(
  motion: ActorMotion,
  assignedDeskIndex: number,
  officePlan: TopDownOfficePlan,
): boolean {
  const { position } = motion;
  if (
    position.x < 0 ||
    position.x > officePlan.world.width ||
    position.y < 0 ||
    position.y > officePlan.world.height
  ) {
    return false;
  }

  const assignedDesk = officePlan.desks[assignedDeskIndex];
  if (!assignedDesk) return false;
  if (motion.deskIndex !== null) {
    return (
      motion.deskIndex === assignedDeskIndex &&
      Math.hypot(
        position.x - assignedDesk.use.x,
        position.y - assignedDesk.use.y,
      ) < 1
    );
  }

  return (
    findTopDownObstacle(position, TOP_DOWN_ACTOR_PADDING, officePlan) === null
  );
}

export function TopDownOffice({
  roomId,
  workers,
  selectedTaskId,
  onSelectTask,
}: TopDownOfficeProps) {
  const visibleWorkers = workers;
  const workerTaskIds = useMemo(
    () => visibleWorkers.map((worker) => worker.taskId),
    [visibleWorkers],
  );
  const [deskAssignmentState, setDeskAssignmentState] = useState(() => ({
    taskIds: workerTaskIds,
    assignments: reconcileTopDownDeskAssignments(
      (roomId ? mountedProjectDeskAssignments.get(roomId) : undefined) ??
        new Map(),
      [...workerTaskIds].sort(),
    ),
  }));
  let deskAssignments = deskAssignmentState.assignments;
  if (!sameTaskIds(deskAssignmentState.taskIds, workerTaskIds)) {
    deskAssignments = reconcileTopDownDeskAssignments(
      deskAssignmentState.assignments,
      workerTaskIds,
    );
    setDeskAssignmentState({
      taskIds: workerTaskIds,
      assignments: deskAssignments,
    });
  }
  useEffect(() => {
    if (roomId) mountedProjectDeskAssignments.set(roomId, deskAssignments);
  }, [deskAssignments, roomId]);
  const planSlotCount = deskAssignments.size;
  const officePlan = useMemo(
    () => createTopDownOfficePlan(planSlotCount),
    [planSlotCount],
  );
  const workersByDesk = useMemo(
    () =>
      new Map(
        visibleWorkers.map((worker) => [
          deskAssignments.get(worker.taskId) ?? 0,
          worker,
        ]),
      ),
    [deskAssignments, visibleWorkers],
  );
  const roomViewportRef = useRef<HTMLDivElement | null>(null);
  const centeredWorldRef = useRef(false);
  const horizontalOverflowRef = useRef<boolean | null>(null);
  const timersRef = useRef(new Map<string, number[]>());
  const pendingMotionsRef = useRef(new Map<string, PendingMotion>());
  const statusKeysRef = useRef(new Map<string, string>());
  const blockedReturnStatusKeysRef = useRef(new Map<string, string>());
  const previousOfficePlanRef = useRef(officePlan);
  const markerKeyRef = useRef(0);
  const reducedMotionRef = useRef(false);
  const [worldLayout, setWorldLayout] = useState(() =>
    resolveTopDownWorldLayout(
      officePlan.world.width,
      officePlan.world.height,
      officePlan.world,
    ),
  );
  const [actorMotions, setActorMotions] = useState<Record<string, ActorMotion>>(
    () =>
      Object.fromEntries(
        visibleWorkers.map((worker, index) => [
          worker.taskId,
          initialActorMotion(
            worker,
            deskAssignments.get(worker.taskId) ?? index,
            officePlan,
          ),
        ]),
      ),
  );
  const [returnRetryRevision, setReturnRetryRevision] = useState(0);
  const actorMotionsRef = useRef(actorMotions);
  const [lastMove, setLastMove] = useState<string | null>(null);
  const [destination, setDestination] = useState<DestinationMarker | null>(
    null,
  );

  const assignMotion = useCallback((taskId: string, motion: ActorMotion) => {
    const next = { ...actorMotionsRef.current, [taskId]: motion };
    actorMotionsRef.current = next;
    setActorMotions(next);
  }, []);

  const clearActorTimers = useCallback((taskId: string) => {
    for (const timer of timersRef.current.get(taskId) ?? []) {
      window.clearTimeout(timer);
    }
    timersRef.current.delete(taskId);
  }, []);

  const scheduleActorTimer = useCallback(
    (taskId: string, callback: () => void, delayMs: number) => {
      const timer = window.setTimeout(() => {
        const timers = timersRef.current.get(taskId);
        if (timers) {
          const remaining = timers.filter((entry) => entry !== timer);
          if (remaining.length) {
            timersRef.current.set(taskId, remaining);
          } else {
            timersRef.current.delete(taskId);
          }
        }
        callback();
      }, delayMs);
      const timers = timersRef.current.get(taskId) ?? [];
      timersRef.current.set(taskId, [...timers, timer]);
      return timer;
    },
    [],
  );

  const travelWorker = useCallback(
    ({
      worker,
      deskSlotIndex,
      target,
      route,
      finalPhase,
      deskIndex,
      targetArea,
      announce,
    }: {
      worker: TopDownRosterWorker;
      deskSlotIndex: number;
      target: TopDownWorldPoint;
      route?: readonly TopDownWorldPoint[];
      finalPhase: TopDownMotionPhase;
      deskIndex: number | null;
      targetArea: TopDownWorkflowArea | null;
      announce: boolean;
    }) => {
      clearActorTimers(worker.taskId);
      pendingMotionsRef.current.set(worker.taskId, {
        target,
        finalPhase,
        deskIndex,
        targetArea,
      });
      const current =
        actorMotionsRef.current[worker.taskId] ??
        initialActorMotion(worker, deskSlotIndex, officePlan);

      const settle = (origin: TopDownWorldPoint) => {
        const transitionMs = reducedMotionRef.current ? 1 : 420;
        if (deskIndex !== null) {
          assignMotion(worker.taskId, {
            position: target,
            phase: "sitting",
            facing: "north",
            durationMs: transitionMs,
            deskIndex,
            settledArea: current.settledArea,
            headingArea: targetArea,
          });
          scheduleActorTimer(
            worker.taskId,
            () => {
              assignMotion(worker.taskId, {
                position: target,
                phase: finalPhase,
                facing: "north",
                durationMs: 0,
                deskIndex,
                settledArea: targetArea,
                headingArea: null,
              });
              if (announce) {
                setLastMove(
                  finalPhase === "working"
                    ? worker.displayName + " sat down and started working."
                    : worker.displayName + " returned to their desk.",
                );
              }
              pendingMotionsRef.current.delete(worker.taskId);
            },
            transitionMs,
          );
          return;
        }

        assignMotion(worker.taskId, {
          position: target,
          phase: finalPhase,
          facing:
            targetArea === "meeting" || targetArea === "review"
              ? "north"
              : topDownFacing(origin, target),
          durationMs: 0,
          deskIndex,
          settledArea: targetArea,
          headingArea: null,
        });
        pendingMotionsRef.current.delete(worker.taskId);
        if (announce)
          setLastMove(worker.displayName + " reached the open floor.");
      };

      const beginTravel = () => {
        const points = [...(route?.length ? route : [target])];
        const advance = (segmentIndex: number) => {
          const origin =
            actorMotionsRef.current[worker.taskId]?.position ??
            current.position;
          const segmentTarget = points[segmentIndex];
          const durationMs = reducedMotionRef.current
            ? 1
            : topDownMotionDuration(origin, segmentTarget);
          assignMotion(worker.taskId, {
            position: segmentTarget,
            phase: "walking",
            facing: topDownFacing(origin, segmentTarget),
            durationMs,
            deskIndex: null,
            settledArea: current.settledArea,
            headingArea: targetArea,
          });

          scheduleActorTimer(
            worker.taskId,
            () => {
              if (segmentIndex < points.length - 1) {
                advance(segmentIndex + 1);
              } else {
                settle(origin);
              }
            },
            durationMs,
          );
        };
        advance(0);
      };

      if (current.deskIndex !== null && deskIndex !== current.deskIndex) {
        assignMotion(worker.taskId, {
          ...current,
          phase: "standing",
          durationMs: 360,
          headingArea: targetArea,
        });
        scheduleActorTimer(
          worker.taskId,
          beginTravel,
          reducedMotionRef.current ? 1 : 360,
        );
      } else {
        beginTravel();
      }
    },
    [assignMotion, clearActorTimers, officePlan, scheduleActorTimer],
  );

  useEffect(() => {
    const viewport = roomViewportRef.current;
    if (!viewport) return;

    const measure = () => {
      const next = resolveTopDownWorldLayout(
        viewport.clientWidth,
        viewport.clientHeight,
        officePlan.world,
      );
      const hasHorizontalOverflow = next.renderedWidth > viewport.clientWidth;
      const shouldCenter = shouldCenterTopDownWorld(
        centeredWorldRef.current,
        horizontalOverflowRef.current,
        hasHorizontalOverflow,
      );
      horizontalOverflowRef.current = hasHorizontalOverflow;
      setWorldLayout((current) =>
        current.scale === next.scale &&
        current.renderedWidth === next.renderedWidth &&
        current.renderedHeight === next.renderedHeight
          ? current
          : next,
      );
      if (shouldCenter) {
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => {
            if (viewport.scrollWidth > viewport.clientWidth) {
              viewport.scrollLeft =
                (viewport.scrollWidth - viewport.clientWidth) / 2;
            }
            centeredWorldRef.current = true;
          });
        });
      }
    };

    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }

    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [officePlan.world]);

  useEffect(() => {
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!media) return;
    const sync = () => {
      const shouldReduce = media.matches;
      if (shouldReduce && !reducedMotionRef.current) {
        for (const [taskId, pending] of pendingMotionsRef.current) {
          clearActorTimers(taskId);
          const current = actorMotionsRef.current[taskId];
          assignMotion(taskId, {
            position: pending.target,
            phase: pending.finalPhase,
            facing:
              pending.finalPhase === "working" ||
              pending.targetArea === "meeting" ||
              pending.targetArea === "review"
                ? "north"
                : (current?.facing ?? "north"),
            durationMs: 0,
            deskIndex: pending.deskIndex,
            settledArea: pending.targetArea,
            headingArea: null,
          });
        }
        pendingMotionsRef.current.clear();
      }
      reducedMotionRef.current = shouldReduce;
    };
    sync();
    media.addEventListener?.("change", sync);
    return () => media.removeEventListener?.("change", sync);
  }, [assignMotion, clearActorTimers]);

  useEffect(() => {
    if (blockedReturnStatusKeysRef.current.size) {
      setReturnRetryRevision((revision) => revision + 1);
    }
  }, [actorMotions]);

  useEffect(() => {
    const planChanged = previousOfficePlanRef.current !== officePlan;
    previousOfficePlanRef.current = officePlan;
    const activeTaskIds = new Set(
      visibleWorkers.map((worker) => worker.taskId),
    );
    const retainedMotions = Object.fromEntries(
      Object.entries(actorMotionsRef.current).filter(([taskId]) =>
        activeTaskIds.has(taskId),
      ),
    );
    if (
      Object.keys(retainedMotions).length !==
      Object.keys(actorMotionsRef.current).length
    ) {
      actorMotionsRef.current = retainedMotions;
      setActorMotions(retainedMotions);
    }
    for (const taskId of statusKeysRef.current.keys()) {
      if (activeTaskIds.has(taskId)) continue;
      clearActorTimers(taskId);
      statusKeysRef.current.delete(taskId);
      blockedReturnStatusKeysRef.current.delete(taskId);
      pendingMotionsRef.current.delete(taskId);
    }

    visibleWorkers.forEach((worker, index) => {
      const deskSlotIndex = deskAssignments.get(worker.taskId) ?? index;
      const desk = officePlan.desks[deskSlotIndex];
      if (!desk) return;
      if (planChanged) {
        clearActorTimers(worker.taskId);
        statusKeysRef.current.delete(worker.taskId);
        blockedReturnStatusKeysRef.current.delete(worker.taskId);
      }
      if (!actorMotionsRef.current[worker.taskId]) {
        assignMotion(
          worker.taskId,
          initialActorMotion(worker, deskSlotIndex, officePlan),
        );
      }

      const currentBeforeStatus = actorMotionsRef.current[worker.taskId];
      const hasStaleRoute =
        planChanged && pendingMotionsRef.current.has(worker.taskId);
      if (
        currentBeforeStatus &&
        (hasStaleRoute ||
          !actorMotionIsValidForPlan(
            currentBeforeStatus,
            deskSlotIndex,
            officePlan,
          ))
      ) {
        clearActorTimers(worker.taskId);
        pendingMotionsRef.current.delete(worker.taskId);
        statusKeysRef.current.delete(worker.taskId);
        blockedReturnStatusKeysRef.current.delete(worker.taskId);
        setDestination(null);
        assignMotion(
          worker.taskId,
          initialActorMotion(worker, deskSlotIndex, officePlan),
        );
      }

      const statusKey = [
        worker.status,
        worker.attention,
        worker.stale,
        worker.workflowArea,
        deskSlotIndex,
      ].join(":");
      if (statusKeysRef.current.get(worker.taskId) === statusKey) return;
      blockedReturnStatusKeysRef.current.delete(worker.taskId);
      statusKeysRef.current.set(worker.taskId, statusKey);
      clearActorTimers(worker.taskId);

      const finalPhase = topDownRestingPhase(
        worker.status,
        worker.attention,
        worker.stale,
      );

      scheduleActorTimer(
        worker.taskId,
        () => {
          if (statusKeysRef.current.get(worker.taskId) !== statusKey) return;
          const current = actorMotionsRef.current[worker.taskId];
          const workflowArea =
            worker.workflowArea === "desk"
              ? null
              : findTopDownWorkflowArea(officePlan, worker.workflowArea);
          const target = workflowArea?.slots[deskSlotIndex]?.point ?? desk.use;
          const alreadySettled = workflowArea
            ? current?.settledArea === worker.workflowArea &&
              Math.hypot(
                current.position.x - target.x,
                current.position.y - target.y,
              ) < 1
            : current?.deskIndex === deskSlotIndex &&
              Math.hypot(
                current.position.x - target.x,
                current.position.y - target.y,
              ) < 1;
          if (alreadySettled && current) {
            pendingMotionsRef.current.delete(worker.taskId);
            assignMotion(worker.taskId, {
              ...current,
              phase: workflowArea
                ? topDownFloorRestingPhase(
                    worker.attention,
                    worker.stale,
                    worker.status,
                  )
                : finalPhase,
              facing: workflowArea ? current.facing : "north",
              durationMs: 0,
              settledArea: worker.workflowArea,
              headingArea: null,
            });
            return;
          }
          const origin = current?.position ?? desk.spawn;
          const navigationPlan = withNearbyActorObstacles(
            officePlan,
            actorMotionsRef.current,
            worker.taskId,
            origin,
            target,
          );
          const route = planTopDownRoute(
            origin,
            target,
            navigationPlan,
            workflowArea ? new Set() : new Set([desk.chairRect.id]),
          );
          if (!route) {
            // A nearby actor can temporarily close the only safe aisle. Leave
            // this status unconsumed so the next occupancy change retries it,
            // without keeping a polling timer alive while the aisle is busy.
            if (statusKeysRef.current.get(worker.taskId) === statusKey) {
              statusKeysRef.current.delete(worker.taskId);
              blockedReturnStatusKeysRef.current.set(worker.taskId, statusKey);
            }
            return;
          }
          blockedReturnStatusKeysRef.current.delete(worker.taskId);
          travelWorker({
            worker,
            deskSlotIndex,
            target,
            route,
            finalPhase: workflowArea
              ? topDownFloorRestingPhase(
                  worker.attention,
                  worker.stale,
                  worker.status,
                )
              : finalPhase,
            deskIndex: workflowArea ? null : deskSlotIndex,
            targetArea: worker.workflowArea,
            announce: false,
          });
        },
        reducedMotionRef.current ? 1 : 180 + (deskSlotIndex % 6) * 70,
      );
    });
  }, [
    assignMotion,
    clearActorTimers,
    deskAssignments,
    officePlan,
    returnRetryRevision,
    scheduleActorTimer,
    travelWorker,
    visibleWorkers,
  ]);

  useEffect(
    () => () => {
      for (const timers of timersRef.current.values()) {
        for (const timer of timers) window.clearTimeout(timer);
      }
      timersRef.current.clear();
      pendingMotionsRef.current.clear();
      statusKeysRef.current.clear();
      blockedReturnStatusKeysRef.current.clear();
    },
    [],
  );

  const moveSelectedWorker = (event: ReactMouseEvent<HTMLDivElement>) => {
    const eventTarget = event.target as HTMLElement;
    if (eventTarget.closest("[data-workflow-area]")) {
      setLastMove(
        "Shared workflow areas are assigned from Current Attention evidence.",
      );
      return;
    }
    if (eventTarget.closest("button, [data-world-obstacle]")) return;
    const worker = visibleWorkers.find(
      (entry) => entry.taskId === selectedTaskId,
    );
    if (!worker) {
      setLastMove("Select an agent before choosing a destination.");
      return;
    }
    if (worker.workflowArea !== "desk") {
      setLastMove(pinnedMovementMessage(worker));
      return;
    }

    const workerIndex = visibleWorkers.findIndex(
      (entry) => entry.taskId === worker.taskId,
    );
    const deskSlotIndex =
      deskAssignments.get(worker.taskId) ?? Math.max(0, workerIndex);
    const desk = officePlan.desks[deskSlotIndex];
    if (!desk) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const target = clampTopDownFloorPoint(
      clientPointToTopDownWorld(
        { x: event.clientX, y: event.clientY },
        bounds,
        officePlan.world,
      ),
      officePlan,
    );
    const current = actorMotionsRef.current[worker.taskId];
    const origin = current?.position ?? desk.spawn;
    const navigationPlan = withNearbyActorObstacles(
      officePlan,
      actorMotionsRef.current,
      worker.taskId,
      origin,
      target,
    );
    const obstacle = findTopDownObstacle(
      target,
      TOP_DOWN_ACTOR_PADDING,
      navigationPlan,
    );
    const ignoredObstacleIds =
      current?.deskIndex !== null && current?.deskIndex !== undefined
        ? new Set([desk.chairRect.id])
        : new Set<string>();
    const route = obstacle
      ? null
      : planTopDownRoute(origin, target, navigationPlan, ignoredObstacleIds);
    markerKeyRef.current += 1;
    setDestination({
      key: markerKeyRef.current,
      position: target,
      tone: obstacle || !route ? "blocked" : "route",
    });

    if (obstacle || !route) {
      setLastMove("That route is occupied. Choose another open floor area.");
      return;
    }

    travelWorker({
      worker,
      deskSlotIndex,
      target,
      route,
      finalPhase: topDownFloorRestingPhase(
        worker.attention,
        worker.stale,
        worker.status,
      ),
      deskIndex: null,
      targetArea: null,
      announce: true,
    });
    setLastMove(worker.displayName + " is walking to the selected spot.");
  };

  const stageStyle = {
    "--world-scale": String(worldLayout.scale),
    "--world-width": officePlan.world.width + "px",
    "--world-height": officePlan.world.height + "px",
    width: worldLayout.renderedWidth + "px",
    height: worldLayout.renderedHeight + "px",
  } as CSSProperties;

  const workstationStyle = {
    "--zone-x": officePlan.workstationZone.x + "px",
    "--zone-y": officePlan.workstationZone.y + "px",
    "--zone-width": officePlan.workstationZone.width + "px",
    "--zone-height": officePlan.workstationZone.height + "px",
  } as CSSProperties;

  return (
    <div className={styles.officeFrame}>
      <div className={styles.roomToolbar}>
        <div>
          <strong>Office floor</strong>
          <span>
            {visibleWorkers.length} agent
            {visibleWorkers.length === 1 ? "" : "s"} · direct overhead
          </span>
        </div>
        <p aria-live="polite">
          {lastMove ?? "Select an agent, then click open floor to move them."}
        </p>
      </div>

      <div className={styles.roomViewport} ref={roomViewportRef}>
        <div
          className={styles.roomStage}
          style={stageStyle}
          data-world-scale={worldLayout.scale}
          data-world-width={officePlan.world.width}
          data-world-height={officePlan.world.height}
        >
          <div
            className={styles.room}
            data-topdown-room="true"
            data-overhead-camera="90deg"
            onClick={moveSelectedWorker}
          >
            <div className={styles.roomLight} aria-hidden="true" />
            <div className={styles.ambientMotes} aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
            </div>

            {officePlan.desks.length ? (
              <div
                className={styles.focusZone}
                style={workstationStyle}
                aria-label="Assigned workstations"
              >
                {officePlan.desks.map((desk) => {
                  const index = desk.index;
                  const label = deskLabel(index);
                  const worker = workersByDesk.get(index);
                  const motion = worker ? actorMotions[worker.taskId] : null;
                  const inUse =
                    motion?.deskIndex === index &&
                    motion.phase !== "walking" &&
                    motion.phase !== "standing";
                  const deskStyle = {
                    "--desk-x":
                      desk.rect.x - officePlan.workstationZone.x + "px",
                    "--desk-y":
                      desk.rect.y - officePlan.workstationZone.y + "px",
                    "--desk-width": desk.rect.width + "px",
                    "--desk-height": desk.rect.height + "px",
                  } as CSSProperties;
                  return (
                    <button
                      key={desk.index}
                      type="button"
                      className={styles.desk}
                      style={deskStyle}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (!worker) return;
                        onSelectTask(worker.taskId, event.currentTarget);
                        if (worker.workflowArea !== "desk") {
                          setLastMove(pinnedMovementMessage(worker));
                          return;
                        }
                        if (inUse) return;
                        const origin =
                          actorMotionsRef.current[worker.taskId]?.position ??
                          desk.spawn;
                        const navigationPlan = withNearbyActorObstacles(
                          officePlan,
                          actorMotionsRef.current,
                          worker.taskId,
                          origin,
                          desk.use,
                        );
                        const route = planTopDownRoute(
                          origin,
                          desk.use,
                          navigationPlan,
                          new Set([desk.chairRect.id]),
                        );
                        markerKeyRef.current += 1;
                        setDestination({
                          key: markerKeyRef.current,
                          position: desk.use,
                          tone: route ? "route" : "blocked",
                        });
                        if (!route) {
                          setLastMove(
                            "That workstation route is occupied. Try again after the aisle clears.",
                          );
                          return;
                        }
                        travelWorker({
                          worker,
                          deskSlotIndex: index,
                          target: desk.use,
                          route,
                          finalPhase: topDownRestingPhase(
                            worker.status,
                            worker.attention,
                            worker.stale,
                          ),
                          deskIndex: index,
                          targetArea: "desk",
                          announce: true,
                        });
                      }}
                      aria-label={
                        worker
                          ? label + ", assigned to " + worker.displayName
                          : label + ", vacant"
                      }
                      data-desk-state={
                        inUse ? "in-use" : worker ? "assigned" : "vacant"
                      }
                    >
                      <span className={styles.monitor} aria-hidden="true">
                        <i />
                      </span>
                      <span className={styles.keyboard} aria-hidden="true" />
                      <span className={styles.deskLamp} aria-hidden="true" />
                      <span className={styles.paperStack} aria-hidden="true" />
                      <span className={styles.deskLabel}>{label}</span>
                      <span
                        className={styles.chair}
                        data-chair-state={inUse ? "occupied" : "vacant"}
                        aria-hidden="true"
                      >
                        <i />
                      </span>
                      <span
                        className={styles.deskAssignment}
                        data-desk-assignment={index}
                        hidden={Boolean(
                          inUse &&
                          worker &&
                          (worker.attention ||
                            selectedTaskId === worker.taskId),
                        )}
                      >
                        {worker?.displayName ?? "Available"}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : null}

            {officePlan.workflowAreas.map((area) => {
              const copy = WORKFLOW_AREA_COPY[area.id];
              const count = visibleWorkers.filter(
                (worker) => worker.workflowArea === area.id,
              ).length;
              const table = area.furniture[0];
              return (
                <section
                  key={area.id}
                  className={styles.workflowArea}
                  style={worldRectStyle(area.rug)}
                  data-workflow-area={area.id}
                  data-workflow-assigned-count={count}
                  aria-label={`${copy.label}: ${copy.purpose}. ${count} assigned agent${count === 1 ? "" : "s"}.`}
                >
                  <span className={styles.workflowAreaTitle}>{copy.label}</span>
                  <span className={styles.workflowAreaPurpose}>
                    {copy.purpose}
                  </span>
                  <span
                    className={styles.workflowTable}
                    style={worldRectStyle({
                      x: table.x - area.rug.x,
                      y: table.y - area.rug.y,
                      width: table.width,
                      height: table.height,
                    })}
                    data-world-obstacle
                    aria-hidden="true"
                  />
                  <span className={styles.workflowAreaCount}>
                    {count} assigned
                  </span>
                </section>
              );
            })}

            <div
              className={styles.lounge}
              style={worldRectStyle(officePlan.amenities[0])}
              aria-label="Quiet lounge"
              data-world-obstacle
            >
              <span className={styles.sofa} aria-hidden="true">
                <i />
                <i />
              </span>
              <span className={styles.loungeTable} aria-hidden="true">
                <i className={styles.coffeeCup} />
              </span>
              <span className={styles.loungeLabel}>Quiet corner</span>
            </div>

            <div
              className={styles.plantCluster}
              style={worldRectStyle(officePlan.amenities[1])}
              aria-hidden="true"
              data-world-obstacle
            >
              <span />
              <span />
              <span />
            </div>

            <div
              className={styles.supplyCabinet}
              style={worldRectStyle(officePlan.amenities[2])}
              aria-hidden="true"
              data-world-obstacle
            >
              <span />
              <span />
              <span />
            </div>

            <div
              className={styles.entryMat}
              style={worldRectStyle(officePlan.amenities[3])}
              aria-hidden="true"
              data-world-obstacle
            >
              Entry
            </div>

            {destination ? (
              <span
                key={destination.key}
                className={styles.destinationMarker}
                data-marker-tone={destination.tone}
                style={
                  {
                    "--marker-x": destination.position.x + "px",
                    "--marker-y": destination.position.y + "px",
                  } as CSSProperties
                }
                aria-hidden="true"
              />
            ) : null}

            {visibleWorkers.map((worker, index) => {
              const deskSlotIndex = deskAssignments.get(worker.taskId) ?? index;
              const motion =
                actorMotions[worker.taskId] ??
                initialActorMotion(worker, deskSlotIndex, officePlan);
              const assignedDesk = officePlan.desks[deskSlotIndex];
              const atHome = assignedDesk
                ? [assignedDesk.spawn, assignedDesk.use].some(
                    (point) =>
                      Math.hypot(
                        motion.position.x - point.x,
                        motion.position.y - point.y,
                      ) < 1,
                  )
                : false;
              const selected = selectedTaskId === worker.taskId;
              const className = [
                styles.worldWorker,
                worker.attention ? styles.workerAttention : "",
                worker.stale ? styles.workerStale : "",
                selected ? styles.workerSelected : "",
              ]
                .filter(Boolean)
                .join(" ");
              const cue = STATUS_CUES[worker.status] ?? "·";
              return (
                <button
                  key={worker.taskId}
                  type="button"
                  className={className}
                  style={
                    {
                      "--worker-x": motion.position.x + "px",
                      "--worker-y": motion.position.y + "px",
                      "--worker-layer": String(
                        Math.max(6, Math.round(motion.position.y)),
                      ),
                      "--move-duration": motion.durationMs + "ms",
                      "--motion-offset": String(deskSlotIndex * -0.41) + "s",
                    } as CSSProperties
                  }
                  onClick={(event) =>
                    onSelectTask(worker.taskId, event.currentTarget)
                  }
                  aria-label={
                    worker.displayName +
                    ", " +
                    worker.status +
                    (worker.stale ? ", stale" : "") +
                    `. Assigned to ${workflowAreaLabel(worker.workflowArea)}` +
                    (motion.headingArea
                      ? `. Heading to ${workflowAreaLabel(motion.headingArea)}`
                      : motion.settledArea
                        ? `. At ${workflowAreaLabel(motion.settledArea)}`
                        : "") +
                    (selected && worker.workflowArea !== "desk"
                      ? `. ${pinnedMovementMessage(worker)}`
                      : "")
                  }
                  aria-pressed={selected}
                  data-agent-state={worker.status}
                  data-motion-phase={motion.phase}
                  data-facing={motion.facing}
                  data-at-desk={motion.deskIndex ?? undefined}
                  data-assigned-desk={deskSlotIndex}
                  data-at-home={atHome}
                  data-desired-area={worker.workflowArea}
                  data-heading-area={motion.headingArea ?? undefined}
                  data-settled-area={motion.settledArea ?? undefined}
                >
                  <span className={styles.actorStage} aria-hidden="true">
                    <span className={styles.actorShadow} />
                    <span className={styles.actorFacing}>
                      <AvatarSprite identity={worker.visualIdentity} />
                    </span>
                    <span className={styles.activityCue}>{cue}</span>
                  </span>
                  <span className={styles.workerName}>
                    {worker.displayName}
                  </span>
                  <span
                    className={
                      styles.statusDot +
                      " " +
                      (worker.attention
                        ? styles.statusAttention
                        : worker.stale
                          ? styles.statusStale
                          : styles.statusLive)
                    }
                    aria-hidden="true"
                  />
                </button>
              );
            })}

            {!visibleWorkers.length ? (
              <div className={styles.emptyRoom}>
                <span aria-hidden="true">☕</span>
                <strong>The room is ready.</strong>
                <p>Live agents will appear here when a session starts.</p>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
