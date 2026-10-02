import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { NORMALIZED_STATUS_VALUES } from "../src/lib/domain";

const productOffice = readFileSync(
  join(process.cwd(), "src", "components", "pixel-office.tsx"),
  "utf8",
);
const topDownOffice = readFileSync(
  join(process.cwd(), "src", "components", "top-down-office.tsx"),
  "utf8",
);

describe("normalized status presentation contract", () => {
  it.each(NORMALIZED_STATUS_VALUES)(
    "defines a readable roster label for %s",
    (status) => {
      expect(productOffice).toMatch(
        new RegExp(`\\b${status}:\\s*\\"[^\\"]+\\"`),
      );
    },
  );

  it("keeps the exact normalized state available to people and automation", () => {
    expect(topDownOffice).toContain("data-agent-state={worker.status}");
    expect(topDownOffice).toContain("worker.status +");
    expect(topDownOffice).toContain('worker.stale ? ", stale" : ""');
  });

  it("does not rely on removed legacy status classes", () => {
    expect(productOffice).not.toContain("status_");
    expect(productOffice).not.toContain("pixel-office.module.css");
  });
});
