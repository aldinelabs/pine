import { resolveMarkdownImageSrc } from "@/lib/markdownImage";

const LOADABLE =
  /^(?:https?:|data:image\/|pine-attachment:|pine-project-media:)/iu;
const SCHEME = /^[a-z][a-z\d+.-]+:/iu;

/**
 * Turns an Image `src` into a URL the renderer may load, or `undefined` when
 * the source is not one Pine serves. Sources resolve like Markdown images
 * (web and inline-data images as they are, local paths through
 * `pine-attachment://`, whose handler checks them against the project's
 * folders), plus `~/…` and paths relative to the project's default folder,
 * which is where the agent works.
 */
export function resolveImageSource(
  raw: unknown,
  baseFolder?: string,
): string | undefined {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) return undefined;
  const relative =
    !SCHEME.test(value) &&
    !value.startsWith("/") &&
    !value.startsWith("~") &&
    !/^[a-z]:[\\/]/iu.test(value);
  if (relative && !baseFolder) return undefined;
  const source = relative
    ? `${baseFolder!.replace(/[\\/]+$/u, "")}/${value.replace(/^\.[\\/]/u, "")}`
    : value;
  const resolved = resolveMarkdownImageSrc(source);
  return LOADABLE.test(resolved) || isWebClientAttachment(resolved)
    ? resolved
    : undefined;
}

/** The browser client serves local images from its own origin. */
function isWebClientAttachment(url: string): boolean {
  return (
    typeof window !== "undefined" &&
    url.startsWith(`${window.location.origin}/api/attachment?`)
  );
}

export type ImageFailure = "unsupported" | "denied" | "missing" | "failed";

/**
 * Why a local image did not load: the protocol answers 403 for a file outside
 * the project's folders and 404 for a missing one. Web images only fail.
 */
export async function imageFailure(src: string): Promise<ImageFailure> {
  if (/^https?:/iu.test(src) && !isWebClientAttachment(src)) return "failed";
  try {
    const response = await fetch(src);
    if (response.status === 403) return "denied";
    if (response.status === 404) return "missing";
  } catch {
    // The reason stays generic.
  }
  return "failed";
}
