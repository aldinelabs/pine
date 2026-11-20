import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  path.resolve(__dirname, "../fileViewerSkin.css"),
  "utf8",
)
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\s+/g, " ");

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

  // file-viewer moves each Word page into a fitting frame, out of reach of
  // docx-preview's `.docx-wrapper > section.docx` paper rule.
  describe("Word pages", () => {
    const light =
      ".pine-file-viewer .docx-wrapper > [data-docx-responsive-frame] > section.docx";
    const dark =
      '.pine-file-viewer [data-docx-dark-mode="true"] .docx-wrapper > [data-docx-responsive-frame] > section.docx';

    function framedPage(darkMode: boolean): Element {
      const host = document.createElement("div");
      host.className = "pine-file-viewer";
      host.innerHTML = `
        <div class="file-render docx-fit-viewer" data-docx-dark-mode="${darkMode}">
          <div class="docx-wrapper">
            <div class="docx-flow-frame" data-docx-responsive-frame="true">
              <section class="docx"></section>
            </div>
          </div>
        </div>`;
      return host.querySelector("section.docx")!;
    }

    it("lays framed pages on white paper", () => {
      expect(declarations(light)).toEqual(["background: white"]);
      expect(framedPage(false).matches(light)).toBe(true);
      expect(framedPage(false).matches(dark)).toBe(false);
    });

    it("gives framed pages docx-preview's dark page in dark mode", () => {
      expect(declarations(dark)).toEqual(["background: var(--pine-fv-muted)"]);
      expect(framedPage(true).matches(dark)).toBe(true);
    });
  });
});
