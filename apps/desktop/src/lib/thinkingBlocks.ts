/**
 * Incremental Markdown block splitter for streaming thinking.
 *
 * The live thinking view shows one Markdown block (paragraph, list, heading
 * section or code block) at a time. Thinking text only grows by appending, so
 * the splitter resumes from the last complete line it classified: each update
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

function initialState(): ThinkingBlockState {
  return {
    blockStart: 0,
    blockIndex: 0,
    lineStart: 0,
    pendingBreak: false,
    hasContent: false,
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
function startBlockAt(state: ThinkingBlockState, offset: number): void {
  if (state.blockStart === offset) return;
  state.blockStart = offset;
  state.blockIndex += 1;
}

function classifyLine(
  state: ThinkingBlockState,
  line: string,
  offset: number,
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
    state.blockStart = offset;
  } else if (state.pendingBreak || HEADING.test(line)) {
    startBlockAt(state, offset);
  }
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

/** Starts the new block at a partial line as soon as it is clearly one. */
function classifyPartialLine(
  state: ThinkingBlockState,
  line: string,
  offset: number,
): void {
  if (state.fence || !NON_WHITESPACE.test(line)) return;
  if (!state.hasContent) {
    state.blockStart = offset;
    return;
  }
  if (state.pendingBreak || PARTIAL_HEADING.test(line))
    startBlockAt(state, offset);
}

function canResume(state: ThinkingBlockState, text: string): boolean {
  if (text.length < state.length) return false;
  return text.startsWith(state.probe, state.lineStart - state.probe.length);
}

export function advanceThinkingBlocks(
  previous: ThinkingBlockState | undefined,
  text: string,
): ThinkingBlockState {
  const state: ThinkingBlockState =
    previous && canResume(previous, text) ? { ...previous } : initialState();
  let lineStart = state.lineStart;
  for (
    let newline = text.indexOf("\n", lineStart);
    newline !== -1;
    newline = text.indexOf("\n", lineStart)
  ) {
    classifyLine(state, text.slice(lineStart, newline), lineStart);
    lineStart = newline + 1;
  }
  state.lineStart = lineStart;
  if (lineStart < text.length)
    classifyPartialLine(state, text.slice(lineStart), lineStart);
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
