import { open } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

/** The caller authorizes the path; content is streamed without loading a whole file. */
export async function webDownload(
  request: Request,
  filePath: string,
): Promise<Response> {
  const file = await open(filePath, "r");
  let streaming = false;
  try {
    const metadata = await file.stat();
    if (!metadata.isFile()) return new Response(null, { status: 400 });
    const headers = {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(metadata.size),
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(filePath))}`,
      "Content-Security-Policy": "sandbox; default-src 'none'",
    };
    if (!metadata.size || request.method === "HEAD")
      return new Response(null, { headers });
    streaming = true;
    return new Response(
      Readable.toWeb(file.createReadStream()) as ReadableStream<Uint8Array>,
      { headers },
    );
  } finally {
    if (!streaming) await file.close();
  }
}
