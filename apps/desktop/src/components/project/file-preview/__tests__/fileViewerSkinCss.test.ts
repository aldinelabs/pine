import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  path.resolve(__dirname, "../fileViewerSkin.css"),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

function declarations(selector: string): string[] {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(^|})\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  return (match?.[2] ?? "")
    .split(";")
    .map((declaration) => declaration.trim())
    .filter(Boolean);
}

describe("file-viewer skin stylesheet", () => {
  // pdf.js text is transparent over the page canvas, so the selection
  // background is all that shows a selection; file-viewer ships it cleared.
  it("paints PDF text selections with a translucent highlight", () => {
    const backgrounds = declarations(
      ".pine-file-viewer :is(.textLayer, .xfaLayer) ::selection",
    ).filter((declaration) => declaration.startsWith("background:"));
    expect(backgrounds.length).toBeGreaterThan(0);
    for (const background of backgrounds) {
      expect(background).not.toContain("transparent");
      expect(background).toMatch(/\/\s*\d+%\)$/);
    }
    expect(backgrounds.at(-1)).toContain("Highlight");
  });

  it("leaves PDF line breaks unpainted", () => {
    expect(declarations(".pine-file-viewer .textLayer br::selection")).toEqual([
      "background: transparent",
    ]);
  });
});
