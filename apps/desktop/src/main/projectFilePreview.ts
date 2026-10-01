import { open } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import type { ProjectFilePreview } from "../shared/projectFiles";
import {
  MARKDOWN_IMAGE_PARAM,
  PROJECT_MEDIA_PROTOCOL,
} from "../shared/projectFiles";
import { binaryPreviewFormats } from "./previewFormats";
import { resolveProjectPath } from "./projectFiles";

export const MAX_TEXT_PREVIEW_BYTES = 2 * 1024 * 1024;

/**
 * Marks a project-media URL that serves a presented file rather than a project
 * entry, so the protocol re-checks the window's presented-file grants.
 */
export const PRESENTED_MEDIA_PARAM = "presented";

/**
 * Builds the media URL a preview reads its bytes from. Every URL names the
 * window allowed to read the file; presented files add the flag that switches
 * the protocol from project-entry lookup to the presented-file grant check.
 */
export function projectMediaUrl(
  ownerId: number,
  params: Record<string, string>,
  options: { presented?: boolean } = {},
): string {
  const url = URL.parse(`${PROJECT_MEDIA_PROTOCOL}://preview/`);
  if (!url) throw new Error("Failed to construct the project media URL.");
  url.search = new URLSearchParams({
    ...params,
    owner: String(ownerId),
    ...(options.presented ? { [PRESENTED_MEDIA_PARAM]: "1" } : {}),
  }).toString();
  return url.href;
}

export async function readProjectFilePreview(
  filePath: string,
  mediaUrl: string,
): Promise<ProjectFilePreview> {
  const file = await open(filePath, "r");
  try {
    const metadata = await file.stat();
    if (!metadata.isFile()) throw new Error("Expected a regular file.");
    const info = {
      size: metadata.size,
      modifiedAt: metadata.mtime.toISOString(),
    };
    const extension = path.extname(filePath).toLowerCase();
    const format = binaryPreviewFormats[extension];
    if (format)
      return format.kind === "office"
        ? { ...info, kind: "office", format: format.format, url: mediaUrl }
        : { ...info, kind: format.kind, url: mediaUrl };
    if (metadata.size > MAX_TEXT_PREVIEW_BYTES)
      return { ...info, kind: "unsupported", reason: "too-large" };

    // Bound the read even if another process grows the file after stat().
    const bytes = Buffer.alloc(
      Math.min(metadata.size + 1, MAX_TEXT_PREVIEW_BYTES + 1),
    );
    let length = 0;
    while (length < bytes.length) {
      const { bytesRead } = await file.read(
        bytes,
        length,
        bytes.length - length,
        length,
      );
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (length > metadata.size)
      return { ...info, kind: "unsupported", reason: "too-large" };
    const contents = bytes.subarray(0, length);
    const encoding =
      contents[0] === 0xff && contents[1] === 0xfe
        ? "utf-16le"
        : contents[0] === 0xfe && contents[1] === 0xff
          ? "utf-16be"
          : "utf-8";
    try {
      const text = new TextDecoder(encoding, { fatal: true }).decode(contents);
      if (/[\u0000-\u0008\u000e-\u001f]/u.test(text))
        return { ...info, kind: "unsupported", reason: "binary" };
      return {
        ...info,
        kind: "text",
        text,
        encoding: encoding.toUpperCase(),
        url: mediaUrl,
      };
    } catch {
      return { ...info, kind: "unsupported", reason: "binary" };
    }
  } finally {
    await file.close();
  }
}

/** Resolve the document grant first, then serve only its relative image assets. */
export async function serveProjectMediaRequest(
  request: Request,
  ownerId: number,
  resolvers: {
    project: (
      ownerId: number,
      params: Record<string, string>,
    ) => Promise<string>;
    presented: (
      ownerId: number,
      params: Record<string, string>,
    ) => Promise<string>;
  },
): Promise<Response> {
  const url = new URL(request.url);
  const params = Object.fromEntries(url.searchParams);
  const presented = params[PRESENTED_MEDIA_PARAM] === "1";
  let filePath = await resolvers[presented ? "presented" : "project"](
    ownerId,
    params,
  );
  const imageSource = url.searchParams.get(MARKDOWN_IMAGE_PARAM);
  if (imageSource !== null) {
    let imagePath = imageSource.split(/[?#]/u)[0];
    try {
      imagePath = decodeURIComponent(imagePath);
    } catch {
      // A literal percent sign is valid in a local filename.
    }
    if (
      !imagePath ||
      imagePath.length > 4096 ||
      /^[a-z][a-z\d+.-]*:/iu.test(imagePath) ||
      /^[\\/]/u.test(imagePath) ||
      imagePath.includes("\0")
    ) {
      throw new Error("Expected a relative Markdown image path.");
    }
    if (presented) {
      // An external document grants only images in its directory, including
      // subdirectories. resolveProjectPath also checks symlink confinement.
      filePath = await resolveProjectPath(
        {
          id: "markdown-images",
          name: "Markdown images",
          path: path.dirname(filePath),
          access: "read-only",
          isAvailable: true,
        },
        imagePath,
      );
    } else {
      filePath = await resolvers.project(ownerId, {
        ...params,
        relativePath: path.posix.join(
          path.posix.dirname(params.relativePath),
          imagePath.replaceAll("\\", "/"),
        ),
      });
    }
    if (
      binaryPreviewFormats[path.extname(filePath).toLowerCase()]?.kind !==
      "image"
    )
      return new Response(null, { status: 415 });
  }
  return serveProjectMedia(request, filePath);
}

/** Serves only preview assets, with bounded streaming and byte ranges. */
export async function serveProjectMedia(
  request: Request,
  filePath: string,
): Promise<Response> {
  const extension = path.extname(filePath).toLowerCase();
  const mime = binaryPreviewFormats[extension]?.mimeType;
  if (!mime) return new Response(null, { status: 415 });
  if (request.method !== "GET" && request.method !== "HEAD")
    return new Response(null, { status: 405 });
  const file = await open(filePath, "r");
  let streaming = false;
  try {
    const { size } = await file.stat().then((metadata) => {
      if (!metadata.isFile()) throw new Error("Expected a regular file.");
      return metadata;
    });
    const headers = new Headers({
      "Content-Type": mime,
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    });
    const origin = request.headers.get("origin");
    if (
      origin &&
      (origin === "null" || /^http:\/\/localhost:\d+$/u.test(origin))
    ) {
      headers.set("Access-Control-Allow-Origin", origin);
      headers.set("Vary", "Origin");
    }
    let start = 0;
    let end = size - 1;
    const range = request.headers.get("range");
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (match && (match[1] || match[2])) {
        start = match[1]
          ? Number(match[1])
          : Math.max(0, size - Number(match[2]));
        end =
          match[1] && match[2]
            ? Math.min(Number(match[2]), size - 1)
            : size - 1;
      }
      if (
        !match ||
        !(match[1] || match[2]) ||
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start > end ||
        start >= size
      ) {
        headers.set("Content-Range", `bytes */${size}`);
        return new Response(null, { status: 416, headers });
      }
      headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
    }
    headers.set("Content-Length", String(Math.max(0, end - start + 1)));
    const status = range ? 206 : 200;
    if (request.method === "HEAD" || size === 0)
      return new Response(null, { status, headers });
    const stream = file.createReadStream({ start, end, autoClose: true });
    streaming = true;
    return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
      status,
      headers,
    });
  } finally {
    if (!streaming) await file.close();
  }
}
