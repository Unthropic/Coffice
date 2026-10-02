import { describe, expect, it } from "vitest";

import {
  containsSecretLikeContent,
  hasForbiddenProductPath,
  parseAssetManifest,
  releaseDocumentationFailures,
} from "../scripts/verify-public-boundary.mjs";

describe("public-boundary verifier", () => {
  it("binds each asset digest to its own manifest row", () => {
    const digestA = "a".repeat(64);
    const digestB = "b".repeat(64);
    const manifest = parseAssetManifest(
      [
        `| \`public/assets/a.png\` | 1×1 | \`${digestA}\` | Original |`,
        `| \`public/assets/b.png\` | 1×1 | \`${digestB}\` | Original |`,
      ].join("\n"),
    );

    expect(manifest.failures).toEqual([]);
    expect(manifest.rows.get("public/assets/a.png")).toBe(digestA);
    expect(manifest.rows.get("public/assets/b.png")).toBe(digestB);
    expect(manifest.rows.get("public/assets/a.png")).not.toBe(digestB);
  });

  it("rejects duplicate or digest-free manifest rows", () => {
    const digest = "c".repeat(64);
    const manifest = parseAssetManifest(
      [
        `| \`public/assets/a.png\` | 1×1 | \`${digest}\` | Original |`,
        `| \`public/assets/a.png\` | 1×1 | \`${digest}\` | Duplicate |`,
        "| `public/assets/b.png` | 1×1 | missing | Original |",
      ].join("\n"),
    );

    expect(manifest.failures).toEqual([
      "duplicate manifest asset: public/assets/a.png",
      "manifest row has no SHA-256: public/assets/b.png",
    ]);
  });

  it("rejects private path and policy filenames case-insensitively", () => {
    for (const relative of [
      "References/source.png",
      "RAW-ASSETS/frame.png",
      "src/Internal/note.ts",
      "docs/agents.md",
      "CLAUDE.MD",
      "tmp\\trace.txt",
    ]) {
      expect(hasForbiddenProductPath(relative), relative).toBe(true);
    }
    expect(hasForbiddenProductPath("src/components/office.tsx")).toBe(false);
  });

  it("scans extension-independent text while skipping binary data", () => {
    const secretBearingToml = Buffer.from(
      `${"pass" + "word"}='${"not-a-real-" + "secret-value"}'`,
    );
    expect(containsSecretLikeContent(secretBearingToml)).toBe(true);
    expect(
      containsSecretLikeContent(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00])),
    ).toBe(false);
  });

  it("accepts an intentional source release and rejects stale no-license policy", () => {
    const input = {
      packageJson: JSON.stringify({
        version: "1.0.0-rc.1",
        private: true,
        license: "Apache-2.0",
        author: "release owner",
      }),
      readme:
        "A source-distributed release candidate under the Apache License 2.0.",
      security: "Confirmed controls use the Codex App Server boundary.",
      contributing: "Controls require explicit user confirmation.",
      assetLicense: "Artwork is excluded from the Apache License 2.0.",
      availableFiles: ["CHANGELOG.md", "LICENSE", "docs/operations.md"],
    };
    expect(releaseDocumentationFailures(input)).toEqual([]);
    expect(
      releaseDocumentationFailures({
        ...input,
        readme:
          "Coffice is not yet ready for a public release. A code license still needs to be selected.",
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("not yet ready for a public release"),
        expect.stringContaining("code license still needs"),
      ]),
    );
  });
});
