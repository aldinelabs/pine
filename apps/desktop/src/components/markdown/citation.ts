import type { ComputedRef, InjectionKey } from "vue";

export interface MarkdownCitation {
  href: string;
  hostname: string;
  /** Favicon from DuckDuckGo's icon service (sends only the hostname). */
  favicon: string;
  /** Page title, when the definition is `[title](url)`. */
  title?: string;
}

/** Footnote id -> source, parsed from the message's footnote definitions. */
export type MarkdownCitations = ReadonlyMap<string, MarkdownCitation>;

export const markdownCitations: InjectionKey<ComputedRef<MarkdownCitations>> =
  Symbol("markdownCitations");

const DEFINITION = /^[ ]{0,3}\[\^([^\]\s]+)\]:[ \t]*(.+?)[ \t]*$/gmu;
const TITLED_LINK = /^\[([^\]]+)\]\(\s*<?([^\s>)]+)>?(?:\s+"[^"]*")?\s*\)$/u;
const BARE_URL = /^<?(https?:\/\/[^\s>]+)>?$/iu;

function toCitation(
  rawUrl: string,
  title: string | undefined,
): MarkdownCitation | undefined {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return undefined;
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname)
    return undefined;
  const trimmed = title?.trim();
  return {
    href: url.href,
    hostname: url.hostname.replace(/^www\./iu, ""),
    favicon: `https://icons.duckduckgo.com/ip3/${url.hostname}.ico`,
    ...(trimmed ? { title: trimmed } : {}),
  };
}

/**
 * Read GFM footnote definitions whose body is exactly one web source, either
 * `[^1]: https://example.com` or `[^1]: [Title](https://example.com)`.
 * Definitions with any other body stay ordinary footnotes.
 */
export function parseMarkdownCitations(source: string): MarkdownCitations {
  const citations = new Map<string, MarkdownCitation>();
  for (const match of source.matchAll(DEFINITION)) {
    const [, id, body] = match;
    const titled = TITLED_LINK.exec(body);
    const citation = titled
      ? toCitation(titled[2], titled[1])
      : toCitation(BARE_URL.exec(body)?.[1] ?? "", undefined);
    if (citation) citations.set(id, citation);
  }
  return citations;
}
