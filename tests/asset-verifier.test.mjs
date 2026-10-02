import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  inspectPng,
  inspectSvg,
  parseProductionAssetRows,
  verifyProductionAssets,
} from "../scripts/verify-assets.mjs";

describe("production asset verifier", () => {
  it("binds exact dimensions and digest to each asset path", () => {
    const digest = "a".repeat(64);
    const parsed = parseProductionAssetRows(
      `| \`public/assets/pixel-office/example.png\` | 96×64 | \`${digest}\` | Original |`,
    );
    expect(parsed.failures).toEqual([]);
    expect(parsed.rows.get("public/assets/pixel-office/example.png")).toEqual({
      width: 96,
      height: 64,
      digest,
    });
  });

  it("rejects malformed dimensions and duplicate manifest rows", () => {
    const digest = "b".repeat(64);
    const parsed = parseProductionAssetRows(
      [
        `| \`public/assets/a.png\` | unknown | \`${digest}\` | Original |`,
        `| \`public/assets/b.png\` | 1×1 | \`${digest}\` | Original |`,
        `| \`public/assets/b.png\` | 1×1 | \`${digest}\` | Duplicate |`,
      ].join("\n"),
    );
    expect(parsed.failures).toEqual([
      "asset manifest dimensions are invalid: public/assets/a.png",
      "duplicate asset manifest row: public/assets/b.png",
    ]);
  });

  it("fully inflates valid PNGs and rejects corruption or trailing payloads", () => {
    const source = readFileSync(
      new URL(
        "../public/assets/topdown-office/coffice-overhead-agent-sheet-v2.png",
        import.meta.url,
      ),
    );
    const expected = { width: 1254, height: 1254 };
    const validFailures = [];
    inspectPng(source, "fixture.png", expected, validFailures);
    expect(validFailures).toEqual([]);

    const truncatedFailures = [];
    inspectPng(
      source.subarray(0, -12),
      "truncated.png",
      expected,
      truncatedFailures,
    );
    expect(truncatedFailures).toContain("PNG has no IEND chunk: truncated.png");

    const corrupt = Buffer.from(source);
    const idatType = corrupt.indexOf(Buffer.from("IDAT"));
    corrupt[idatType + 4] ^= 0xff;
    const corruptFailures = [];
    inspectPng(corrupt, "corrupt.png", expected, corruptFailures);
    expect(
      corruptFailures.some((failure) => failure.includes("CRC mismatch")),
    ).toBe(true);
    expect(corruptFailures).toContain(
      "PNG IDAT data cannot be decoded: corrupt.png",
    );

    const trailingFailures = [];
    inspectPng(
      Buffer.concat([source, Buffer.from("private")]),
      "trailing.png",
      expected,
      trailingFailures,
    );
    expect(trailingFailures).toContain(
      "PNG has trailing data after IEND: trailing.png",
    );
  });

  it("rejects unsafe SVG payloads and dimension drift", () => {
    const failures = [];
    inspectSvg(
      Buffer.from('<svg viewBox="0 0 10 10"><script>alert(1)</script></svg>'),
      "unsafe.svg",
      { width: 20, height: 20 },
      failures,
    );
    expect(failures).toEqual([
      "unsafe SVG content: unsafe.svg",
      "SVG viewBox dimensions mismatch: unsafe.svg",
    ]);
  });

  it("passes the complete released asset set", () => {
    const result = verifyProductionAssets();
    expect(result.failures).toEqual([]);
    expect(result.assetCount).toBeGreaterThan(0);
  });
});
