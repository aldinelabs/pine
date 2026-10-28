import type { RenderablePreview } from "./previewRenderer";

/** Reads a preview's bytes: text as UTF-8, everything else from its URL. */
export async function readPreviewBytes(
  preview: RenderablePreview,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  if (preview.kind === "text")
    return new TextEncoder().encode(preview.text).buffer;
  const response = await fetch(preview.url, { signal });
  if (!response.ok)
    throw new Error(`Failed to read the file (${response.status}).`);
  return response.arrayBuffer();
}

/** Reads a preview as text, decoding fetched bytes as UTF-8. */
export async function readPreviewText(
  preview: RenderablePreview,
  signal?: AbortSignal,
): Promise<string> {
  if (preview.kind === "text") return preview.text;
  return new TextDecoder().decode(await readPreviewBytes(preview, signal));
}
