/**
 * Incremental Markdown block splitter for streaming thinking.
 *
 * The live thinking panel splits streaming thinking into Markdown blocks
 * (paragraph, list, heading section or code block) so only the trailing one
 * re-renders as text arrives: a block is complete when the next one starts.
 * Thinking text only grows by appending, so the splitter resumes from the last complete line it classified: each update
 * costs the new characters plus the trailing partial line, never the whole
 * text. A non-append change (shorter text, or a rewrite before the resume
 * point) rescans from the start.
 */

export interface ThinkingBlockState {
  /** Offset of the current block's first character. */
  blockStart: number;
  /** Increments each time a new block starts; used as the render key. */
  blockIndex: number;
  /** Offset of the first line not yet classified (start of the trailing partial line). */
  lineStart: number;
  /** Open fence (char + length) or open `$$` display math, else undefined. */
  fence?: { char: "`" | "~"; length: number } | "math";
  /** A blank line was seen since the last content line (outside fences). */
  pendingBreak: boolean;
  /** The current block has at least one content line. */
  hasContent: boolean;
  /** A complete line of the current block (outside fences) is a list item. */
  listBlock: boolean;
  /** Short probe (<= 32 chars ending at lineStart) to detect non-append changes. */
  probe: string;
  /** The text length the state describes. */
  length: number;
}

const PROBE_LENGTH = 32;
const HEADING = /^ {0,3}#{1,6}(?:[ \t]|$)/;
/** On a partial line only a heading followed by a space counts. */
const PARTIAL_HEADING = /^ {0,3}#{1,6}[ \t]/;
const FENCE_OPEN = /^\s*(`{3,}|~{3,})/;
const FENCE_CLOSE = /^\s*(`{3,}|~{3,})\s*$/;
const NON_WHITESPACE = /\S/;
const LEADING_WHITESPACE = /^[ \t]/;
const LIST_ITEM = /^ {0,3}(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/;
/** A partial line that may still turn into a list item. */
const PARTIAL_LIST_MARKER = /^(?:[-*+]|\d{1,9}[.)]?)$/;

/** Called with each block's start offset and index as the block starts. */
export type ThinkingBlockStartListener = (
  offset: number,
  blockIndex: number,
) => void;

function initialState(): ThinkingBlockState {
  return {
    blockStart: 0,
    blockIndex: 0,
    lineStart: 0,
    pendingBreak: false,
    hasContent: false,
    listBlock: false,
    probe: "",
    length: 0,
  };
}

function countMathDelimiters(line: string): number {
  let count = 0;
  for (
    let index = line.indexOf("$$");
    index !== -1;
    index = line.indexOf("$$", index + 2)
  )
    count += 1;
  return count;
}

/** Moves the block start to `offset`, counting a new block only once. */
function startBlockAt(
  state: ThinkingBlockState,
  offset: number,
  onBlockStart?: ThinkingBlockStartListener,
): void {
  if (state.blockStart === offset) return;
  state.blockStart = offset;
  state.blockIndex += 1;
  onBlockStart?.(offset, state.blockIndex);
}

/** Places the first block (after leading blank lines). */
function startFirstBlockAt(
  state: ThinkingBlockState,
  offset: number,
  onBlockStart?: ThinkingBlockStartListener,
): void {
  state.blockStart = offset;
  onBlockStart?.(offset, 0);
}

/**
 * After a blank line, an indented line or (inside a list) another list item
 * continues the block: a loose list or an item's continuation must stay in
 * one block to render as it does in one piece.
 */
function continuesAfterBreak(state: ThinkingBlockState, line: string): boolean {
  return (
    LEADING_WHITESPACE.test(line) || (state.listBlock && LIST_ITEM.test(line))
  );
}

