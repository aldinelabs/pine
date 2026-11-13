// Markdown helpers for WeChat replies. Pure: no I/O, no Electron.
//
// ClawBot renders bot text as Markdown, so Pine's replies use a small subset:
// `**bold**`, `` `code` ``, fenced code, `> ` quotes, `- ` lists and narrow
// GFM tables (no italics, headings, rules, images, HTML or ordered lists of
// Pine's own). Display data is escaped; the agent's Markdown is contained so it
// renders but cannot open a block that swallows Pine's footer. Every helper is
// linear in the length of one message.

import {
  FENCE,
  INVISIBLE,
  NEUTRAL_MARK,
  OPENUI_PLACEHOLDER,
  SEARCH_MARKERS,
  cleanInline,
  codePointLength,
  paginate,
  startsWithPrefix,
  truncate,
} from "./text";
import type { ReplyLanguage } from "./types";

/** Backslash-escapes the characters that would start inline Markdown. */
export function escapeInline(text: string): string {
  return text.replace(/[\\`*_~[\]<&]/g, "\\$&");
}

/** `**text**`; the caller passes escaped text and keeps bold next to a space or a line edge. */
export function strong(text: string): string {
  return `**${text}**`;
}

/** An inline code span of one cleaned line; backticks become `'`. */
export function code(text: string): string {
  const clean = cleanInline(text).replace(/`/g, "'");
  return clean ? `\`${clean}\`` : "";
}

function longestRun(text: string, character: string): number {
  let longest = 0;
  let run = 0;
  for (const point of text) {
    run = point === character ? run + 1 : 0;
    if (run > longest) longest = run;
  }
  return longest;
}

/** A fenced code block whose fence is longer than any backtick run inside. */
export function codeBlock(text: string, info = ""): string {
  const body = text.replace(/\r\n?/g, "\n").trimEnd();
  const fence = "`".repeat(Math.max(3, longestRun(body, "`") + 1));
  return `${fence}${info}\n${body}\n${fence}`;
}

/** Each non-empty single line as `> line`; `""` when there is none. */
export function quote(...lines: (string | false | undefined)[]): string {
  return lines
    .filter((line): line is string => typeof line === "string" && line !== "")
    .map((line) => `> ${line}`)
    .join("\n");
}

/** `- item` lines. */
export function bullets(items: readonly string[]): string {
  return items.map((item) => `- ${item}`).join("\n");
}

/**
 * One table cell of display data: a single line, `|` as `｜` so the text
 * cannot add a column, and a dot-led text guarded like a line.
 */
export function tableCell(text: string): string {
  const clean = cleanInline(text).replace(/\|/g, "｜");
  return clean ? neutraliseMarkdownLine(clean) : " ";
}

/**
 * A GFM table. Header cells are Pine's literals; row cells are display data
 * and go through `tableCell`, except a first column of commands (`command`),
 * which the caller builds with `code` from Pine's own literals.
 */
export function table(
  head: readonly string[],
  rows: readonly (readonly string[])[],
  options: { command?: boolean } = {},
): string {
  const line = (cells: readonly string[]) => `| ${cells.join(" | ")} |`;
  return [
    line(head),
    `|${head.map(() => "---").join("|")}|`,
    ...rows.map((cells) =>
      line(
        cells.map((cell, index) =>
          options.command && index === 0 ? cell : tableCell(cell),
        ),
      ),
    ),
  ].join("\n");
}

/** Non-empty parts separated by a blank line. */
export function blocks(...parts: (string | false | undefined)[]): string {
  return parts
    .filter((part): part is string => typeof part === "string" && part !== "")
    .join("\n\n");
}

// Container markers (list, task box, quote, heading), then leading emphasis,
// code, link or HTML tags, then a prefix that renders as a dot: literal,
// backslash-escaped or an HTML entity.
const MARKDOWN_DOT =
  /^(\s*(?:(?:[-*+]|\d{1,9}[.)])\s+(?:\[[ xX]\]\s+)?|>\s?|#{1,6}\s+)*)(?:\*{1,3}|_{1,3}|~~|`+|!?\[|<[a-z][^>]*>)*\s*(?:\\?[.。．｡]|&(?:#0*(?:46|12290|65294|65377)|#x0*(?:2e|3002|ff0e|ff61)|period);?)/i;

/**
 * The dot-command guard for one Markdown line: when the visible text of the
 * line starts with a command prefix (after list, quote or heading markers and
 * leading emphasis or code), `NEUTRAL_MARK` goes in front of it. Indentation
 * and the rest of the line are kept.
 */
export function neutraliseMarkdownLine(line: string): string {
  const match = MARKDOWN_DOT.exec(line);
  if (match) {
    const prefix = match[1] ?? "";
    return `${prefix}${NEUTRAL_MARK}${line.slice(prefix.length)}`;
  }
  const trimmed = line.trimStart();
  if (startsWithPrefix(trimmed))
    return `${line.slice(0, line.length - trimmed.length)}${NEUTRAL_MARK}${trimmed}`;
  return line;
}

interface Fence {
  /** The opening line's indent, so a closer stays inside a list item. */
  indent: string;
  /** The opening run of backticks or tildes. */
  marker: string;
  /** The opening line as written, for reopening a fence on the next page. */
  open: string;
  info: string;
}

function openingFence(line: string): Fence | undefined {
  const match = FENCE.exec(line);
  if (!match) return undefined;
  const marker = match[1] ?? "```";
  return {
    indent: /^ */.exec(line)?.[0] ?? "",
    marker,
    open: line.trim(),
    info: match[2] ?? "",
  };
}

function closesFence(line: string, fence: Fence): boolean {
  const trimmed = line.trim();
  const character = fence.marker[0] ?? "`";
  if (trimmed.length < fence.marker.length) return false;
  for (const point of trimmed) if (point !== character) return false;
  return /^ {0,3}\S/.test(line);
}

/** The line that closes `fence` inside the container it was opened in. */
function closer(fence: Fence): string {
  return `${fence.indent}${fence.marker}`;
}

/** The fence `text` ends inside, if any (CommonMark fence rules). */
function fenceAtEnd(text: string): Fence | undefined {
  let fence: Fence | undefined;
  for (const line of text.split("\n")) {
    if (fence) {
      if (closesFence(line, fence)) fence = undefined;
    } else {
      fence = openingFence(line);
    }
  }
  return fence;
}

/** Closes a fence the text ends inside, so the message is self-contained. */
export function closeOpenFence(text: string): string {
  const fence = fenceAtEnd(text);
  return fence ? `${text}\n${closer(fence)}` : text;
}

const ATX_HEADING = /^ {0,3}#{1,6}(?:\s+(.*?))?\s*$/;
const SETEXT_UNDERLINE = /^ {0,3}(?:=+|-+)\s*$/;
const IMAGE = /!\[([^\]]*)\]\([^)]*\)/g;
// A GFM delimiter row: `| --- | :-: |` (one dash per cell is enough).
const TABLE_DELIMITER = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;
const HTML_BLOCK = /^( {0,3})<(?=pre|script|style|textarea|!--|\?|!\[)/i;

function headingText(line: string): string | undefined {
  const match = ATX_HEADING.exec(line);
  if (!match) return undefined;
  const text = (match[1] ?? "")
    .replace(/\s+#+\s*$/, "")
    .replace(/^#+$/, "")
    .replace(IMAGE, "$1")
    .trim();
  const bold = /^\*\*(.+)\*\*$/.exec(text);
  return (bold?.[1] ?? text).trim();
}

/** The cells of a table line, split at unescaped pipes as GFM does. */
function splitCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/(?<!\\)\|$/, "")
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim());
}

/** A table line flattened to `a · b · c` (tables wider than a phone). */
function tableCells(line: string): string {
  return splitCells(line)
    .map((cell) => cell.replace(/\\\|/g, "|"))
    .filter((cell) => cell.length > 0)
    .join(" · ");
}

/** A table line rebuilt with outer pipes and every cell dot-guarded. */
function tableLine(line: string): string {
  return `| ${splitCells(line)
    .map((cell) => (cell ? neutraliseMarkdownLine(cell) : " "))
    .join(" | ")} |`;
}

/** Tables up to this many columns fit a phone and are kept as tables. */
const TABLE_COLUMNS_MAX = 3;

function isTableDelimiter(line: string | undefined): boolean {
  return (
    line !== undefined &&
    line.includes("-") &&
    line.includes("|") &&
    TABLE_DELIMITER.test(line)
  );
}

/**
 * The agent's Markdown, contained so it renders in WeChat but cannot break
 * Pine's layout: fences are closed, headings become bold lines, tables of up
 * to three columns stay tables (each cell dot-guarded, a blank line on both
 * sides) and wider ones become `a · b` rows, images become their alt text,
 * HTML blocks that would only end at a closing tag are escaped, and dot-led
 * lines get `NEUTRAL_MARK`.
 */
export function agentMarkdown(markdown: string, lang: ReplyLanguage): string {
  const source = markdown
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, "  ")
    .replace(SEARCH_MARKERS, "")
    .replace(INVISIBLE, (character) => (character === "\n" ? character : ""))
    .split("\n");
  const out: string[] = [];
  let fence: (Fence & { openui: boolean }) | undefined;
  // `undefined` outside a table; otherwise whether it is kept as a table.
  let inTable: { keep: boolean } | undefined;

  for (let index = 0; index < source.length; index += 1) {
    const line = source[index] ?? "";
    if (fence) {
      if (closesFence(line, fence)) {
        if (!fence.openui) out.push(closer(fence));
        fence = undefined;
      } else if (!fence.openui) {
        out.push(neutraliseMarkdownLine(line.trimEnd()));
      }
      continue;
    }
    const open = openingFence(line);
    if (open) {
      if (inTable?.keep) out.push("");
      inTable = undefined;
      const openui = open.info.toLowerCase() === "openui";
      fence = { ...open, openui };
      if (openui) out.push(OPENUI_PLACEHOLDER[lang]);
      else out.push(line.trimEnd());
      continue;
    }
    if (inTable) {
      if (line.includes("|") && line.trim() !== "") {
        out.push(
          inTable.keep
            ? tableLine(line)
            : neutraliseMarkdownLine(tableCells(line)),
        );
        continue;
      }
      // GFM would read a following text line as one more row.
      if (inTable.keep && line.trim() !== "") out.push("");
      inTable = undefined;
    }
    const delimiter = source[index + 1];
    if (line.includes("|") && isTableDelimiter(delimiter)) {
      const keep = splitCells(line).length <= TABLE_COLUMNS_MAX;
      inTable = { keep };
      if (keep) {
        const previous = out.at(-1);
        if (previous !== undefined && previous.trim() !== "") out.push("");
        out.push(tableLine(line), (delimiter ?? "").trim());
      } else {
        out.push(neutraliseMarkdownLine(tableCells(line)));
      }
      index += 1;
      continue;
    }
    const heading = headingText(line);
    if (heading !== undefined) {
      out.push(heading ? neutraliseMarkdownLine(`**${heading}**`) : "");
      continue;
    }
    if (SETEXT_UNDERLINE.test(line)) {
      const previous = out.at(-1);
      if (previous !== undefined && previous.trim() !== "") out.push("");
      out.push(line.trim());
      continue;
    }
    const text = line
      .replace(IMAGE, "$1")
      .replace(HTML_BLOCK, "$1\\<")
      .trimEnd();
    out.push(neutraliseMarkdownLine(text));
  }
  if (fence && !fence.openui) out.push(closer(fence));

  return out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^(?:[ \t]*\n)+/, "")
    .trimEnd();
}

function cutPoint(points: readonly string[], limit: number): number {
  const window = points.slice(0, limit + 1).join("");
  for (const separator of ["\n\n", "\n", " "]) {
    const index = window.lastIndexOf(separator);
    if (index > 0) {
      const length = codePointLength(window.slice(0, index));
      if (length >= limit / 3 && length <= limit) return length;
    }
  }
  return limit;
}

/**
 * Cuts Markdown to at most `max` code points at a paragraph, line or word
 * boundary. A cut text ends with `…`, and a fence it ends inside is closed.
 */
export function cutMarkdown(
  markdown: string,
  max: number,
): { text: string; cut: boolean } {
  if (codePointLength(markdown) <= max) return { text: markdown, cut: false };
  const points = Array.from(markdown);
  let limit = max - 1;
  for (let attempt = 0; attempt < 3 && limit > 0; attempt += 1) {
    const head = points.slice(0, cutPoint(points, limit)).join("").trimEnd();
    const fence = fenceAtEnd(head);
    // After a table row, `…` would read as one more cell; it goes below.
    const mark = !fence && tableAtEnd(head) ? "\n\n…" : "…";
    const text = fence ? `${head}…\n${closer(fence)}` : `${head}${mark}`;
    if (codePointLength(text) <= max) return { text, cut: true };
    limit = max - (fence ? closer(fence).length + 2 : mark.length);
    if (attempt > 0) limit -= attempt * 4;
  }
  return { text: truncate(markdown, max), cut: true };
}

/** Room `paginateMarkdown` keeps on a page for a reopened and closed fence. */
const FENCE_RESERVE = 24;
/** Room kept on a page for a repeated table header; a longer one is not repeated. */
const TABLE_RESERVE = 160;

interface TableHead {
  header: string;
  delimiter: string;
}

/** The table whose rows `text` ends with, outside fences, if any. */
function tableAtEnd(text: string): TableHead | undefined {
  const lines = text.split("\n");
  let fence: Fence | undefined;
  let table: TableHead | undefined;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (fence) {
      if (closesFence(line, fence)) fence = undefined;
      continue;
    }
    fence = openingFence(line);
    if (fence) {
      table = undefined;
      continue;
    }
    if (table) {
      if (line.includes("|") && line.trim() !== "") continue;
      table = undefined;
    }
    const delimiter = lines[index + 1];
    if (line.includes("|") && isTableDelimiter(delimiter)) {
      table = { header: line, delimiter: delimiter ?? "" };
      index += 1;
    }
  }
  return table;
}

