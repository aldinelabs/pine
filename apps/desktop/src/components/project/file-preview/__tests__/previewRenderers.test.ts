import { defineComponent } from "vue";
import { describe, expect, it } from "vitest";
import { resolvePreviewRenderer } from "../previewRenderer";
import type { PreviewRenderer } from "../previewRenderer";
import { previewRenderers } from "../previewRenderers";

const info = { size: 12, modifiedAt: "2026-09-24T00:00:00Z" };
const document = {
  ...info,
  kind: "document" as const,
  url: "preview://document",
};

function text(source: string) {
  return { ...info, kind: "text" as const, text: source, encoding: "UTF-8" };
}

describe("file preview renderer registry", () => {
  it("lets a new renderer replace a built-in for selected formats", () => {
    const replacement: PreviewRenderer = {
      id: "replacement-pdf",
      component: defineComponent({ template: "<div />" }),
      supports: ({ filePath }) => filePath.endsWith(".pdf"),
      capabilities: () => ({ zoom: true, invert: false, renderToggle: false }),
    };
    const renderers = [replacement, ...previewRenderers];

    expect(
      resolvePreviewRenderer(renderers, {
        preview: document,
        filePath: "report.pdf",
        mode: "rendered",
      }),
    ).toBe(replacement);
    expect(
      resolvePreviewRenderer(renderers, {
        preview: document,
        filePath: "report.docx",
        mode: "rendered",
      })?.id,
    ).toBe("file-viewer");
  });

  it("plays videos with the native video renderer", () => {
    expect(
      resolvePreviewRenderer(previewRenderers, {
        preview: { ...info, kind: "video", url: "preview://video" },
        filePath: "clip.mov",
        mode: "rendered",
      })?.id,
    ).toBe("video");
  });

  it("plays audio with the native audio renderer", () => {
    expect(
      resolvePreviewRenderer(previewRenderers, {
        preview: { ...info, kind: "audio", url: "preview://audio" },
        filePath: "song.mp3",
        mode: "rendered",
      })?.id,
    ).toBe("audio");
  });

  it.each([
    ["index.html", "rendered", "html"],
    ["index.html", "code", "text"],
    ["data.csv", "rendered", "table"],
    ["logo.svg", "rendered", "image"],
    ["notes.md", "rendered", "text"],
    ["main.py", "rendered", "text"],
  ] as const)(
    "routes %s in %s mode to the %s renderer",
    (filePath, mode, id) => {
      const preview = text("content");
      const renderer = resolvePreviewRenderer(previewRenderers, {
        preview,
        filePath,
        mode,
      });
      expect(renderer?.id).toBe(id);
    },
  );

  it("offers the source switch only for text with a rendered view", () => {
    const capabilities = (filePath: string) =>
      resolvePreviewRenderer(previewRenderers, {
        preview: text("content"),
        filePath,
        mode: "code",
      })?.capabilities({ preview: text("content"), filePath, mode: "code" });

    expect(capabilities("index.html")?.renderToggle).toBe(true);
    expect(capabilities("diagram.mmd")?.renderToggle).toBe(true);
    expect(capabilities("notes.md")?.renderToggle).toBe(true);
    expect(capabilities("main.py")?.renderToggle).toBe(false);
  });
});
