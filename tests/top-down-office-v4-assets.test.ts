import { existsSync } from "node:fs";

import { describe, expect, it } from "vitest";

const TOP_DOWN_V4_ASSETS = [
  "coffice-overhead-agent-walk-left-contact-v4.png",
  "coffice-overhead-agent-walk-left-passing-v4.png",
  "coffice-overhead-agent-walk-right-contact-v4.png",
  "coffice-overhead-agent-walk-right-passing-v4.png",
  "coffice-overhead-agent-typing-alternate-v4.png",
  "coffice-overhead-agent-sit-mid-sheet-v4.png",
  "coffice-overhead-agent-seated-rest-v4.png",
  "coffice-overhead-agent-attention-wave-v4.png",
  "coffice-overhead-agent-completion-v4.png",
] as const;

describe("top-down v4 action assets", () => {
  it("keeps every reviewed production candidate at the public asset boundary", () => {
    for (const filename of TOP_DOWN_V4_ASSETS) {
      expect(existsSync(`public/assets/topdown-office/${filename}`)).toBe(true);
    }
  });
});
