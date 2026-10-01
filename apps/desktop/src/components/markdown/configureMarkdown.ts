import type { MarkdownIt } from "markstream-vue";
import { resolveMarkdownImageSrc } from "@/lib/markdownImage";

interface InlineImageState {
  src: string;
  pos: number;
  posMax: number;
  env: Record<string, unknown>;
  push: (
    type: string,
    tag: string,
    nesting: number,
  ) => ReturnType<MarkdownIt["parse"]>[number];
}

interface ParsedDestination {
  ok: boolean;
  pos: number;
  str: string;
}

const configured = new WeakSet<MarkdownIt>();

export function configurePineMarkdown(md: MarkdownIt): MarkdownIt {
  md.core.ruler.disable("replacements");
  if (configured.has(md)) return md;
  configured.add(md);

  // The upstream image rule deliberately rejects file:// before our Vue
  // renderer sees it. Parse only that local form with the parser's CommonMark
  // helpers, then route it through Pine's existing filesystem grant checks.
  // Other image/link schemes keep upstream validation unchanged.
  const parseLabel = md.helpers?.parseLinkLabel as (
    state: InlineImageState,
    pos: number,
    disableNested: boolean,
  ) => number;
  const parseDestination = md.helpers?.parseLinkDestination as (
    src: string,
    pos: number,
    max: number,
  ) => ParsedDestination;
  const parseTitle = md.helpers?.parseLinkTitle as typeof parseDestination;
  md.inline.ruler.before(
    "image",
    "pine_file_image",
    (state: InlineImageState, silent: boolean) => {
      if (!state.src.startsWith("![", state.pos)) return false;
      const labelEnd = parseLabel(state, state.pos + 1, false);
      if (labelEnd < 0 || state.src[labelEnd + 1] !== "(") return false;
      const skipSpaces = (pos: number): number => {
        while (pos < state.posMax && /[ \n]/u.test(state.src[pos])) pos++;
        return pos;
      };
      const destination = parseDestination(
        state.src,
        skipSpaces(labelEnd + 2),
        state.posMax,
      );
      if (!destination.ok || !/^file:\/\//iu.test(destination.str))
        return false;
      const src = resolveMarkdownImageSrc(destination.str);
      if (!src.startsWith("pine-attachment://")) return false;
      let pos = skipSpaces(destination.pos);
      let title: string | undefined;
      if (pos > destination.pos && state.src[pos] !== ")") {
        const parsedTitle = parseTitle(state.src, pos, state.posMax);
        if (!parsedTitle.ok) return false;
        title = parsedTitle.str;
        pos = skipSpaces(parsedTitle.pos);
      }
      if (state.src[pos] !== ")") return false;
      if (!silent) {
        const content = state.src.slice(state.pos + 2, labelEnd);
        const token = state.push("image", "img", 0);
        token.attrs = [
          ["src", src],
          ["alt", ""],
        ];
        if (title) token.attrs.push(["title", title]);
        token.content = content;
        token.children = md.parseInline(content, state.env)[0]?.children ?? [];
      }
      state.pos = pos + 1;
      return true;
    },
  );
  return md;
}
