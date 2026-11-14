/**
 * Text positions inside a preview root, for comments that point at a passage.
 * An offset counts the characters of the root's text nodes in document order,
 * skipping text inside elements that match an `excluded` selector (gutters,
 * line numbers, buttons). Roots may live in an iframe, so every Range and
 * TreeWalker comes from the root's own document.
 */
export const ANNOTATION_CONTEXT_LENGTH = 32;

export interface TextOffsets {
  start: number;
  end: number;
}

export interface TextAnchor extends TextOffsets {
  /** The text between the offsets. */
  exact: string;
  /** Up to 32 characters before and after, for finding it again. */
  prefix: string;
  suffix: string;
}

const TEXT_NODE = 3;
// NodeFilter constants, spelled out so they don't depend on a window.
const SHOW_ELEMENT = 0x1;
const SHOW_TEXT = 0x4;
const FILTER_ACCEPT = 1;
const FILTER_REJECT = 2;
const FILTER_SKIP = 3;
const START_TO_START = 0;

/** The included text of a root, built once per call. */
interface TextIndex {
  root: HTMLElement;
  nodes: Text[];
  /** Offset of each node's first character. */
  starts: number[];
  /** Position of each node in `nodes`. */
  positions: Map<Text, number>;
  text: string;
}

export function annotationTextNodes(
  root: HTMLElement,
  excluded?: string,
): Text[] {
  const nodes: Text[] = [];
  const walker = root.ownerDocument.createTreeWalker(
    root,
    SHOW_ELEMENT | SHOW_TEXT,
    {
      acceptNode: (node) => {
        if (node.nodeType === TEXT_NODE) return FILTER_ACCEPT;
        // Rejecting an excluded element skips its whole subtree.
        return excluded && (node as Element).matches(excluded)
          ? FILTER_REJECT
          : FILTER_SKIP;
      },
    },
  );
  for (let node = walker.nextNode(); node; node = walker.nextNode())
    nodes.push(node as Text);
  return nodes;
}

function buildIndex(root: HTMLElement, excluded?: string): TextIndex {
  const nodes = annotationTextNodes(root, excluded);
  const starts: number[] = [];
  const positions = new Map<Text, number>();
  const parts: string[] = [];
  let total = 0;
  nodes.forEach((node, index) => {
    starts.push(total);
    positions.set(node, index);
    parts.push(node.data);
    total += node.data.length;
  });
  return { root, nodes, starts, positions, text: parts.join("") };
}

export function annotationText(root: HTMLElement, excluded?: string): string {
  return buildIndex(root, excluded).text;
}

/**
 * The offset of a DOM boundary point: inside an included text node, its own
 * position; anywhere else (an element, excluded text, outside root), the
 * start of the first included text node after it.
 */
function boundaryOffset(
  index: TextIndex,
  container: Node,
  offset: number,
): number | undefined {
  const { nodes, starts, text } = index;
  if (container.nodeType === TEXT_NODE) {
    const position = index.positions.get(container as Text);
    if (position !== undefined)
      return (
        starts[position] +
        Math.min(Math.max(offset, 0), nodes[position].data.length)
      );
  }
  const document = index.root.ownerDocument;
  if (container.ownerDocument !== document && container !== document)
    return undefined;
  const point = document.createRange();
  const nodeStart = document.createRange();
  try {
    point.setStart(container, offset);
  } catch {
    return undefined;
  }
  // Binary search for the first node whose start is at or after the point.
  let low = 0;
  let high = nodes.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    nodeStart.setStart(nodes[middle], 0);
    nodeStart.collapse(true);
    if (point.compareBoundaryPoints(START_TO_START, nodeStart) <= 0)
      high = middle;
    else low = middle + 1;
  }
  return low < nodes.length ? starts[low] : text.length;
}

function offsetsIn(index: TextIndex, range: Range): TextOffsets | undefined {
  const start = boundaryOffset(index, range.startContainer, range.startOffset);
  const end = boundaryOffset(index, range.endContainer, range.endOffset);
  if (start === undefined || end === undefined || end <= start)
    return undefined;
  return { start, end };
}

export function rangeOffsets(
  root: HTMLElement,
  range: Range,
  excluded?: string,
): TextOffsets | undefined {
  return offsetsIn(buildIndex(root, excluded), range);
}

