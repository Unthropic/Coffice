import type { NormalizedStatusValue } from "./domain";

export const COMPANION_WIDTH = 1100;
export const COMPANION_COLORS = [
  "#578f89",
  "#7389b8",
  "#d1aa58",
  "#c97961",
  "#87a477",
  "#a987b4",
];

export function companionIdentity(id: string): number {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % COMPANION_COLORS.length;
}

export function companionDesk(index: number) {
  return { x: 545 + (index % 3) * 195, y: 210 + Math.floor(index / 3) * 220 };
}

export function companionWorldHeight(count: number) {
  return Math.max(720, 270 + Math.ceil(count / 3) * 220);
}

/** A single visitor follows the clear aisle below the desks and the central corridor. */
export function companionCoffeeRoute(index: number) {
  const desk = companionDesk(index);
  const home = { x: desk.x, y: desk.y + 78 };
  const aisle = { x: desk.x, y: desk.y + 145 };
  const corridor = { x: 401, y: aisle.y };
  const corner = { x: 401, y: 248 };
  const cup = { x: 263, y: 248 };
  const positions = [
    home,
    aisle,
    corridor,
    corner,
    cup,
    cup,
    corner,
    corridor,
    aisle,
    home,
  ];
  let elapsed = 0;
  return positions.map((position, index) => {
    const previous = positions[index - 1] ?? position;
    const duration =
      index === 5
        ? 2400
        : Math.max(
            40,
            (Math.hypot(position.x - previous.x, position.y - previous.y) /
              180) *
              1000,
          );
    const startsAt = elapsed;
    elapsed += duration;
    return {
      ...position,
      startsAt,
      duration,
      walking: index > 0 && index !== 5,
      angle:
        position.x < previous.x
          ? 90
          : position.x > previous.x
            ? -90
            : position.y < previous.y
              ? 180
              : 0,
    };
  });
}

export function companionStatus(status: NormalizedStatusValue, stale = false) {
  if (stale) return { label: "Last known status", mood: "quiet", symbol: "◌" };
  if (
    [
      "active",
      "planning",
      "thinking",
      "reading",
      "researching",
      "coding",
      "running",
      "reviewing",
      "starting",
    ].includes(status)
  ) {
    return {
      label:
        status === "active"
          ? "Working"
          : status.charAt(0).toUpperCase() + status.slice(1),
      mood: "working",
      symbol: "···",
    };
  }
  if (status === "waiting_for_user")
    return { label: "Needs your reply", mood: "attention", symbol: "?" };
  if (status === "blocked")
    return { label: "Blocked", mood: "attention", symbol: "!" };
  if (status === "failed")
    return { label: "Needs a look", mood: "attention", symbol: "!" };
  if (status === "completed")
    return { label: "Finished", mood: "finished", symbol: "✓" };
  if (status === "queued")
    return { label: "Queued", mood: "quiet", symbol: "···" };
  if (status === "idle")
    return { label: "At ease", mood: "quiet", symbol: "z" };
  if (status === "offline")
    return { label: "Offline", mood: "quiet", symbol: "◌" };
  return { label: "Status unknown", mood: "quiet", symbol: "◌" };
}
