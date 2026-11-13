/**
 * Block view of one streaming Markdown segment, for the transcript's
 * assistant replies.
 *
 * markstream re-parses and re-diffs its whole `source` on every update, so a
 * reply rendered in one piece costs its full length per flush. Split into
 * Markdown blocks (by the incremental splitter the live thinking panel uses),
 * only the block being written changes: completed blocks keep their source
 * and `final` and are skipped by Vue's prop check.
 *
 * A completed block turns `final` one build after it completed, so the fade
 * of the delta that ended it is not cut short by the switch.
 */
import {
  advanceThinkingSegment,
  thinkingSegmentBlock,
  type ThinkingSegmentSplit,
} from "./thinkingBlocks";

export interface MarkdownBlockItem {
  /** Stable while the block keeps its place in the segment. */
  key: string;
  source: string;
  final: boolean;
}

/** Builds the blocks of a segment as its text grows. */
export type MarkdownBlockView = (
  text: string,
  final: boolean,
) => readonly MarkdownBlockItem[];

export function createMarkdownBlockView(): MarkdownBlockView {
  let split: ThinkingSegmentSplit | undefined;
  /** Build in which each block was first seen complete. */
  let completedAt: number[] = [];
  /** Items of complete blocks, by block index, reused while unchanged. */
  let completeItems: (MarkdownBlockItem | undefined)[] = [];
  let builds = 0;
  let last:
    | { text: string; final: boolean; items: readonly MarkdownBlockItem[] }
    | undefined;

  return (text, final) => {
    if (last && last.text === text && last.final === final) return last.items;
    builds += 1;
    const previous = split;
    split = advanceThinkingSegment(previous, text);
    if (!previous || split.starts !== previous.starts) {
      // A rescan: block indices no longer name the same text.
      completedAt = [];
      completeItems = [];
    }
    const lastIndex = split.starts.length - 1;
    const items: MarkdownBlockItem[] = [];
    for (let index = 0; index <= lastIndex; index++) {
      const complete = index < lastIndex;
      let item: MarkdownBlockItem | undefined;
      if (complete) {
        completedAt[index] ??= builds;
        const blockFinal = final || completedAt[index] < builds;
        const cached = completeItems[index];
        item =
          cached?.final === blockFinal
            ? cached
            : {
                key: String(index),
                source: thinkingSegmentBlock(split, text, index),
                final: blockFinal,
              };
        completeItems[index] = item;
      } else {
        item = {
          key: String(index),
          source: thinkingSegmentBlock(split, text, index),
          final,
        };
      }
      if (item.source) items.push(item);
    }
    completedAt.length = Math.min(completedAt.length, lastIndex);
    completeItems.length = Math.min(completeItems.length, lastIndex);
    last = { text, final, items };
    return items;
  };
}

const LINK_REFERENCE_DEFINITION = /^ {0,3}\[[^\]\n]+\]:/mu;

/**
 * Whether the text uses Markdown that resolves across the whole document:
 * footnotes (`[^id]` and their definitions) or link reference definitions.
 * Split into blocks, a reference would no longer find its definition.
 */
export function hasDocumentLevelDefinitions(text: string): boolean {
  return text.includes("[^") || LINK_REFERENCE_DEFINITION.test(text);
}

/** Which neighbouring renders block `index` of `count` continues the flow of. */
export function markdownFlowJoin(
  index: number,
  count: number,
): "start" | "end" | "both" | undefined {
  if (count < 2) return undefined;
  if (index === 0) return "end";
  return index === count - 1 ? "start" : "both";
}
