import { DEFAULT_RENDERER_DEFINITIONS } from "@file-viewer/core";
import { describe, expect, it } from "vitest";
import {
  documentPreviewExtensions,
  isServedPreviewFile,
  previewExtension,
  previewMimeType,
  renderedTextExtensions,
  videoPreviewExtensions,
} from "../previewFormats";

/** Renderers that ship in `@file-viewer/preset-all`. */
const presetRenderers = DEFAULT_RENDERER_DEFINITIONS.filter(
  (definition) => definition.status !== "experimental",
);
/** Pine previews these as text with its own code and Markdown renderers. */
const textRenderers = new Set(["code", "markdown"]);
/** HLS playlists load segments by URL, which the media protocol never serves. */
const excluded = new Set(["m3u8"]);

describe("preview formats", () => {
  it("routes every format the bundled preset renders", () => {
    const routed = new Set([
      ...documentPreviewExtensions,
      ...videoPreviewExtensions,
      ...renderedTextExtensions,
    ]);
    const missing = presetRenderers
      .filter((definition) => !textRenderers.has(definition.id))
      .flatMap((definition) => definition.extensions)
      .filter(
        (extension) => !routed.has(extension) && !excluded.has(extension),
      );
    expect(missing).toEqual([]);
  });

  it("only routes formats a bundled renderer accepts", () => {
    const rendered = new Set<string>(
      presetRenderers.flatMap((definition) => definition.extensions),
    );
    const unknown = [
      ...documentPreviewExtensions,
      ...renderedTextExtensions,
    ].filter((extension) => !rendered.has(extension));
    expect(unknown).toEqual([]);
  });

  it("reads extensions case-insensitively and serves only preview formats", () => {
    expect(previewExtension("/a/b/Report.DOCX")).toBe("docx");
    expect(previewExtension("C:\\work\\.env")).toBe("");
    expect(isServedPreviewFile("/a/Report.PDF")).toBe(true);
    expect(isServedPreviewFile("/a/table.csv")).toBe(true);
    expect(isServedPreviewFile("/a/clip.mov")).toBe(true);
    expect(isServedPreviewFile("/a/main.py")).toBe(false);
    expect(previewMimeType("/a/clip.MOV")).toBe("video/quicktime");
    expect(previewMimeType("/a/model.step")).toBe("application/octet-stream");
  });
});
