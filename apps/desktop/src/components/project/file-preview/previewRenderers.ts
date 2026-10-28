import { defineAsyncComponent } from "vue";
import { fileLanguage } from "@/lib/fileLanguage";
import {
  previewExtension,
  renderedTextExtensions,
} from "@/shared/previewFormats";
import TextPreviewRenderer from "./TextPreviewRenderer.vue";
import AudioPreviewRenderer from "./AudioPreviewRenderer.vue";
import VideoPreviewRenderer from "./VideoPreviewRenderer.vue";
import type { PreviewRenderer } from "./previewRenderer";

const noControls = { zoom: false, invert: false, renderToggle: false };

/** Images Pine shows itself; HEIC and TIFF are decoded first. */
const imageExtensions = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "avif",
  "bmp",
  "ico",
  "svg",
  "tif",
  "tiff",
  "heic",
  "heif",
  "jxl",
]);

function isImage(filePath: string): boolean {
  return imageExtensions.has(previewExtension(filePath));
}

function hasRenderedView(filePath: string): boolean {
  return renderedTextExtensions.has(previewExtension(filePath));
}

/** Ordered built-in renderers. A new engine can replace one by registering first. */
export const previewRenderers: readonly PreviewRenderer[] = [
  {
    // Raster images and the rendered view of SVG.
    id: "image",
    component: defineAsyncComponent(() => import("./ImagePreviewRenderer.vue")),
    supports: ({ preview, filePath, mode }) =>
      isImage(filePath) &&
      (preview.kind === "document" ||
        (preview.kind === "text" && mode === "rendered")),
    capabilities: ({ preview }) => ({
      ...noControls,
      zoom: true,
      fitWidth: true,
      renderToggle: preview.kind === "text",
    }),
  },
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
  {
    id: "audio",
    component: AudioPreviewRenderer,
    supports: ({ preview }) => preview.kind === "audio",
    capabilities: () => noControls,
  },
];
