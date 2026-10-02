import { describe, expect, it } from "vitest";

import { describeWorkspacePersistence } from "../src/components/coffice-app";

describe("workspace persistence label", () => {
  it.each([
    [false, false, null, false, "loading", "Coffice workspace is loading"],
    [
      true,
      false,
      { kind: "backup", reason: "primary-corrupt" } as const,
      false,
      "recovery",
      "Recovered workspace needs review",
    ],
    [true, true, null, false, "saved", "Coffice workspace saved locally"],
    [true, false, null, false, "unavailable", "Coffice workspace unavailable"],
  ] as const)(
    "reports the actual persistence condition %#",
    (ready, persistent, recovery, recoveryAcknowledged, state, label) => {
      expect(
        describeWorkspacePersistence({
          ready,
          persistent,
          recovery,
          recoveryAcknowledged,
        }),
      ).toEqual({ state, label });
    },
  );
});
