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

const tableExtensions = new Set(["csv", "tsv", "dbf"]);
const datasetExtensions = new Set(["sqlite", "parquet", "avro", "wasm"]);
const archiveExtensions = new Set([
  ..."zip zipx 7z rar tar gz gzip tgz bz2 bzip2 tbz tbz2 xz txz lzma zst tzst".split(
    " ",
  ),
  ..."cab ar cpio iso xar lha lzh jar war ear apk cbz cbr".split(" "),
]);
const fontExtensions = new Set(["ttf", "otf", "woff", "woff2"]);
const paletteExtensions = new Set(["ase", "aco"]);

/** A renderer for files read whole as documents, picked by extension. */
function documentRenderer(
  id: string,
  extensions: ReadonlySet<string>,
  component: PreviewRenderer["component"],
): PreviewRenderer {
  return {
    id,
    component,
    supports: ({ preview, filePath }) =>
      preview.kind === "document" && extensions.has(previewExtension(filePath)),
    capabilities: () => noControls,
  };
}

function isImage(filePath: string): boolean {
  return imageExtensions.has(previewExtension(filePath));
}

function hasRenderedView(filePath: string): boolean {
  return renderedTextExtensions.has(previewExtension(filePath));
}

/** Ordered built-in renderers. A new engine can replace one by registering first. */
export const previewRenderers: readonly PreviewRenderer[] = [
  documentRenderer(
    "archive",
    archiveExtensions,
    defineAsyncComponent(() => import("./ArchivePreviewRenderer.vue")),
  ),
  documentRenderer(
    "midi",
    new Set(["mid", "midi"]),
    defineAsyncComponent(() => import("./MidiPreviewRenderer.vue")),
  ),
  documentRenderer(
    "postscript",
    new Set(["eps", "ai"]),
    defineAsyncComponent(() => import("./PostScriptPreviewRenderer.vue")),
  ),
  {
    // Pages and saved web archives, in a frame without scripts or network.
    id: "html",
    component: defineAsyncComponent(() => import("./HtmlPreviewRenderer.vue")),
    supports: ({ preview, filePath, mode }) => {
      const extension = previewExtension(filePath);
      if (extension === "webarchive") return preview.kind === "document";
      return (
        (extension === "html" || extension === "htm") &&
        (preview.kind === "document" ||
          (preview.kind === "text" && mode === "rendered"))
      );
    },
    capabilities: ({ preview }) => ({
      ...noControls,
      zoom: true,
      renderToggle: preview.kind === "text",
    }),
  },
  documentRenderer(
    "photoshop",
    new Set(["psd"]),
    defineAsyncComponent(() => import("./PsdPreviewRenderer.vue")),
  ),
  documentRenderer(
    "font",
    fontExtensions,
    defineAsyncComponent(() => import("./FontPreviewRenderer.vue")),
  ),
  documentRenderer(
    "palette",
    paletteExtensions,
    defineAsyncComponent(() => import("./PalettePreviewRenderer.vue")),
  ),
  // Databases, columnar data and WebAssembly modules, table by table.
  documentRenderer(
    "dataset",
    datasetExtensions,
    defineAsyncComponent(() => import("./DatasetPreviewRenderer.vue")),
  ),
  {
    // Delimited text and dBASE tables, in a virtualized grid.
    id: "table",
    component: defineAsyncComponent(() => import("./TablePreviewRenderer.vue")),
    supports: ({ preview, filePath, mode }) =>
      tableExtensions.has(previewExtension(filePath)) &&
      (preview.kind === "document" ||
        (preview.kind === "text" && mode === "rendered")),
    capabilities: ({ preview }) => ({
      ...noControls,
      renderToggle: preview.kind === "text",
    }),
  },
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
