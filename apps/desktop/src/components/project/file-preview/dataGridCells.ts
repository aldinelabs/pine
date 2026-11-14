import { formatGridCell, type GridCell } from "@/lib/dataGrid";
import { spreadsheetCellText } from "@/lib/spreadsheetSelection";
import type { AnnotationCells } from "./previewRenderer";

/** How a data grid is laid out and scrolled now. */
export interface DataGridGeometry {
  /** The scroller's client area (without scrollbars), in window coordinates. */
  viewport: { left: number; top: number; width: number; height: number };
  scrollLeft: number;
  scrollTop: number;
  /** The sticky header row's height. */
  headerHeight: number;
  /** The sticky row-number column's width; 0 without one. */
  numberWidth: number;
  rowHeight: number;
  columnWidths: readonly number[];
}

function columnLeft(geometry: DataGridGeometry, column: number): number {
  let left = geometry.numberWidth;
  for (let index = 0; index < column; index += 1)
    left += geometry.columnWidths[index] ?? 0;
  return left;
}

/**
 * Where a range of cells shows now, clipped to the part of the grid that
 * scrolls; undefined when it is scrolled out. Rows have a fixed height, so
 * this does not depend on which rows the virtual list has rendered.
 */
export function dataGridRangeRect(
  geometry: DataGridGeometry,
  cells: AnnotationCells,
): DOMRect | undefined {
  const { viewport, scrollLeft, scrollTop, headerHeight, rowHeight } = geometry;
  const lastColumn = Math.min(
    cells.endColumn,
    geometry.columnWidths.length - 1,
  );
  if (cells.startColumn > lastColumn || cells.startRow > cells.endRow)
    return undefined;
  const left =
    viewport.left + columnLeft(geometry, cells.startColumn) - scrollLeft;
  const right =
    viewport.left + columnLeft(geometry, lastColumn + 1) - scrollLeft;
  const top =
    viewport.top + headerHeight + cells.startRow * rowHeight - scrollTop;
  const bottom =
    viewport.top + headerHeight + (cells.endRow + 1) * rowHeight - scrollTop;
  const clipped = {
    left: Math.max(left, viewport.left + geometry.numberWidth),
    top: Math.max(top, viewport.top + headerHeight),
    right: Math.min(right, viewport.left + viewport.width),
    bottom: Math.min(bottom, viewport.top + viewport.height),
  };
  if (clipped.right <= clipped.left || clipped.bottom <= clipped.top)
    return undefined;
  return new DOMRect(
    clipped.left,
    clipped.top,
    clipped.right - clipped.left,
    clipped.bottom - clipped.top,
  );
}

/**
 * The scroll position that shows a range's first cell, or undefined when it
 * shows whole already.
 */
export function dataGridRevealScroll(
  geometry: DataGridGeometry,
  cells: AnnotationCells,
): { left: number; top: number } | undefined {
  const { viewport, scrollLeft, scrollTop, headerHeight, rowHeight } = geometry;
  const bodyHeight = viewport.height - headerHeight;
  const bodyWidth = viewport.width - geometry.numberWidth;
  const rowTop = cells.startRow * rowHeight;
  const cellLeft =
    columnLeft(geometry, cells.startColumn) - geometry.numberWidth;
  const cellWidth = geometry.columnWidths[cells.startColumn] ?? 0;
  const rowShown =
    rowTop >= scrollTop && rowTop + rowHeight <= scrollTop + bodyHeight;
  const columnShown =
    cellLeft >= scrollLeft && cellLeft + cellWidth <= scrollLeft + bodyWidth;
  if (rowShown && columnShown) return undefined;
  return {
    top: rowShown ? scrollTop : Math.max(0, rowTop - bodyHeight / 3),
    left: columnShown ? scrollLeft : Math.max(0, cellLeft - 24),
  };
}

/** A cell's value as tab-separated text, kept whole where the grid shortens it. */
export function dataGridCellText(value: GridCell, locale: string): string {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "bigint" ||
    typeof value === "boolean"
  )
    return spreadsheetCellText(value);
  return spreadsheetCellText(formatGridCell(value, locale).text);
}

interface GridPoint {
  row: number;
  /** Undefined on the row-number column. */
  column?: number;
}

function gridPoint(
  grid: Element,
  node: Node | null,
  offset: number,
): GridPoint | undefined {
  // An element boundary points between its children; take the child.
  const target =
    node?.nodeType === Node.ELEMENT_NODE
      ? (node.childNodes[offset] ?? node)
      : node;
  const element =
    target?.nodeType === Node.ELEMENT_NODE
      ? (target as Element)
      : target?.parentElement;
  const row = element?.closest<HTMLElement>("[data-row]");
  if (!row || !grid.contains(row)) return undefined;
  const index = Number(row.dataset.row);
  const column = element?.closest<HTMLElement>("[data-column]")?.dataset.column;
  return Number.isSafeInteger(index)
    ? { row: index, ...(column ? { column: Number(column) } : {}) }
    : undefined;
}

/**
 * The rectangle of cells a text selection in a data grid spans, from the cell
 * it starts in to the cell it ends in.
 */
export function dataGridSelectedCells(
  grid: Element,
  selection: Selection | null,
  columnCount: number,
): AnnotationCells | undefined {
  if (!selection || selection.isCollapsed || !selection.rangeCount)
    return undefined;
  const range = selection.getRangeAt(0);
  const start = gridPoint(grid, range.startContainer, range.startOffset);
  const end = gridPoint(grid, range.endContainer, range.endOffset);
  if (!start || !end || !columnCount) return undefined;
  // From a row number, the selection takes the row from its first column.
  const first = start.column ?? 0;
  const last = end.column ?? columnCount - 1;
  return {
    startRow: Math.min(start.row, end.row),
    endRow: Math.max(start.row, end.row),
    startColumn: Math.min(first, last),
    endColumn: Math.max(first, last),
  };
}
