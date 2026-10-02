import { describe, expect, it } from "vitest";

import { recognizeNamedAgent } from "../src/lib/named-agent";

describe("recognizeNamedAgent", () => {
  it("recognizes the established title convention", () => {
    expect(recognizeNamedAgent("[AGENT] Ada")).toEqual({
      isNamedAgent: true,
      name: "Ada",
    });
    expect(recognizeNamedAgent("  [agent]   Lab Steward  ")).toEqual({
      isNamedAgent: true,
      name: "Lab Steward",
    });
  });

  it("does not treat ordinary or empty titles as named agents", () => {
    expect(recognizeNamedAgent("Investigate parser")).toEqual({
      isNamedAgent: false,
    });
    expect(recognizeNamedAgent("[AGENT]")).toEqual({ isNamedAgent: false });
    expect(recognizeNamedAgent("Notes [AGENT] Ada")).toEqual({
      isNamedAgent: false,
    });
  });
});
