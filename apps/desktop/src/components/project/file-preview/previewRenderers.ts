import { defineAsyncComponent } from "vue";
import { fileLanguage } from "@/lib/fileLanguage";
import {
  previewExtension,
  renderedTextExtensions,
} from "@/shared/previewFormats";
import TextPreviewRenderer from "./TextPreviewRenderer.vue";
import VideoPreviewRenderer from "./VideoPreviewRenderer.vue";
import type { PreviewRenderer } from "./previewRenderer";

const noControls = { zoom: false, invert: false, renderToggle: false };

function hasRenderedView(filePath: string): boolean {
  return renderedTextExtensions.has(previewExtension(filePath));
}

/** Ordered built-in renderers. A new engine can replace one by registering first. */
export const previewRenderers: readonly PreviewRenderer[] = [
  {
    // Every binary format, and the rendered view of text formats such as
    // HTML, SVG or CSV. Zoom and colour inversion depend on the loaded format
    // and are reported by the component once it knows.
    id: "file-viewer",
    component: defineAsyncComponent(
      () => import("./FileViewerPreviewRenderer.vue"),
    ),
    supports: ({ preview, filePath, mode }) =>
      preview.kind === "document" ||
      (preview.kind === "text" &&
        mode === "rendered" &&
        hasRenderedView(filePath)),
    capabilities: ({ preview }) => ({
      ...noControls,
      renderToggle: preview.kind === "text",
    }),
  },
  {
    id: "text",
    component: TextPreviewRenderer,
    supports: ({ preview }) => preview.kind === "text",
    capabilities: ({ filePath }) => ({
      ...noControls,
      renderToggle:
        fileLanguage(filePath) === "markdown" || hasRenderedView(filePath),
    }),
  },
  {
    id: "video",
    component: VideoPreviewRenderer,
    supports: ({ preview }) => preview.kind === "video",
    capabilities: () => noControls,
  },
];