/**
 * Splits Markdown into pages of at most `max` code points. A fence that runs
 * across pages is closed at the end of one page and reopened, with its info
 * string, at the start of the next; a table that runs across pages repeats
 * its header row.
 */
export function paginateMarkdown(markdown: string, max: number): string[] {
  const pages: string[] = [];
  const hasTable = markdown.split("\n").some(isTableDelimiter);
  // A small page keeps most of its room for text.
  const tableRoom = hasTable ? Math.min(TABLE_RESERVE, Math.floor(max / 4)) : 0;
  const size = max - FENCE_RESERVE - tableRoom;
  let carried: Fence | undefined;
  let carriedTable: TableHead | undefined;
  let lastLine = "";
  for (const raw of paginate(markdown, Math.max(1, size))) {
    let [first = "", ...rest] = raw.split("\n");
    let reopen = "";
    if (carried && closesFence(first, carried)) {
      // The page starts with the fence's own closing line: nothing to reopen.
      [first = "", ...rest] = rest;
    } else if (carried) {
      reopen = `${carried.indent}${carried.marker}${truncate(carried.info, 12)}\n`;
    } else if (hasTable) {
      reopen = repeatedHeader(
        carriedTable,
        lastLine,
        first,
        rest[0],
        tableRoom,
      );
    }
    const body = [neutraliseMarkdownLine(first), ...rest].join("\n").trim();
    if (!body) {
      carried = undefined;
      carriedTable = undefined;
      continue;
    }
    const page = `${reopen}${body}`;
    const open = fenceAtEnd(page);
    pages.push(open ? `${page}\n${closer(open)}` : page);
    carried = open;
    carriedTable = open ? undefined : tableAtEnd(page);
    lastLine = page.slice(page.lastIndexOf("\n") + 1);
  }
  return pages;
}

/**
 * The header a page repeats when it starts inside a table: the header and
 * delimiter rows when it starts with a row, or the previous page's last line
 * when the split fell between a header and its delimiter row.
 */
function repeatedHeader(
  table: TableHead | undefined,
  lastLine: string,
  first: string,
  second: string | undefined,
  room: number,
): string {
  if (!first.includes("|")) return "";
  let head = "";
  if (isTableDelimiter(first)) {
    if (lastLine.includes("|")) head = `${lastLine}\n`;
  } else if (table && !isTableDelimiter(second)) {
    head = `${table.header}\n${table.delimiter}\n`;
  }
  return codePointLength(head) <= room ? head : "";
}
