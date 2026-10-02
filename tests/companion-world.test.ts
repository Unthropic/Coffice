import { describe, expect, it } from "vitest";
import {
  companionDesk,
  companionCoffeeRoute,
  companionIdentity,
  companionStatus,
  companionWorldHeight,
  COMPANION_WIDTH,
} from "../src/lib/companion-world";

describe("companion world", () => {
  it("routes coffee visitors along clear aisles, never diagonally through desks", () => {
    for (const index of [0, 5, 12, 46]) {
      const route = companionCoffeeRoute(index);
      expect(route.at(-1)).toMatchObject({
        x: companionDesk(index).x,
        y: companionDesk(index).y + 78,
      });
      for (let step = 1; step < route.length; step += 1) {
        const from = route[step - 1];
        const to = route[step];
        expect(from.x === to.x || from.y === to.y).toBe(true);
        for (let deskIndex = 0; deskIndex <= index; deskIndex += 1) {
          const desk = companionDesk(deskIndex);
          const overlapsX =
            Math.max(from.x, to.x) > desk.x - 82 &&
            Math.min(from.x, to.x) < desk.x + 82;
          const overlapsY =
            Math.max(from.y, to.y) > desk.y - 64 &&
            Math.min(from.y, to.y) < desk.y + 44;
          expect(overlapsX && overlapsY).toBe(false);
        }
      }
    }
  });
  it("gives every occupant a distinct desk within a growing room", () => {
    for (const count of [1, 6, 7, 30, 101]) {
      const desks = Array.from({ length: count }, (_, index) =>
        companionDesk(index),
      );
      expect(new Set(desks.map(({ x, y }) => `${x}:${y}`)).size).toBe(count);
      for (const desk of desks) {
        expect(desk.x + 82).toBeLessThan(COMPANION_WIDTH - 34);
        expect(desk.y + 120).toBeLessThan(companionWorldHeight(count) - 40);
      }
    }
  });
  it("never presents stale work as current activity or attention", () => {
    expect(companionStatus("coding", true)).toMatchObject({
      label: "Last known status",
      mood: "quiet",
    });
    expect(companionStatus("blocked", true).mood).toBe("quiet");
    expect(companionStatus("unknown").label).toBe("Status unknown");
    expect(companionStatus("waiting_for_user").label).toBe("Needs your reply");
  });
  it("keeps an occupant's visual identity stable across roster reorder", () => {
    const original = ["one", "two", "three"].map(companionIdentity);
    const reversed = ["three", "two", "one"].map(companionIdentity).reverse();
    expect(original).toEqual(reversed);
    expect(original.every((identity) => identity >= 0 && identity < 6)).toBe(
      true,
    );
  });
});
