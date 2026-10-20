import type { OfficeDocumentFormat } from "../shared/projectFiles";

export type BinaryPreviewFormat =
  | { kind: "image" | "video" | "pdf"; mimeType: string }
  | { kind: "office"; format: OfficeDocumentFormat; mimeType: string };

/** Only registered formats may be served through the project media protocol. */
export const binaryPreviewFormats: Readonly<
  Record<string, BinaryPreviewFormat>
> = {
  ".png": { kind: "image", mimeType: "image/png" },
  ".jpg": { kind: "image", mimeType: "image/jpeg" },
  ".jpeg": { kind: "image", mimeType: "image/jpeg" },
  ".gif": { kind: "image", mimeType: "image/gif" },
  ".webp": { kind: "image", mimeType: "image/webp" },
  ".avif": { kind: "image", mimeType: "image/avif" },
  ".bmp": { kind: "image", mimeType: "image/bmp" },
  ".ico": { kind: "image", mimeType: "image/x-icon" },
  ".svg": { kind: "image", mimeType: "image/svg+xml" },
  ".mp4": { kind: "video", mimeType: "video/mp4" },
  ".m4v": { kind: "video", mimeType: "video/mp4" },
  ".webm": { kind: "video", mimeType: "video/webm" },
  ".ogv": { kind: "video", mimeType: "video/ogg" },
  ".mov": { kind: "video", mimeType: "video/quicktime" },
  ".pdf": { kind: "pdf", mimeType: "application/pdf" },
  ".docx": {
    kind: "office",
    format: "docx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  },
  ".xlsx": {
    kind: "office",
    format: "xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
  ".xls": {
    kind: "office",
    format: "xls",
    mimeType: "application/vnd.ms-excel",
  },
  ".pptx": {
    kind: "office",
    format: "pptx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  },
};
