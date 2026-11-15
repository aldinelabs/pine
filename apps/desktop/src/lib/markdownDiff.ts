import { diffArrays } from "diff";
import removeMarkdown from "remove-markdown";

/** The slice of markdown-it this module reads; keeps it free of the renderer. */
export interface MarkdownBlockParser {
  parse(
    source: string,
    env?: Record<string, unknown>,
  ): {
    type: string;
    tag: string;
    level: number;
    nesting: number;
    map: [number, number] | null;
    markup: string;
  }[];
}

type TextKind = "heading" | "paragraph" | "listItem";

/**
 * One top-level block of a Markdown document: a heading, a paragraph, one
 * item of a top-level list (with anything nested in it), or any other block
 * (table, code, math, quote, rule, HTML) as a whole.
 */
export interface MarkdownBlock {
  kind: TextKind | "other";
  /** Its lines in the document, end exclusive. */
  start: number;
  end: number;
  /** A heading's level. */
  level?: number;
  /** What is compared: the source with runs of whitespace collapsed. */
  key: string;
}

export interface MarkdownDiffPart {
  type: "same" | "added" | "removed";
  text: string;
}

export type MarkdownDiffSegment =
  | {
      /** Blocks shown as Markdown: unchanged, only in the new version, or only in the old one. */
      type: "same" | "added" | "removed";
      source: string;
    }
  | {
      /** A heading, paragraph or list item that was edited, as text with its word changes. */
      type: "changed";
      kind: TextKind;
      level?: number;
      /** A list item's marker ("-", "1."). */
      marker?: string;
      parts: MarkdownDiffPart[];
    };

function blockKind(type: string): MarkdownBlock["kind"] {
  if (type === "heading_open") return "heading";
  if (type === "paragraph_open") return "paragraph";
  return "other";
}

/** Splits a document into the blocks a diff compares. */
export function markdownBlocks(
  parser: MarkdownBlockParser,
  text: string,
): MarkdownBlock[] {
  const lines = text.split("\n");
  const blocks: MarkdownBlock[] = [];
  let inList = false;
  const add = (
    kind: MarkdownBlock["kind"],
    map: [number, number],
    level?: number,
  ) => {
    let end = map[1];
    // A block's range can take in the blank lines after it.
    while (end > map[0] + 1 && !lines[end - 1]?.trim()) end -= 1;
    const source = lines.slice(map[0], end).join("\n");
    blocks.push({
      kind,
      start: map[0],
      end,
      ...(level === undefined ? {} : { level }),
      key: `${kind}:${source.replace(/\s+/g, " ").trim()}`,
    });
  };
  for (const token of parser.parse(text, {})) {
    if (token.level === 0 && token.nesting === -1) {
      if (
        token.type === "bullet_list_close" ||
        token.type === "ordered_list_close"
      )
        inList = false;
      continue;
    }
    if (!token.map || token.nesting === -1) continue;
    if (token.level === 0) {
      if (
        token.type === "bullet_list_open" ||
        token.type === "ordered_list_open"
      ) {
        inList = true;
        continue;
      }
      const kind = blockKind(token.type);
      add(
        kind,
        token.map,
        kind === "heading" ? Number(token.tag.slice(1)) || 1 : undefined,
      );
    } else if (inList && token.level === 1 && token.type === "list_item_open") {
      add("listItem", token.map);
    }
  }
  return blocks;
}

/** Words, spaces and punctuation, with Chinese and Japanese split into words. */
function words(text: string): string[] {
  if (typeof Intl.Segmenter === "function") {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "word" });
    return [...segmenter.segment(text)].map(({ segment }) => segment);
  }
  return text.split(/(\s+|[^\p{L}\p{N}_])/u).filter(Boolean);
}

/** The block's readable text, without Markdown syntax or its own marker. */
function plainText(source: string): string {
  return removeMarkdown(source, { gfm: true, useImgAltText: true })
    .replace(/\s*\n\s*/g, " ")
    .trim();
}

function listMarker(source: string): string | undefined {
  return /^\s*([-*+]|\d+[.)])\s/.exec(source)?.[1];
}

/** Word changes from `before` to `after`, and how much of the text stayed. */
export function diffWords(
  before: string,
  after: string,
): { parts: MarkdownDiffPart[]; kept: number } {
  const parts: MarkdownDiffPart[] = [];
  let same = 0;
  for (const change of diffArrays(words(before), words(after))) {
    const text = change.value.join("");
    const type = change.added ? "added" : change.removed ? "removed" : "same";
    if (type === "same") same += text.length;
    const last = parts.at(-1);
    if (last?.type === type) last.text += text;
    else parts.push({ type, text });
  }
  return {
    parts,
    kept: same / Math.max(before.length, after.length, 1),
  };
}

