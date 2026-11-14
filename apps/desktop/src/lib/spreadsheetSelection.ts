import type { AnnotationCellSelection } from "@/components/project/file-preview/previewRenderer";
import { cellsRange } from "@/lib/annotationLocation";
import type { AttachmentSelection } from "@/shared/attachments";

/** Cell of file-viewer's spreadsheet table (e-virt-table). */
export interface SpreadsheetCell {
  column?: { key?: unknown };
  row?: Record<string, unknown>;
  displayText?: unknown;
  getValue?: () => unknown;
  /** The cell's column key, as on its column. */
  key?: unknown;
  fixed?: "left" | "right";
  width?: number;
  height?: number;
  /** Where the cell is drawn now, in the canvas's CSS pixels. */
  getDrawX?: () => number;
  getDrawY?: () => number;
}

/** A row of the table that is drawn now. */
export interface SpreadsheetRow {
  data?: Record<string, unknown>;
  cells?: SpreadsheetCell[];
}

export interface SpreadsheetTable {
  ctx?: {
    selector?: { enable?: boolean; xArr?: number[]; yArr?: number[] };
    database?: {
      getVirtualBodyCell?: (
        rowIndex: number,
        colIndex: number,
      ) => SpreadsheetCell | undefined;
      getRowIndexForRowKey?: (rowKey: string) => number | undefined;
    };
    /** The element the canvas coordinates are measured from. */
    containerElement?: HTMLElement;
    fixedLeftWidth?: number;
    fixedRightWidth?: number;
    header?: { leafCellHeaders?: { key?: unknown }[] };
    body?: {
      y?: number;
      visibleWidth?: number;
      visibleHeight?: number;
      renderRows?: SpreadsheetRow[];
    };
  };
  scrollToRowkey?: (key: string) => void;
  scrollToColkey?: (key: string) => void;
  on?: (event: string, callback: () => void) => void;
  off?: (event: string, callback: () => void) => void;
}

/** Hook added to the table host by Pine's patch of the spreadsheet renderer. */
interface SpreadsheetHost extends HTMLElement {
  pineSpreadsheet?: {
    table: () => SpreadsheetTable | undefined;
    sheetName: () => string | undefined;
  };
}

/** Row key field and data column key prefix used by the renderer. */
const ROW_KEY_FIELD = "__k";
const DATA_KEY = /^c(\d+)$/u;

export function spreadsheetColumnName(index: number): string {
  let value = index + 1;
  let name = "";
  while (value > 0) {
    value -= 1;
    name = String.fromCharCode(65 + (value % 26)) + name;
    value = Math.floor(value / 26);
  }
  return name;
}

/** Tab-separated text; a value that would break the grid is quoted. */
export function spreadsheetCellText(value: unknown): string {
  if (value === undefined || value === null) return "";
  let text = "";
  if (typeof value === "string") text = value;
  else if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  )
    text = String(value);
  else if (typeof value === "object") {
    try {
      text = JSON.stringify(value) ?? "";
    } catch {
      text = "";
    }
  }
  return /[\t\r\n"]/.test(text) ? JSON.stringify(text) : text;
}

export function isSpreadsheetPreview(root: HTMLElement): boolean {
  return spreadsheetHost(root) !== undefined;
}

function spreadsheetHost(root: HTMLElement): SpreadsheetHost | undefined {
  const host = root.querySelector<SpreadsheetHost>("[data-pine-spreadsheet]");
  return host?.pineSpreadsheet ? host : undefined;
}

/** The sheet row a grid row shows; filler rows past the sheet have none. */
export function spreadsheetRowIndex(row: unknown): number | undefined {
  const key = (row as Record<string, unknown> | undefined)?.[ROW_KEY_FIELD];
  const index =
    typeof key === "string" && /^\d+$/u.test(key) ? Number(key) : NaN;
  return Number.isSafeInteger(index) ? index : undefined;
}

/** The key of the grid column that shows a 0-based sheet column. */
export function spreadsheetDataKey(column: number): string {
  return `c${column}`;
}

/** The sheet column a grid column shows; the row-number column has none. */
export function spreadsheetColumnIndex(key: unknown): number | undefined {
  const match = typeof key === "string" ? DATA_KEY.exec(key) : null;
  return match ? Number(match[1]) : undefined;
}

/** The workbook's grid and active sheet, once the renderer has drawn it. */
export function spreadsheetHook(
  root: HTMLElement,
): NonNullable<SpreadsheetHost["pineSpreadsheet"]> | undefined {
  return spreadsheetHost(root)?.pineSpreadsheet;
}

/**
 * The selected cells of a spreadsheet preview, in 0-based sheet rows and
 * columns, with their values as tab-separated text.
 */
export function spreadsheetSelectedCells(
  root: HTMLElement,
): AnnotationCellSelection | undefined {
  const hook = spreadsheetHook(root);
  const context = hook?.table()?.ctx;
  const selector = context?.selector;
  const readCell = context?.database?.getVirtualBodyCell?.bind(
    context.database,
  );
  const [startX, endX] = selector?.xArr ?? [];
  const [startY, endY] = selector?.yArr ?? [];
  if (
    !hook ||
    !readCell ||
    selector?.enable === false ||
    ![startX, endX, startY, endY].every(
      (value) => Number.isSafeInteger(value) && value >= 0,
    ) ||
    endX < startX ||
    endY < startY
  )
    return undefined;

  const rows: string[] = [];
  let firstRow = Infinity;
  let lastRow = -1;
  let firstColumn = Infinity;
  let lastColumn = -1;
  for (let y = startY; y <= endY; y += 1) {
    const cells: string[] = [];
    for (let x = startX; x <= endX; x += 1) {
      const cell = readCell(y, x);
      // The row-number column has no data key and is not part of the sheet.
      const columnIndex = spreadsheetColumnIndex(cell?.column?.key);
      if (!cell || columnIndex === undefined) continue;
      const rowIndex = cell.row ? spreadsheetRowIndex(cell.row) : y;
      if (rowIndex === undefined) continue;
      firstRow = Math.min(firstRow, rowIndex);
      lastRow = Math.max(lastRow, rowIndex);
      firstColumn = Math.min(firstColumn, columnIndex);
      lastColumn = Math.max(lastColumn, columnIndex);
      // Cells not drawn yet have no display text, only their value.
      const shown = cell.displayText;
      cells.push(
        spreadsheetCellText(
          shown !== undefined && shown !== null && shown !== ""
            ? shown
            : cell.getValue?.(),
        ),
      );
    }
    if (cells.length) rows.push(cells.join("\t"));
  }
  const text = rows.join("\n");
  if (lastRow < 0 || !text.trim()) return undefined;
  const sheet = hook.sheetName();
  return {
    cells: {
      ...(sheet ? { sheet } : {}),
      startRow: firstRow,
      startColumn: firstColumn,
      endRow: lastRow,
      endColumn: lastColumn,
    },
    text,
  };
}

/** The selected cell range of a spreadsheet preview, with its A1 location. */
export function spreadsheetPreviewSelection(
  root: HTMLElement,
  label: string,
): AttachmentSelection | undefined {
  const selected = spreadsheetSelectedCells(root);
  if (!selected) return undefined;
  const { cells, text } = selected;
  const range = cellsRange(cells);
  return {
    startLine: cells.startRow + 1,
    endLine: cells.endRow + 1,
    label: `${label} · ${cells.sheet ? `${cells.sheet}!${range}` : range}`,
    text,
  };
}
