import type { MarkdownIt } from "markstream-vue";

export function disableMarkdownReplacements(md: MarkdownIt): MarkdownIt {
  md.core.ruler.disable("replacements");
  return md;
}
