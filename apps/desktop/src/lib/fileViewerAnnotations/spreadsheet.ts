import type { AnnotationCells } from "@/components/project/file-preview/previewRenderer";
import {
  spreadsheetColumnIndex,
  spreadsheetDataKey,
  spreadsheetHook,
  spreadsheetRowIndex,
  spreadsheetSelectedCells,
  type SpreadsheetTable,
} from "@/lib/spreadsheetSelection";
import type { FileViewerAnnotationAdapter } from ".";

type GridContext = NonNullable<SpreadsheetTable["ctx"]>;

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Where the cells of a range are drawn now, clipped to the grid's body, in
 * the canvas's CSS pixels. Only drawn rows count, so a range scrolled out of
 * the virtual grid has none.
 */
export function spreadsheetRangeBox(
  context: GridContext,
  cells: AnnotationCells,
): Box | undefined {
  const body = context.body;
  const top = body?.y ?? 0;
  const bottom = top + (body?.visibleHeight ?? 0);
  const width = body?.visibleWidth ?? 0;
  const fixedLeft = context.fixedLeftWidth ?? 0;
  const fixedRight = context.fixedRightWidth ?? 0;
  let box: Box | undefined;
  for (const row of body?.renderRows ?? []) {
    const rowIndex = spreadsheetRowIndex(row.data);
    if (
      rowIndex === undefined ||
      rowIndex < cells.startRow ||
      rowIndex > cells.endRow
    )
      continue;
    for (const cell of row.cells ?? []) {
      const column = spreadsheetColumnIndex(cell.key ?? cell.column?.key);
      if (
        column === undefined ||
        column < cells.startColumn ||
        column > cells.endColumn ||
        !cell.getDrawX ||
        !cell.getDrawY
      )
        continue;
      // Frozen columns stay put; the others scroll under them.
      const [minX, maxX] =
        cell.fixed === "left"
          ? [0, width]
          : cell.fixed === "right"
            ? [width - fixedRight, width]
            : [fixedLeft, width - fixedRight];
      const x = cell.getDrawX();
      const y = cell.getDrawY();
      const clipped = {
        left: Math.max(x, minX),
        top: Math.max(y, top),
        right: Math.min(x + (cell.width ?? 0), maxX),
        bottom: Math.min(y + (cell.height ?? 0), bottom),
      };
      if (clipped.right <= clipped.left || clipped.bottom <= clipped.top)
        continue;
      box = box
        ? {
            left: Math.min(box.left, clipped.left),
            top: Math.min(box.top, clipped.top),
            right: Math.max(box.right, clipped.right),
            bottom: Math.max(box.bottom, clipped.bottom),
          }
        : clipped;
    }
  }
  return box;
}

