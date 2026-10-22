import type { AttachmentSelection } from "@/shared/attachments";

/** Cell of file-viewer's spreadsheet table (e-virt-table). */
interface SpreadsheetCell {
  column?: { key?: unknown };
  row?: Record<string, unknown>;
  displayText?: unknown;
  getValue?: () => unknown;
}

interface SpreadsheetTable {
  ctx?: {
    selector?: { enable?: boolean; xArr?: number[]; yArr?: number[] };
    database?: {
      getVirtualBodyCell?: (
        rowIndex: number,
        colIndex: number,
      ) => SpreadsheetCell | undefined;
    };
  };
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

/** The selected cell range of a spreadsheet preview, with its A1 location. */
export function spreadsheetPreviewSelection(
  root: HTMLElement,
  label: string,
): AttachmentSelection | undefined {
  const hook = spreadsheetHost(root)?.pineSpreadsheet;
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
      const key = cell?.column?.key;
      const column = typeof key === "string" ? DATA_KEY.exec(key) : null;
      if (!cell || !column) continue;
      const rowIndex = Number(cell.row?.[ROW_KEY_FIELD] ?? y);
      const columnIndex = Number(column[1]);
      firstRow = Math.min(firstRow, rowIndex);
      lastRow = Math.max(lastRow, rowIndex);
      firstColumn = Math.min(firstColumn, columnIndex);
      lastColumn = Math.max(lastColumn, columnIndex);
      cells.push(spreadsheetCellText(cell.displayText ?? cell.getValue?.()));
    }
    if (cells.length) rows.push(cells.join("\t"));
  }
  const text = rows.join("\n");
  if (lastRow < 0 || !text.trim()) return undefined;
  const start = `${spreadsheetColumnName(firstColumn)}${firstRow + 1}`;
  const end = `${spreadsheetColumnName(lastColumn)}${lastRow + 1}`;
  const range = start === end ? start : `${start}:${end}`;
  const sheet = hook.sheetName();
  return {
    startLine: firstRow + 1,
    endLine: lastRow + 1,
    label: `${label} · ${sheet ? `${sheet}!${range}` : range}`,
    text,
  };
}
