import type { PreviewProperty } from "@/components/project/file-preview/previewRenderer";
import { bundledLanguagesInfo } from "shiki/langs";
import { PropertyList } from "./propertyList";

/** The highlighter's name for a language id ("TypeScript" for "typescript"). */
export function syntaxName(id: string): string | undefined {
  if (id === "text") return undefined;
  return bundledLanguagesInfo.find((info) => info.id === id)?.name ?? id;
}

/** Words are counted up to this many characters; longer files skip them. */
export const MAX_COUNTED_TEXT = 2_000_000;

export function lineEndings(text: string): string | undefined {
  let lf = 0;
  let crlf = 0;
  let cr = 0;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code === 10) lf++;
    else if (code === 13) {
      if (text.charCodeAt(index + 1) === 10) {
        crlf++;
        index++;
      } else cr++;
    }
  }
  const kinds = [lf && "LF", crlf && "CRLF", cr && "CR"].filter(Boolean);
  if (kinds.length > 1) return "Mixed";
  return kinds[0] || undefined;
}

/** Characters as people count them: code points, not UTF-16 units. */
export function countCharacters(text: string): number {
  let count = 0;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    // A high surrogate and its low surrogate are one character.
    if (code < 0xd800 || code > 0xdbff) count++;
    else if (index + 1 >= text.length) count++;
  }
  return count;
}

/**
 * Words by the language-aware word breaker, so Chinese and Japanese text
 * counts its words rather than its runs between spaces.
 */
export function countWords(text: string, locale?: string): number {
  const segmenter = new Intl.Segmenter(locale, { granularity: "word" });
  let count = 0;
  for (const segment of segmenter.segment(text))
    if (segment.isWordLike) count++;
  return count;
}

const unquote = (value: string) => value.trim().replace(/^(["'])(.*)\1$/, "$2");

/**
 * The title and author in a Markdown file's YAML front matter. Only simple
 * `key: value` lines and `author` lists are read.
 */
export function frontMatter(text: string): { title?: string; author?: string } {
  const match = /^﻿?---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)\s*(?:\r?\n|$)/.exec(
    text.slice(0, 20_000),
  );
  if (!match) return {};
  const lines = match[1].split(/\r?\n/);
  const result: { title?: string; author?: string } = {};
  for (let index = 0; index < lines.length; index++) {
    const field = /^(title|author|authors)\s*:\s*(.*)$/i.exec(lines[index]);
    if (!field) continue;
    const key = field[1].toLowerCase() === "title" ? "title" : "author";
    let value = field[2].trim();
    if (value.startsWith("[") && value.endsWith("]"))
      value = value.slice(1, -1).split(",").map(unquote).join(", ");
    else if (!value) {
      const items: string[] = [];
      while (/^\s+-\s+/.test(lines[index + 1] ?? ""))
        items.push(unquote(lines[++index].replace(/^\s+-\s+/, "")));
      value = items.join(", ");
    } else value = unquote(value);
    if (value && !result[key]) result[key] = value;
  }
  return result;
}

/**
 * What a text file's Details add to its lines and encoding: the syntax it is
 * highlighted as, its counts and line endings, and a Markdown title.
 */
export function textProperties(
  text: string,
  options: { syntax?: string; markdown?: boolean; locale?: string } = {},
): PreviewProperty[] {
  const list = new PropertyList();
  if (options.markdown) {
    const meta = frontMatter(text);
    list.text("title", meta.title).text("author", meta.author);
  }
  list.text("syntax", options.syntax);
  if (text.length <= MAX_COUNTED_TEXT)
    list.number("words", countWords(text, options.locale));
  list
    .number("characters", countCharacters(text))
    .text("lineEndings", lineEndings(text));
  return list.items;
}
