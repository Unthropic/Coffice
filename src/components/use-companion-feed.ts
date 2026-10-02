"use client";

import { useEffect, useState } from "react";
import {
  NORMALIZED_STATUS_VALUES,
  type NormalizedStatusValue,
} from "../lib/domain";

export interface CompanionFeedTask {
  id: string;
  title: string;
  agentName?: string;
  model?: string;
  status: {
    value: NormalizedStatusValue;
    stale: boolean;
    timestamp?: string;
    evidence: "observed" | "inferred";
  };
}

interface CompanionFeedSnapshot {
  projects: { id: string; name: string; tasks: CompanionFeedTask[] }[];
  sourceFreshness: "fresh" | "stale";
  refreshState: "fresh" | "refreshing" | "stale" | "failed";
  generatedAt: string;
}

interface CompanionFeed {
  snapshot: CompanionFeedSnapshot | null;
  phase: "loading" | "ready" | "disconnected" | "parser-error";
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function decodeCompanionSnapshot(input: unknown): CompanionFeedSnapshot {
  const raw = record(input);
  const source = record(raw?.source);
  if (
    !raw ||
    !source ||
    !Array.isArray(raw.projects) ||
    !Array.isArray(raw.tasks)
  ) {
    throw new Error("Unrecognized activity snapshot.");
  }
  const projects = raw.projects.flatMap((value) => {
    const project = record(value);
    return project &&
      typeof project.id === "string" &&
      typeof project.name === "string"
      ? [
          {
            id: project.id,
            name: project.name,
            tasks: [] as CompanionFeedTask[],
          },
        ]
      : [];
  });
  const byId = new Map(projects.map((project) => [project.id, project]));
  const unassigned: CompanionFeedTask[] = [];
  for (const value of raw.tasks) {
    const task = record(value);
    const status = record(task?.status);
    if (
      !task ||
      !status ||
      typeof task.id !== "string" ||
      typeof task.title !== "string" ||
      !NORMALIZED_STATUS_VALUES.includes(status.value as NormalizedStatusValue)
    )
      continue;
    const decoded: CompanionFeedTask = {
      id: task.id,
      title: task.title,
      ...(typeof task.agentName === "string"
        ? { agentName: task.agentName }
        : {}),
      ...(typeof task.model === "string" ? { model: task.model } : {}),
      status: {
        value: status.value as NormalizedStatusValue,
        stale: status.stale !== false,
        ...(typeof status.timestamp === "string"
          ? { timestamp: status.timestamp }
          : {}),
        evidence: status.provenance === "observed" ? "observed" : "inferred",
      },
    };
    const project =
      typeof task.projectId === "string" ? byId.get(task.projectId) : undefined;
    (project?.tasks ?? unassigned).push(decoded);
  }
  if (unassigned.length)
    projects.push({
      id: "__unassigned__",
      name: "Common room",
      tasks: unassigned,
    });
  const refreshState = source.refreshState;
  return {
    projects,
    sourceFreshness:
      source.freshness === "fresh" && source.health !== "disconnected"
        ? "fresh"
        : "stale",
    refreshState:
      refreshState === "fresh" ||
      refreshState === "refreshing" ||
      refreshState === "stale"
        ? refreshState
        : "failed",
    generatedAt: typeof raw.generatedAt === "string" ? raw.generatedAt : "",
  };
}

/** Activity updates must not shuffle an existing occupant to another desk. */
export function retainCompanionDeskOrder(
  previous: CompanionFeedSnapshot | null,
  next: CompanionFeedSnapshot,
): CompanionFeedSnapshot {
  if (!previous) return next;
  const previousProjects = new Map(
    previous.projects.map((project) => [project.id, project]),
  );
  return {
    ...next,
    projects: next.projects.map((project) => {
      const current = new Map(project.tasks.map((task) => [task.id, task]));
      const retained = (previousProjects.get(project.id)?.tasks ?? []).flatMap(
        (task) => {
          const updated = current.get(task.id);
          if (!updated) return [];
          current.delete(task.id);
          return [updated];
        },
      );
      return { ...project, tasks: [...retained, ...current.values()] };
    }),
  };
}

export function useCompanionFeed(): CompanionFeed {
  const [state, setState] = useState<CompanionFeed>({
    snapshot: null,
    phase: "loading",
  });
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    const refresh = async () => {
      controller = new AbortController();
      const deadline = setTimeout(() => controller?.abort(), 5_000);
      try {
        const response = await fetch("/api/companion", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Activity unavailable.");
        const input: unknown = await response.json();
        const snapshot = decodeCompanionSnapshot(input);
        if (!disposed)
          setState((previous) => ({
            snapshot: retainCompanionDeskOrder(previous.snapshot, snapshot),
            phase: "ready",
          }));
      } catch {
        if (!disposed)
          setState((previous) => ({ ...previous, phase: "disconnected" }));
      } finally {
        clearTimeout(deadline);
        if (!disposed) timer = setTimeout(() => void refresh(), 3_000);
      }
    };
    void refresh();
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      controller?.abort();
    };
  }, []);
  return state;
}
