import { describe, expect, it, vi } from "vitest";
import { applyProjectColorTheme } from "../projectColorThemes";

describe("applyProjectColorTheme", () => {
  it.each([
    ["oklch(0.228 0.013 107.4)", "oklch(0.228 0.013 255)"],
    ["oklch(22.8% .013 107.4)", "oklch(0.228 0.013 255)"],
  ])("rotates the olive color from %s", (source, expected) => {
    const root = document.createElement("div");
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      getPropertyValue: (name: string) =>
        name === "--pine-olive-primary" ? source : "",
    } as CSSStyleDeclaration);

    applyProjectColorTheme(root, "blue");

    expect(root.style.getPropertyValue("--primary")).toBe(expected);
  });

  it("preserves the alpha channel in minified colors", () => {
    const root = document.createElement("div");
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      getPropertyValue: (name: string) =>
        name === "--pine-olive-border" ? "oklch(100% 0 0/.1)" : "",
    } as CSSStyleDeclaration);

    applyProjectColorTheme(root, "blue");

    expect(root.style.getPropertyValue("--border")).toBe(
      "oklch(1 0 147.6 / .1)",
    );
  });
});
