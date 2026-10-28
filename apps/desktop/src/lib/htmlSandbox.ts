/**
 * Prepares untrusted HTML (pages, saved web archives, email bodies) for a
 * sandboxed frame. The frame runs no scripts; this policy also keeps the
 * page from reaching the network, so remote images and tracking pixels do
 * not load. Inline styles and `data:` resources still render.
 */
export const SANDBOX_POLICY = [
  "default-src 'none'",
  "img-src data:",
  "media-src data:",
  "font-src data:",
  "style-src 'unsafe-inline' data:",
].join("; ");

const META = `<meta http-equiv="Content-Security-Policy" content="${SANDBOX_POLICY}">`;

/** Puts the policy first in the document, before anything it governs. */
export function sandboxHtml(html: string): string {
  const head = /<head[^>]*>/i.exec(html);
  if (head) {
    const at = head.index + head[0].length;
    return html.slice(0, at) + META + html.slice(at);
  }
  const root = /<html[^>]*>/i.exec(html);
  if (root) {
    const at = root.index + root[0].length;
    return `${html.slice(0, at)}<head>${META}</head>${html.slice(at)}`;
  }
  return `<!doctype html><head>${META}</head>${html}`;
}

/** The charset a page declares in its first bytes, if any. */
export function declaredCharset(bytes: Uint8Array): string | undefined {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 2048));
  return /<meta[^>]+charset=["']?\s*([\w-]+)/i.exec(head)?.[1];
}

export function decodeHtml(bytes: Uint8Array, charset?: string): string {
  const label = charset ?? declaredCharset(bytes) ?? "utf-8";
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

export function dataUrl(bytes: Uint8Array, mimeType: string): string {
  return `data:${mimeType};base64,${base64(bytes)}`;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Points every reference to a saved resource at an inline copy, so a saved
 * page shows its own images and styles without the network. Style sheets
 * are rewritten the same way first, for the fonts and images they use.
 */
export function inlineResources(
  html: string,
  resources: {
    url?: string;
    mimeType?: string;
    encoding?: string;
    data: Uint8Array;
  }[],
): string {
  const saved = resources.filter(
    (resource): resource is typeof resource & { url: string } =>
      Boolean(resource.url),
  );
  const urls = new Map<string, string>();
  const replace = (text: string): string =>
    urls.size
      ? text.replace(
          new RegExp([...urls.keys()].map(escapeRegExp).join("|"), "g"),
          (url) => urls.get(url) ?? url,
        )
      : text;
  // Plain resources first, so style sheets can point at them.
  for (const resource of saved)
    if (resource.mimeType !== "text/css")
      urls.set(
        resource.url,
        dataUrl(resource.data, resource.mimeType ?? "application/octet-stream"),
      );
  for (const resource of saved)
    if (resource.mimeType === "text/css") {
      const css = replace(decodeHtml(resource.data, resource.encoding));
      urls.set(
        resource.url,
        dataUrl(new TextEncoder().encode(css), "text/css"),
      );
    }
  return replace(html);
}
