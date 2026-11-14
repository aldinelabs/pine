import type { BaseNode } from "markstream-vue";
import type { AttachmentSelection } from "@/shared/attachments";

/** Rendered Markdown elements whose text is not part of the source (toolbars, gutters, controls). */
export const filePreviewExcluded =
  '[data-slot="code-block-toolbar"], [aria-hidden="true"], button';

/** Read a browser text selection contained by a rendered document preview. */
export function documentPreviewSelection(
  root: HTMLElement,
  label: string,
): AttachmentSelection | undefined {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return;
  const range = selection.getRangeAt(0);
  if (
    !root.contains(range.startContainer) ||
    !root.contains(range.endContainer)
  ) {
    return;
  }
  const text = range.toString();
  if (!text.trim()) return;
  return {
    startLine: 1,
    endLine: text.replace(/\r\n|\r/g, "\n").split("\n").length,
    label,
    text,
  };
}

/** Read the window selection when it is contained in this preview. */
export function filePreviewSelection(
  root: HTMLElement,
  source: string,
  nodes?: BaseNode[],
): AttachmentSelection | undefined {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return;
  return filePreviewRangeSelection(
    root,
    selection.getRangeAt(0),
    source,
    nodes,
  );
}

/** Map a range contained in this preview to source lines, excluding gutters and controls. */
export function filePreviewRangeSelection(
  root: HTMLElement,
  range: Range,
  source: string,
  nodes?: BaseNode[],
): AttachmentSelection | undefined {
  if (
    range.collapsed ||
    !root.contains(range.startContainer) ||
    !root.contains(range.endContainer)
  ) {
    return;
  }
  const text = range.toString();
  if (!text) return;

  if (!nodes) {
    const code = root.querySelector("pre code");
    if (
      !code?.contains(range.startContainer) ||
      !code.contains(range.endContainer)
    ) {
      return;
    }
    const prefix = range.cloneRange();
    prefix.selectNodeContents(code);
    prefix.setEnd(range.startContainer, range.startOffset);
    const start = prefix.toString().replace(/\r\n|\r/g, "\n");
    const selected = text.replace(/\r\n|\r/g, "\n");
    return {
      startLine: start.split("\n").length,
      // A selection ending at the next line's column zero excludes that line.
      endLine: (start + selected).replace(/\n$/, "").split("\n").length,
      text,
    };
  }

  const lines = source.replace(/\r\n|\r/g, "\n").split("\n");
  const selectedLines: number[] = [];
  const renderer = root.querySelector(".markdown-renderer");
  if (!renderer) return;
  for (const slot of renderer.children) {
    const index = slot.getAttribute("data-node-index");
    const map = index === null ? undefined : nodes[Number(index)]?.sourceMap;
    if (!map || !range.intersectsNode(slot)) continue;
    const blockSource = lines.slice(map.startLine, map.endLine).join("\n");
    const walker = document.createTreeWalker(slot, NodeFilter.SHOW_TEXT);
    let cursor = 0;
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      if (!node.data || node.parentElement?.closest(filePreviewExcluded))
        continue;
      // Match within each source block so repeated text elsewhere in the file
      // cannot resolve to an earlier occurrence. Inline markup is skipped.
      const offset = blockSource.indexOf(node.data, cursor);
      if (offset >= 0) cursor = offset + node.length;
      if (!range.intersectsNode(node)) continue;
      const start = node === range.startContainer ? range.startOffset : 0;
      const end = node === range.endContainer ? range.endOffset : node.length;
      if (start >= end) continue;
      if (offset < 0) {
        // Entities and other Markdown transformations may have no literal
        // source match; retain the enclosing source block's range.
        selectedLines.push(map.startLine + 1, map.endLine);
      } else {
        selectedLines.push(
          map.startLine +
            blockSource.slice(0, offset + start).split("\n").length,
          map.startLine +
            blockSource
              .slice(0, offset + end)
              .replace(/\n$/, "")
              .split("\n").length,
        );
      }
    }
  }
  if (!selectedLines.length) return;
  return {
    startLine: Math.min(...selectedLines),
    endLine: Math.max(...selectedLines),
    text,
  };
}