function classifyLine(
  state: ThinkingBlockState,
  line: string,
  offset: number,
  onBlockStart?: ThinkingBlockStartListener,
): void {
  const fence = state.fence;
  if (fence === "math") {
    if (countMathDelimiters(line) % 2 === 1) state.fence = undefined;
    return;
  }
  if (fence) {
    const close = FENCE_CLOSE.exec(line);
    if (close && close[1][0] === fence.char && close[1].length >= fence.length)
      state.fence = undefined;
    return;
  }
  if (!NON_WHITESPACE.test(line)) {
    if (state.hasContent) state.pendingBreak = true;
    return;
  }
  if (!state.hasContent) {
    // Leading blank lines are not part of the first block.
    startFirstBlockAt(state, offset, onBlockStart);
  } else if (
    HEADING.test(line) ||
    (state.pendingBreak && !continuesAfterBreak(state, line))
  ) {
    startBlockAt(state, offset, onBlockStart);
  }
  // Any list item makes this a list block, not only a first line: a list
  // may follow an intro line, and its loose items must stay together.
  if (offset === state.blockStart) state.listBlock = false;
  if (LIST_ITEM.test(line)) state.listBlock = true;
  state.hasContent = true;
  state.pendingBreak = false;
  const open = FENCE_OPEN.exec(line);
  if (open) {
    state.fence = {
      char: open[1][0] as "`" | "~",
      length: open[1].length,
    };
    return;
  }
  const trimmed = line.trim();
  if (trimmed.startsWith("$$") && countMathDelimiters(trimmed) % 2 === 1)
    state.fence = "math";
}

/**
 * Starts the new block at a partial line as soon as it is clearly one. A
 * start here is final (the line is not re-decided once complete), so a line
 * that may still turn out to continue the block waits for its newline.
 */
function classifyPartialLine(
  state: ThinkingBlockState,
  line: string,
  offset: number,
  onBlockStart?: ThinkingBlockStartListener,
): void {
  if (state.fence || !NON_WHITESPACE.test(line)) return;
  if (!state.hasContent) {
    startFirstBlockAt(state, offset, onBlockStart);
    return;
  }
  if (PARTIAL_HEADING.test(line)) {
    startBlockAt(state, offset, onBlockStart);
    return;
  }
  if (
    !state.pendingBreak ||
    LEADING_WHITESPACE.test(line) ||
    (state.listBlock &&
      (LIST_ITEM.test(line) || PARTIAL_LIST_MARKER.test(line)))
  )
    return;
  startBlockAt(state, offset, onBlockStart);
}

/** Whether `advanceThinkingBlocks` would resume from `state` rather than rescan. */
export function canResumeThinkingBlocks(
  state: ThinkingBlockState,
  text: string,
): boolean {
  if (text.length < state.length) return false;
  return text.startsWith(state.probe, state.lineStart - state.probe.length);
}

export function advanceThinkingBlocks(
  previous: ThinkingBlockState | undefined,
  text: string,
  onBlockStart?: ThinkingBlockStartListener,
): ThinkingBlockState {
  const state: ThinkingBlockState =
    previous && canResumeThinkingBlocks(previous, text)
      ? { ...previous }
      : initialState();
  let lineStart = state.lineStart;
  for (
    let newline = text.indexOf("\n", lineStart);
    newline !== -1;
    newline = text.indexOf("\n", lineStart)
  ) {
    classifyLine(
      state,
      text.slice(lineStart, newline),
      lineStart,
      onBlockStart,
    );
    lineStart = newline + 1;
  }
  state.lineStart = lineStart;
  if (lineStart < text.length)
    classifyPartialLine(state, text.slice(lineStart), lineStart, onBlockStart);
  state.probe = text.slice(Math.max(0, lineStart - PROBE_LENGTH), lineStart);
  state.length = text.length;
  return state;
}

export function currentThinkingBlock(
  state: ThinkingBlockState,
  text: string,
): string {
  return text.slice(state.blockStart).trimEnd();
}

/** A segment's split plus the start offset of every block in it. */
export interface ThinkingSegmentSplit {
  state: ThinkingBlockState;
  /** `starts[i]` is block i's first character; one entry per block. */
  starts: number[];
}

/**
 * Advances one thinking segment and records every block boundary, including
 * several completed by one update. A resumed split extends the previous
 * `starts` array in place; a rescan starts a fresh one.
 */
export function advanceThinkingSegment(
  previous: ThinkingSegmentSplit | undefined,
  text: string,
): ThinkingSegmentSplit {
  const resumed =
    previous !== undefined && canResumeThinkingBlocks(previous.state, text);
  const starts = resumed ? previous.starts : [0];
  const state = advanceThinkingBlocks(
    resumed ? previous.state : undefined,
    text,
    (offset, blockIndex) => {
      starts.length = blockIndex + 1;
      starts[blockIndex] = offset;
    },
  );
  return { state, starts };
}

/** Block `index` of a split segment, without its trailing whitespace. */
export function thinkingSegmentBlock(
  split: ThinkingSegmentSplit,
  text: string,
  index: number,
): string {
  return text
    .slice(split.starts[index], split.starts[index + 1] ?? text.length)
    .trimEnd();
}
