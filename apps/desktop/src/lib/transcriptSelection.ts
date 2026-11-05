/**
 * Text positions inside a transcript message. A position counts characters
 * of the message's prose only (the markdown of a reply, the text of a user
 * bubble), never tool markers or buttons, whose text changes while they run.
 * The same message renders the same prose again, so offsets survive reloads.
 */
export const TRANSCRIPT_PROSE_SELECTOR =
  '.transcript-prose, [data-slot="user-message-text"]';

const MESSAGE_SELECTOR = "[data-message-id]";

export interface TranscriptTextRange {
  start: number;
  end: number;
}

export interface TranscriptSelection extends TranscriptTextRange {
  messageId: string;
  /** The message element the offsets count in. */
  root: HTMLElement;
  /** The prose characters between the offsets. */
  text: string;
  /** The selection as the user sees it, with line breaks between blocks. */
  quote: string;
  range: Range;
}

function elementOf(node: Node): Element | null {
  return node instanceof Element ? node : node.parentElement;
}

/** The prose text nodes of a message, in document order. */
export function proseTextNodes(root: HTMLElement): Text[] {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      const prose = node.parentElement?.closest(TRANSCRIPT_PROSE_SELECTOR);
      return prose && root.contains(prose)
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    },
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode())
    nodes.push(node as Text);
  return nodes;
}

export function proseText(root: HTMLElement): string {
  return proseTextNodes(root)
    .map((node) => node.data)
    .join("");
}

/** The prose offset of a DOM boundary point, or undefined outside prose. */
function boundaryOffset(
  nodes: readonly Text[],
  container: Node,
  offset: number,
): number | undefined {
  let total = 0;
  const point = document.createRange();
  point.setStart(container, offset);
  for (const node of nodes) {
    if (node === container) return total + offset;
    // The boundary sits before this node: everything counted so far is in.
    const nodeRange = document.createRange();
    nodeRange.selectNodeContents(node);
    if (point.compareBoundaryPoints(Range.START_TO_START, nodeRange) <= 0)
      return total;
    total += node.data.length;
  }
  return nodes.length > 0 ? total : undefined;
}

export function rangeOffsets(
  root: HTMLElement,
  range: Range,
): TranscriptTextRange | undefined {
  const nodes = proseTextNodes(root);
  const start = boundaryOffset(nodes, range.startContainer, range.startOffset);
  const end = boundaryOffset(nodes, range.endContainer, range.endOffset);
  if (start === undefined || end === undefined || end <= start)
    return undefined;
  return { start, end };
}

export function rangeFromOffsets(
  root: HTMLElement,
  { start, end }: TranscriptTextRange,
): Range | undefined {
  const nodes = proseTextNodes(root);
  const range = document.createRange();
  let total = 0;
  let started = false;
  for (const node of nodes) {
    const length = node.data.length;
    if (!started && start <= total + length && start - total < length) {
      range.setStart(node, start - total);
      started = true;
    }
    if (started && end <= total + length) {
      range.setEnd(node, end - total);
      return range;
    }
    total += length;
  }
  return undefined;
}

/**
 * Finds a saved passage again: at its offsets when the prose there still
 * reads the same, otherwise at its first occurrence.
 */
export function locatePassage(
  root: HTMLElement,
  passage: TranscriptTextRange & { text: string },
): Range | undefined {
  const text = proseText(root);
  if (text.slice(passage.start, passage.end) === passage.text)
    return rangeFromOffsets(root, passage);
  const start = text.indexOf(passage.text);
  if (start < 0 || !passage.text) return undefined;
  return rangeFromOffsets(root, { start, end: start + passage.text.length });
}

export function rangesOverlap(
  first: TranscriptTextRange,
  second: TranscriptTextRange,
): boolean {
  return first.start < second.end && second.start < first.end;
}

/** The selection, when it lies in the prose of one transcript message. */
export function transcriptSelection(
  selection: Selection | null,
  container: HTMLElement,
): TranscriptSelection | undefined {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0)
    return undefined;
  const range = selection.getRangeAt(0);
  const start = elementOf(range.startContainer);
  const end = elementOf(range.endContainer);
  const root = start?.closest<HTMLElement>(MESSAGE_SELECTOR);
  if (!root || !container.contains(root)) return undefined;
  if (end?.closest(MESSAGE_SELECTOR) !== root) return undefined;
  const messageId = root.dataset.messageId;
  if (!messageId) return undefined;
  const offsets = rangeOffsets(root, range);
  if (!offsets) return undefined;
  const text = proseText(root).slice(offsets.start, offsets.end);
  const quote = selection.toString();
  if (!text.trim() || !quote.trim()) return undefined;
  return { ...offsets, messageId, root, text, quote, range };
}

/** Whether a viewport point falls on the text a range covers. */
export function rangeContainsPoint(
  range: Range,
  x: number,
  y: number,
): boolean {
  for (const rect of range.getClientRects())
    if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom)
      return true;
  return false;
}
