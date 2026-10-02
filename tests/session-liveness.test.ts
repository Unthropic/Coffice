import { describe, expect, it } from "vitest";

import {
  formatSessionAge,
  resolveSessionLiveness,
  sessionLivenessAriaLabel,
  sessionLivenessChipText,
  summarizeProjectSignals,
} from "../src/lib/session-liveness";

const NOW = Date.parse("2026-07-20T12:00:00.000Z");

describe("session liveness projection", () => {
  it("keeps session-file activity separate from semantic task status", () => {
    const liveness = resolveSessionLiveness("2026-07-20T11:59:42.000Z", NOW);

    expect(liveness).toEqual({ tone: "live", ageMs: 18_000 });
    expect(sessionLivenessChipText(liveness)).toBe("Live now");
    expect(sessionLivenessAriaLabel(liveness)).toContain(
      "session file changed",
    );
  });

  it("uses explicit live, recent, quiet, and unknown windows", () => {
    expect(resolveSessionLiveness("2026-07-20T11:59:00.000Z", NOW).tone).toBe(
      "live",
    );
    expect(resolveSessionLiveness("2026-07-20T11:45:00.000Z", NOW).tone).toBe(
      "recent",
    );
    expect(resolveSessionLiveness("2026-07-20T11:44:59.999Z", NOW).tone).toBe(
      "quiet",
    );
    expect(resolveSessionLiveness(undefined, NOW).tone).toBe("unknown");
  });

  it("formats compact ages without claiming zero-second certainty", () => {
    expect(formatSessionAge(0)).toBe("1s");
    expect(formatSessionAge(42_900)).toBe("42s");
    expect(formatSessionAge(240_000)).toBe("4m");
    expect(formatSessionAge(10_800_000)).toBe("3h");
  });

  it("rolls up live session evidence and peak context pressure", () => {
    expect(
      summarizeProjectSignals(
        [
          {
            lastActivityAt: "2026-07-20T11:59:50.000Z",
            tokenUsage: {
              contextTokens: 81,
              contextWindow: 100,
              stale: true,
            },
          },
          {
            lastActivityAt: "2026-07-20T11:56:00.000Z",
            tokenUsage: {
              contextTokens: 81,
              contextWindow: 100,
              stale: false,
            },
          },
        ],
        NOW,
      ),
    ).toEqual({
      liveness: { tone: "live", ageMs: 10_000 },
      liveCount: 1,
      maxContextPercent: 81,
      maxContextStale: false,
    });
  });
});