/** The last node whose start is at or before `offset`, skipping empty ones. */
function nodeAt(
  index: TextIndex,
  offset: number,
  atEnd: boolean,
): number | undefined {
  const { nodes, starts } = index;
  let low = 0;
  let high = nodes.length;
  // First node whose start is past the offset (or at it, for an end).
  while (low < high) {
    const middle = (low + high) >> 1;
    const past = atEnd ? starts[middle] >= offset : starts[middle] > offset;
    if (past) high = middle;
    else low = middle + 1;
  }
  for (let position = low - 1; position >= 0; position -= 1) {
    const length = nodes[position].data.length;
    if (atEnd ? offset <= starts[position] + length : length > 0)
      return position;
  }
  return undefined;
}

function rangeIn(index: TextIndex, { start, end }: TextOffsets) {
  if (start < 0 || end <= start || end > index.text.length) return undefined;
  const first = nodeAt(index, start, false);
  const last = nodeAt(index, end, true);
  if (first === undefined || last === undefined) return undefined;
  const range = index.root.ownerDocument.createRange();
  range.setStart(index.nodes[first], start - index.starts[first]);
  range.setEnd(index.nodes[last], end - index.starts[last]);
  return range;
}

export function rangeFromOffsets(
  root: HTMLElement,
  offsets: TextOffsets,
  excluded?: string,
): Range | undefined {
  return rangeIn(buildIndex(root, excluded), offsets);
}

function anchorAt(text: string, { start, end }: TextOffsets): TextAnchor {
  return {
    start,
    end,
    exact: text.slice(start, end),
    prefix: text.slice(Math.max(0, start - ANNOTATION_CONTEXT_LENGTH), start),
    suffix: text.slice(end, end + ANNOTATION_CONTEXT_LENGTH),
  };
}

/** The anchor for a range inside root, or undefined when it holds no non-blank text. */
export function createTextAnchor(
  root: HTMLElement,
  range: Range,
  excluded?: string,
): TextAnchor | undefined {
  const index = buildIndex(root, excluded);
  const offsets = offsetsIn(index, range);
  if (!offsets) return undefined;
  const anchor = anchorAt(index.text, offsets);
  return anchor.exact.trim() ? anchor : undefined;
}

/** How many characters of `context` match the text around a candidate. */
function contextScore(
  text: string,
  start: number,
  end: number,
  { prefix, suffix }: TextAnchor,
): number {
  let score = 0;
  while (
    score < prefix.length &&
    start - score - 1 >= 0 &&
    text[start - score - 1] === prefix[prefix.length - score - 1]
  )
    score += 1;
  let after = 0;
  while (
    after < suffix.length &&
    end + after < text.length &&
    text[end + after] === suffix[after]
  )
    after += 1;
  return score + after;
}

/**
 * Finds an anchor in the current text: at its offsets when the text there is
 * still `exact`; otherwise the occurrence of `exact` whose surroundings match
 * the most of prefix (scored from its end) and suffix (from its start), ties
 * going to the one nearest the old start. Undefined when `exact` is gone.
 */
export function locateTextAnchor(
  root: HTMLElement,
  anchor: TextAnchor,
  excluded?: string,
): { anchor: TextAnchor; range: Range } | undefined {
  const { exact } = anchor;
  if (!exact) return undefined;
  const index = buildIndex(root, excluded);
  const { text } = index;
  let best: number | undefined;
  if (text.slice(anchor.start, anchor.end) === exact) best = anchor.start;
  else {
    let bestScore = -1;
    let bestDistance = Infinity;
    for (
      let start = text.indexOf(exact);
      start >= 0;
      start = text.indexOf(exact, start + 1)
    ) {
      const score = contextScore(text, start, start + exact.length, anchor);
      const distance = Math.abs(start - anchor.start);
      if (
        score > bestScore ||
        (score === bestScore && distance < bestDistance)
      ) {
        best = start;
        bestScore = score;
        bestDistance = distance;
      }
    }
  }
  if (best === undefined) return undefined;
  const offsets = { start: best, end: best + exact.length };
  const range = rangeIn(index, offsets);
  return range ? { anchor: anchorAt(text, offsets), range } : undefined;
}
