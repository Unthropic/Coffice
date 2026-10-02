import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();

function source(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

describe("unified 2D product surface", () => {
  it("loads the product-wide minimalist layer after the base styles", () => {
    const layout = source("src/app/layout.tsx");
    const app = source("src/components/coffice-app.tsx");
    expect(layout.indexOf('import "./globals.css"')).toBeLessThan(
      layout.indexOf('import "./coffice-unified.css"'),
    );

    const css = source("src/app/coffice-unified.css");
    expect(css).toContain(".app-shell-office .brand b");
    expect(css).toContain(".project-monogram");
    expect(css).toContain(".loading-building::before");
    expect(css).toContain(".source-empty");
    expect(css).toMatch(
      /body:has\(\.app-shell-office\) \{[^}]*height: 100dvh;[^}]*overflow: hidden;/,
    );
    expect(css).toMatch(
      /\.app-shell-office \{[^}]*display: flex;[^}]*height: 100dvh;[^}]*overflow: hidden;/,
    );
    expect(css).toMatch(
      /\.app-shell-office \.content-shell \{[^}]*flex: 1 1 0;[^}]*min-height: 0;[^}]*overflow: hidden;/,
    );
    expect(app).toContain('className="app-notices"');
    expect(css).toMatch(
      /\.app-shell-office > \.app-notices \{[^}]*max-height: clamp\(56px, 16dvh, 128px\);[^}]*overflow-y: auto;/,
    );
    expect(css).toContain("width: min(1600px, 100%)");
  });

  it("uses one clean project treatment on the campus and top-down office", () => {
    const app = source("src/components/coffice-app.tsx");
    expect(app).toContain('className="project-monogram"');
    expect(app).toContain('className="brand-desk"');
    expect(app).toContain('className="brand-agent"');
    expect(app).not.toContain('className="brand-mark" aria-hidden="true">C');
    expect(app).not.toContain('className="building-sky"');
    expect(app).not.toContain('className="building-body"');

    const office = source("src/components/pixel-office.tsx");
    const topDownStart = office.indexOf("function TopDownProductOffice");
    const topDownSurface = office.slice(topDownStart);
    expect(topDownSurface).toContain("TopDownProjectDrawer");
    expect(topDownSurface).not.toContain("ProjectDoorRail");
    expect(topDownSurface).not.toContain("LegacyPixelOffice");
    expect(topDownSurface).toContain('data-product-office-renderer="topdown"');
  });

  it("keeps the production office and agent artwork strictly overhead", () => {
    const office = source("src/components/top-down-office.tsx");
    const css = source("src/components/top-down-office.module.css");
    expect(office).toContain('data-overhead-camera="90deg"');
    expect(css).toContain("coffice-overhead-agent-sheet-v2.png");
    expect(css).toContain("coffice-overhead-agent-work-sheet-v3.png");
    expect(css).not.toContain("coffice-agent-sheet-v1.png");
    expect(css).toContain("width: min(100%, 1560px)");
    expect(css).toMatch(
      /\.productOffice \{[^}]*height: 100%;[^}]*min-height: 0;[^}]*overflow: hidden;/,
    );
    expect(css).not.toContain("min-height: 820px");
    expect(css).not.toContain("min-height: 860px");
    expect(css).toMatch(
      /\.roomViewport \{[^}]*min-height: 0;[^}]*overflow: auto;/,
    );
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
  });
});
