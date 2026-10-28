import { afterEach, describe, expect, it } from "vitest";
import { skinFileViewerCss, skinFileViewerStyles } from "../fileViewerSkin";

describe("file-viewer skin", () => {
  it("maps neutral chrome colors to Pine tokens by role", () => {
    expect(
      skinFileViewerCss(
        "[data-viewer-theme='dark'] .archive-sidebar{background:#151b23;color:#e6edf3;border:1px solid rgba(139,148,158,.2)}",
      ),
    ).toBe(
      "[data-viewer-theme='dark'] .archive-sidebar{background:var(--pine-fv-card);color:var(--pine-fv-foreground);border:1px solid color-mix(in oklch, var(--pine-fv-border) 20%, transparent)}",
    );
    expect(
      skinFileViewerCss(
        ".viewer{background:#f8fafc;color:#64748b}.row:hover{background:#eef1f4}.dark{background:#0d1117}",
      ),
    ).toBe(
      ".viewer{background:var(--pine-fv-background);color:var(--pine-fv-muted-foreground)}.row:hover{background:var(--pine-fv-muted)}.dark{background:var(--pine-fv-background)}",
    );
  });

  it("maps the teal accent to the primary color and its text", () => {
    expect(
      skinFileViewerCss(
        ".tab.active{background:#0f766e;color:#fff}.link{color:#5eead4}.soft{background:rgba(45,212,191,.14)}",
      ),
    ).toBe(
      ".tab.active{background:var(--pine-fv-primary);color:var(--pine-fv-primary-foreground)}.link{color:var(--pine-fv-primary)}.soft{background:color-mix(in oklch, var(--pine-fv-primary) 14%, transparent)}",
    );
  });

  it("keeps document content as authored", () => {
    const content = [
      ".docx-page{background:#fff;color:#000}",
      ".hljs-keyword{color:#d73a49}",
      ".drawing-svg path{fill:#64748b;stroke:#172033}",
      ".alert{background:#fff5ad}",
    ].join("");
    expect(skinFileViewerCss(content)).toBe(content);
  });

  it("treats white and black outside the document as chrome", () => {
    expect(
      skinFileViewerCss(
        ".toolbar button{background:#fff;color:#000;border-color:white}",
      ),
    ).toBe(
      ".toolbar button{background:var(--pine-fv-card);color:var(--pine-fv-foreground);border-color:var(--pine-fv-border)}",
    );
  });

  it("swaps renderer font stacks for Pine's", () => {
    expect(
      skinFileViewerCss(
        '.ui{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.code{font-family:"SF Mono",Menlo,monospace}.page{font-family:"Times New Roman",serif}',
      ),
    ).toBe(
      '.ui{font-family: var(--font-sans)}.code{font-family: var(--font-mono)}.page{font-family:"Times New Roman",serif}',
    );
  });

  it("leaves keyframes and font faces alone", () => {
    const css =
      "@font-face{font-family:X;src:url(x.woff)}@keyframes spin{to{transform:rotate(1turn)}}";
    expect(skinFileViewerCss(css)).toBe(css);
  });

  describe("observer", () => {
    afterEach(() => {
      document.body.replaceChildren();
    });

    it("rewrites stylesheets present and added later", async () => {
      const root = document.createElement("div");
      const early = document.createElement("style");
      early.textContent = ".a{background:#0d1117}";
      root.append(early);
      document.body.append(root);
      const stop = skinFileViewerStyles(root);
      expect(early.textContent).toBe(
        ".a{background:var(--pine-fv-background)}",
      );

      const late = document.createElement("style");
      late.textContent = ".b{color:#94a3b8}";
      const wrapper = document.createElement("section");
      wrapper.append(late);
      root.append(wrapper);
      await Promise.resolve();
      expect(late.textContent).toBe(
        ".b{color:var(--pine-fv-muted-foreground)}",
      );

      late.textContent = ".c{border-color:#334155}";
      await Promise.resolve();
      expect(late.textContent).toBe(".c{border-color:var(--pine-fv-border)}");
      stop();
    });
  });
});
