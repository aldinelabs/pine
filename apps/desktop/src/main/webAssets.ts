import { readFile, realpath } from "node:fs/promises";
import path from "node:path";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".mp3": "audio/mpeg",
};

export async function serveWebAsset(
  request: Request,
  root: string,
  devUrl?: string,
): Promise<Response> {
  const url = new URL(request.url);
  if (devUrl) {
    const target = new URL(url.pathname + url.search, devUrl);
    return fetch(target, { redirect: "manual" });
  }
  try {
    const base = await realpath(root);
    const file = await realpath(
      path.join(
        base,
        decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname),
      ),
    );
    const relative = path.relative(base, file);
    if (relative.startsWith("..") || path.isAbsolute(relative))
      return new Response(null, { status: 403 });
    return new Response(await readFile(file), {
      headers: {
        "Content-Type":
          MIME_TYPES[path.extname(file)] ?? "application/octet-stream",
      },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}
