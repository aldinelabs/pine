import { attachmentImageUrl } from "@/shared/attachments";
import { MARKDOWN_IMAGE_PARAM } from "@/shared/projectFiles";

/**
 * Markdown image sources fall into four groups:
 * 1. Remote or inline-data URLs (`https:`, `data:`, `blob:`, protocol-relative)
 *    — pass through untouched.
 * 2. `file://` URLs — decoded to an absolute path.
 * 3. Absolute local paths (POSIX `/…` or Windows `C:\…` / `C:/…`) — served
 *    through the scoped `pine-attachment://` protocol, whose main-process
 *    handler validates the path against attachments and granted folders.
 * 4. Relative paths — file previews carry an owner-scoped document URL.
 *    Main resolves the image relative to that document and checks access.
 *    Chat has no base document, so relative paths pass through unchanged.
 *
 * The scheme pattern requires at least two characters before the colon so
 * Windows drive letters (`C:\…`, `c:/…`) are not mistaken for a URL scheme.
 */
const SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z\d+.-]+:/;
const WINDOWS_ABSOLUTE_PATTERN = /^[a-zA-Z]:[\\/]/;

function decodeMaybeEncodedPath(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

function fileUrlToPath(src: string): string | undefined {
  try {
    const url = new URL(src);
    if (url.protocol !== "file:") return undefined;
    let pathname = decodeURIComponent(url.pathname);
    // Windows file URLs keep a drive-letter slash: file:///C:/Users/...
    if (/^\/[a-zA-Z]:/.test(pathname)) pathname = pathname.slice(1);
    return pathname;
  } catch {
    return undefined;
  }
}

function isAbsoluteLocalPath(path: string): boolean {
  return (
    (path.startsWith("/") && !path.startsWith("//")) ||
    WINDOWS_ABSOLUTE_PATTERN.test(path)
  );
}

/** Rewrite a markdown image `src` into a URL the renderer may load. */
export function resolveMarkdownImageSrc(
  src: string,
  documentUrl?: string,
): string {
  const trimmed = src.trim();
  if (!trimmed) return trimmed;
  if (SCHEME_PATTERN.test(trimmed)) {
    if (/^file:/iu.test(trimmed)) {
      const path = fileUrlToPath(trimmed);
      return path ? attachmentImageUrl(path) : trimmed;
    }
    return trimmed;
  }
  if (isAbsoluteLocalPath(trimmed)) {
    return attachmentImageUrl(decodeMaybeEncodedPath(trimmed));
  }
  if (documentUrl) {
    const url = new URL(documentUrl);
    url.searchParams.set(MARKDOWN_IMAGE_PARAM, trimmed);
    return url.href;
  }
  return trimmed;
}
