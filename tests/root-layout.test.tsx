import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";

import RootLayout from "../src/app/layout";

describe("RootLayout", () => {
  it("contains extension-owned body attributes without hiding app mismatches", () => {
    const layout = RootLayout({ children: <main>Coffice</main> });
    const body = layout.props.children as ReactElement<{
      suppressHydrationWarning?: boolean;
    }>;

    expect(layout.type).toBe("html");
    expect(layout.props.suppressHydrationWarning).toBeUndefined();
    expect(body.type).toBe("body");
    expect(body.props.suppressHydrationWarning).toBe(true);
  });
});
