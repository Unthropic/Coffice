import { describe, expect, it } from "vitest";

import {
  compareCampusProjectsByAttention,
  DEFAULT_CAMPUS_PREFERENCES,
  parseCampusPreferences,
  serializeCampusPreferences,
} from "../src/lib/campus-preferences";

describe("campus view preferences", () => {
  it("defaults to an operational view with attention order and quiet wings collapsed", () => {
    expect(parseCampusPreferences(null)).toEqual(DEFAULT_CAMPUS_PREFERENCES);
    expect(DEFAULT_CAMPUS_PREFERENCES).toEqual({
      version: 1,
      attentionFirst: true,
      hideQuietWings: true,
    });
  });

  it("round-trips Coffice-owned presentation preferences and rejects malformed data", () => {
    const preferences = {
      version: 1 as const,
      attentionFirst: false,
      hideQuietWings: false,
    };
    expect(
      parseCampusPreferences(serializeCampusPreferences(preferences)),
    ).toEqual(preferences);
    expect(parseCampusPreferences("not-json")).toEqual(
      DEFAULT_CAMPUS_PREFERENCES,
    );
    expect(parseCampusPreferences('{"version":2}')).toEqual(
      DEFAULT_CAMPUS_PREFERENCES,
    );
  });

  it("sorts attention first, then live evidence, while pinning holding last", () => {
    const projects = [
      {
        id: "quiet",
        order: 0,
        signals: { attentionCount: 0, liveCount: 0 },
      },
      {
        id: "live",
        order: 1,
        signals: { attentionCount: 0, liveCount: 1 },
      },
      {
        id: "attention",
        order: 2,
        signals: { attentionCount: 2, liveCount: 0 },
      },
      {
        id: "holding",
        order: 3,
        holding: true,
        signals: { attentionCount: 9, liveCount: 9 },
      },
    ];

    expect(
      projects
        .sort(compareCampusProjectsByAttention)
        .map((project) => project.id),
    ).toEqual(["attention", "live", "quiet", "holding"]);
  });
});