/** Whether a cell is drawn whole in the grid's body. */
function cellShown(context: GridContext, row: number, column: number): boolean {
  const cells = {
    startRow: row,
    endRow: row,
    startColumn: column,
    endColumn: column,
  };
  const box = spreadsheetRangeBox(context, cells);
  if (!box) return false;
  for (const drawn of context.body?.renderRows ?? []) {
    if (spreadsheetRowIndex(drawn.data) !== row) continue;
    const cell = drawn.cells?.find(
      (item) => spreadsheetColumnIndex(item.key ?? item.column?.key) === column,
    );
    return (
      box.right - box.left >= (cell?.width ?? 0) - 1 &&
      box.bottom - box.top >= (cell?.height ?? 0) - 1
    );
  }
  return false;
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/** The workbook's loading screen, shown while a sheet is parsed. */
const BUSY = ".excel-wrapper > .loading:not(.hidden)";

/** How long revealing waits for a sheet to load, in frames. */
const REVEAL_FRAMES = 180;
/** Frames the cells must stay shown, as a sheet restores its scroll on load. */
const SETTLED_FRAMES = 8;

/** Workbooks: comments on cell ranges of a sheet. */
export const spreadsheetAnnotations: FileViewerAnnotationAdapter = {
  renderers: ["spreadsheet-openxml", "spreadsheet-dbf", "apple-numbers"],
  capabilities: { annotateCells: true },

  cellSelection: (root) => spreadsheetSelectedCells(root),

  cellRects(root, cells) {
    const hook = spreadsheetHook(root);
    const context = hook?.table()?.ctx;
    if (!hook || !context?.containerElement) return [];
    if (cells.sheet !== undefined && cells.sheet !== hook.sheetName())
      return [];
    const box = spreadsheetRangeBox(context, cells);
    if (!box) return [];
    const origin = context.containerElement.getBoundingClientRect();
    return [
      new DOMRect(
        origin.left + box.left,
        origin.top + box.top,
        box.right - box.left,
        box.bottom - box.top,
      ),
    ];
  },

  async reveal(root, request) {
    const cells =
      request.shape?.kind === "cells" ? request.shape.cells : undefined;
    const sheet =
      cells?.sheet ??
      (request.place?.kind === "sheet" ? request.place.name : undefined);
    if (sheet !== undefined && spreadsheetHook(root)?.sheetName() !== sheet)
      [...root.querySelectorAll<HTMLElement>(".excel-wrapper .sheet-tab")]
        .find((tab) => (tab.title || tab.textContent?.trim()) === sheet)
        ?.click();
    if (!cells) return;
    const rowKey = String(cells.startRow);
    const columnKey = spreadsheetDataKey(cells.startColumn);
    // A sheet loads its rows, then restores its own scroll; keep the cells
    // in view until that has settled.
    let settled = 0;
    for (let frame = 0; frame < REVEAL_FRAMES; frame += 1) {
      await nextFrame();
      const hook = spreadsheetHook(root);
      const table = hook?.table();
      const context = table?.ctx;
      if (
        !table ||
        !context ||
        (sheet !== undefined && hook?.sheetName() !== sheet) ||
        root.querySelector(BUSY) ||
        context.database?.getRowIndexForRowKey?.(rowKey) === undefined ||
        !context.header?.leafCellHeaders?.some(
          (header) => header.key === columnKey,
        )
      )
        continue;
      if (cellShown(context, cells.startRow, cells.startColumn)) {
        settled += 1;
        if (settled >= SETTLED_FRAMES) return;
        continue;
      }
      settled = 0;
      table.scrollToRowkey?.(rowKey);
      table.scrollToColkey?.(columnKey);
    }
  },

  observe(root, changed) {
    let table: SpreadsheetTable | undefined;
    let frame = 0;
    let last = "";
    // The grid draws on a canvas: report when what it draws has moved.
    const check = () => {
      frame = 0;
      const hook = spreadsheetHook(root);
      const context = hook?.table()?.ctx;
      const rows = context?.body?.renderRows ?? [];
      const first = rows[0]?.cells?.find((cell) => cell.getDrawX);
      const state = [
        hook?.sheetName(),
        rows.length,
        spreadsheetRowIndex(rows[0]?.data),
        first?.getDrawX?.(),
        first?.getDrawY?.(),
        context?.body?.visibleWidth,
        context?.body?.visibleHeight,
        context?.fixedLeftWidth,
      ].join("|");
      if (state === last) return;
      last = state;
      changed();
    };
    const schedule = () => {
      frame ||= requestAnimationFrame(check);
    };
    const events = ["onScrollX", "onScrollY", "resize", "draw"];
    // The renderer creates its grid once the workbook is parsed and keeps it
    // across sheets; attach to whichever grid it shows.
    const attach = () => {
      const next = spreadsheetHook(root)?.table();
      if (next !== table) {
        for (const event of events) table?.off?.(event, schedule);
        table = next;
        for (const event of events) table?.on?.(event, schedule);
      }
      schedule();
    };
    const observer = new MutationObserver(attach);
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributeFilter: ["class"],
    });
    attach();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      for (const event of events) table?.off?.(event, schedule);
    };
  },
};