/** Below this share of unchanged text, an edit reads as a rewrite. */
const MIN_KEPT = 0.3;

/**
 * The changes from `before` to `after` as a sequence to render: runs of
 * blocks shown as Markdown, and edited text blocks with their word changes.
 */
export function diffMarkdown(
  parser: MarkdownBlockParser,
  before: string,
  after: string,
): MarkdownDiffSegment[] {
  const oldLines = before.split("\n");
  const newLines = after.split("\n");
  const oldBlocks = markdownBlocks(parser, before);
  const newBlocks = markdownBlocks(parser, after);
  const sourceOf = (block: MarkdownBlock, lines: string[]) =>
    lines.slice(block.start, block.end).join("\n");

  type Run = { type: "same" | "added" | "removed"; blocks: MarkdownBlock[] };
  const runs: (Run | Extract<MarkdownDiffSegment, { type: "changed" }>)[] = [];
  const push = (type: Run["type"], block: MarkdownBlock) => {
    const last = runs.at(-1);
    if (last?.type === type) last.blocks.push(block);
    else runs.push({ type, blocks: [block] });
  };

  const changes = diffArrays(oldBlocks, newBlocks, {
    comparator: (a, b) => a.key === b.key,
  });
  // Where each change starts in either document.
  let oldAt = 0;
  let newAt = 0;
  for (let index = 0; index < changes.length; index += 1) {
    const change = changes[index];
    const count = change.count ?? change.value.length;
    if (!change.added && !change.removed) {
      // Equal blocks are shown as they are now.
      for (const block of newBlocks.slice(newAt, newAt + count))
        push("same", block);
      oldAt += count;
      newAt += count;
      continue;
    }
    const next = changes[index + 1];
    let removed: MarkdownBlock[] = [];
    let added: MarkdownBlock[] = [];
    if (change.removed) {
      removed = oldBlocks.slice(oldAt, oldAt + count);
      oldAt += count;
      if (next?.added) {
        const nextCount = next.count ?? next.value.length;
        added = newBlocks.slice(newAt, newAt + nextCount);
        newAt += nextCount;
        index += 1;
      }
    } else {
      added = newBlocks.slice(newAt, newAt + count);
      newAt += count;
    }
    // Pair the edited blocks in order; what does not pair is removed or added.
    const pairs = Math.min(removed.length, added.length);
    const leftover: { removed: MarkdownBlock[]; added: MarkdownBlock[] } = {
      removed: [],
      added: [],
    };
    for (let at = 0; at < pairs; at += 1) {
      const old = removed[at];
      const now = added[at];
      const oldSource = sourceOf(old, oldLines);
      const newSource = sourceOf(now, newLines);
      const comparable =
        old.kind === now.kind &&
        old.kind !== "other" &&
        (old.kind !== "heading" || old.level === now.level);
      const edit = comparable
        ? diffWords(plainText(oldSource), plainText(newSource))
        : undefined;
      if (edit && edit.kept >= MIN_KEPT) {
        // Removals and additions before an edit keep their place.
        for (const block of leftover.removed) push("removed", block);
        for (const block of leftover.added) push("added", block);
        leftover.removed = [];
        leftover.added = [];
        const marker =
          now.kind === "listItem" ? listMarker(newSource) : undefined;
        runs.push({
          type: "changed",
          kind: now.kind as TextKind,
          ...(now.level === undefined ? {} : { level: now.level }),
          ...(marker ? { marker } : {}),
          parts: edit.parts,
        });
      } else {
        leftover.removed.push(old);
        leftover.added.push(now);
      }
    }
    for (const block of [...leftover.removed, ...removed.slice(pairs)])
      push("removed", block);
    for (const block of [...leftover.added, ...added.slice(pairs)])
      push("added", block);
  }

  // A run of blocks is one stretch of its document, rendered from its source.
  return runs.map((run) => {
    if (run.type === "changed") return run;
    const lines = run.type === "removed" ? oldLines : newLines;
    const first = run.blocks[0];
    const last = run.blocks[run.blocks.length - 1];
    const contiguous = run.blocks.every(
      (block, at) => at === 0 || block.start >= run.blocks[at - 1].end,
    );
    return {
      type: run.type,
      source: contiguous
        ? lines.slice(first.start, last.end).join("\n")
        : run.blocks.map((block) => sourceOf(block, lines)).join("\n\n"),
    };
  });
}
