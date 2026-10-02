// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppErrorState } from "../src/components/app-error-state";

function relativeLuminance(hex: string): number {
  const channels = hex
    .slice(1)
    .match(/.{2}/g)!
    .map((value) => Number.parseInt(value, 16) / 255)
    .map((value) =>
      value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4),
    );
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrastRatio(foreground: string, background: string): number {
  const light = Math.max(
    relativeLuminance(foreground),
    relativeLuminance(background),
  );
  const dark = Math.min(
    relativeLuminance(foreground),
    relativeLuminance(background),
  );
  return (light + 0.05) / (dark + 0.05);
}

describe("AppErrorState", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it("focuses a content-free recovery message and exposes both recovery actions", async () => {
    const onRetry = vi.fn();
    const onReload = vi.fn();
    await act(async () => {
      root.render(<AppErrorState onRetry={onRetry} onReload={onReload} />);
    });

    const heading = host.querySelector("h1")!;
    expect(document.activeElement).toBe(heading);
    expect(host.getAttribute("role")).toBeNull();
    expect(host.querySelector("main")?.getAttribute("role")).toBe("alert");
    expect(host.textContent).toContain("No task content is shown here");

    const buttons = [...host.querySelectorAll("button")];
    expect(buttons.map((button) => button.textContent?.trim())).toEqual([
      "Try again",
      "Reload Coffice",
    ]);
    await act(async () => buttons[0].click());
    await act(async () => buttons[1].click());
    expect(onRetry).toHaveBeenCalledOnce();
    expect(onReload).toHaveBeenCalledOnce();
  });

  it("keeps the primary recovery action at AA normal-text contrast", () => {
    const css = readFileSync(
      join(process.cwd(), "src", "app", "globals.css"),
      "utf8",
    );
    const rule = css.match(/\.fatal-error-actions button \{([\s\S]*?)\}/)?.[1];
    const background = rule?.match(/background:\s*(#[0-9a-f]{6})/i)?.[1];
    const foreground = rule?.match(/color:\s*(#[0-9a-f]{6})/i)?.[1];

    expect(background).toBeDefined();
    expect(foreground).toBeDefined();
    expect(contrastRatio(foreground!, background!)).toBeGreaterThanOrEqual(4.5);
  });
});
