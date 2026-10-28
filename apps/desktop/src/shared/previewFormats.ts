/**
 * Binary formats rendered by file-viewer (`@file-viewer/preset-all`). Each one
 * previews from its bytes, which only the project media protocol serves.
 * Formats that read as text (code, Markdown, CSV, SVG…) are listed in
 * `renderedTextExtensions` instead so they keep the source view.
 */
const documentExtensionList = [
  // Word processing
  "docx",
  "docm",
  "dotx",
  "dotm",
  "doc",
  "dot",
  "odt",
  "pages",
  "wpd",
  "wp",
  "wp5",
  "wp6",
  "hwp",
  "hwpx",
  // Presentations
  "pptx",
  "pptm",
  "potx",
  "potm",
  "ppsx",
  "ppsm",
  "ppt",
  "pot",
  "odp",
  "key",
  // Spreadsheets
  "xlsx",
  "xltx",
  "xlsm",
  "xlsb",
  "xls",
  "xlt",
  "xla",
  "xlam",
  "xltm",
  "ods",
  "numbers",
  "dbf",
  // Fixed layout
  "pdf",
  "ofd",
  "xps",
  // Archives
  "zip",
  "zipx",
  "7z",
  "rar",
  "tar",
  "gz",
  "gzip",
  "tgz",
  "bz2",
  "bzip2",
  "tbz",
  "tbz2",
  "xz",
  "txz",
  "lzma",
  "zst",
  "tzst",
  "cab",
  "ar",
  "cpio",
  "iso",
  "xar",
  "lha",
  "lzh",
  "jar",
  "war",
  "ear",
  "apk",
  "cbz",
  "cbr",
  // Help, mail and e-books
  "chm",
  "msg",
  "epub",
  "fb2",
  "umd",
  "xmind",
  // Engineering and 3D
  "olb",
  "dra",
  "gds",
  "oas",
  "oasis",
  "dxf",
  "dwg",
  "dwf",
  "dwfx",
  "glb",
  "gltf",
  "obj",
  "stl",
  "ply",
  "fbx",
  "dae",
  "3ds",
  "3mf",
  "amf",
  "usd",
  "usda",
  "usdc",
  "usdz",
  "kmz",
  "step",
  "stp",
  "iges",
  "igs",
  "ifc",
  "3dm",
  "brep",
  "pcd",
  "wrl",
  "vrml",
  "xyz",
  "vtk",
  "vtp",
  "shp",
  // Images
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "avif",
  "bmp",
  "ico",
  "tif",
  "tiff",
  "heic",
  "heif",
  "jxl",
  // MIDI is inspected rather than played
  "midi",
  "mid",
  // Fonts and data
  "ttf",
  "otf",
  "woff",
  "woff2",
  "psd",
  "ai",
  "eps",
  "sqlite",
  "wasm",
  "parquet",
  "avro",
  "webarchive",
  "ase",
  "aco",
] as const;

export const documentPreviewExtensions: ReadonlySet<string> = new Set(
  documentExtensionList,
);

/**
 * Text formats with a rendered view in file-viewer. Under the text size limit
 * they preview as text with a source/rendered switch; larger ones preview as
 * documents only.
 */
export const renderedTextExtensions: ReadonlySet<string> = new Set([
  "html",
  "htm",
  "svg",
  "csv",
  "tsv",
  "fods",
  "rtf",
  "drawio",
  "dio",
  "excalidraw",
  "mermaid",
  "mmd",
  "geojson",
  "kml",
  "gpx",
  "typ",
  "typst",
  "eml",
  "mbox",
]);

/** Extensions served to Markdown documents as images. */
export const imagePreviewExtensions: ReadonlySet<string> = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "avif",
  "bmp",
  "ico",
  "svg",
]);

/**
 * Videos play in a native video element, which streams byte ranges instead of
 * reading the whole file like file-viewer.
 */
export const videoPreviewExtensions: ReadonlySet<string> = new Set([
  "mp4",
  "m4v",
  "mov",
  "webm",
  "ogv",
]);

/** Audio plays in a native audio element, streamed like video. */
export const audioPreviewExtensions: ReadonlySet<string> = new Set([
  "mp3",
  "mpeg",
  "wav",
  "ogg",
  "oga",
  "opus",
  "m4a",
  "aac",
  "flac",
  "weba",
]);

const mimeTypes: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  ico: "image/x-icon",
  svg: "image/svg+xml",
  tif: "image/tiff",
  tiff: "image/tiff",
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  ogv: "video/ogg",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  flac: "audio/flac",
  weba: "audio/webm",
  mpeg: "audio/mpeg",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

/** Lower-case extension without the dot; empty for files without one. */
export function previewExtension(filePath: string): string {
  const name = filePath.split(/[\\/]/u).at(-1) ?? "";
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/** Whether the project media protocol may serve this file to a preview. */
export function isServedPreviewFile(filePath: string): boolean {
  const extension = previewExtension(filePath);
  return (
    documentPreviewExtensions.has(extension) ||
    videoPreviewExtensions.has(extension) ||
    audioPreviewExtensions.has(extension) ||
    renderedTextExtensions.has(extension)
  );
}

export function previewMimeType(filePath: string): string {
  return mimeTypes[previewExtension(filePath)] ?? "application/octet-stream";
}
