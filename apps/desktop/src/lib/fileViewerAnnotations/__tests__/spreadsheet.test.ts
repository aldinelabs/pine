import { afterEach, describe, expect, it, vi } from "vitest";
import type { FileViewerInstance } from "@file-viewer/core";
import { spreadsheetAnnotations } from "../spreadsheet";

const viewer = {} as FileViewerInstance;

const HEADER = 30;
const ROW = 20;
const NUMBERS = 40;
const COLUMN = 100;

/**
 * A workbook grid as e-virt-table draws it: a header, a frozen row-number
 * column and only the rows in `drawn` rendered.
 */
function workbook(options: {
  drawn: [number, number];
  scroll?: { x: number; y: number };
  sheet?: string;
  sheets?: string[];
}) {
  const scroll = options.scroll ?? { x: 0, y: 0 };
  const listeners = new Map<string, Set<() => void>>();
  let sheet = options.sheet;
  const cell = (row: number, column: number | undefined) => {
    const x = column === undefined ? 0 : NUMBERS + column * COLUMN;
    const fixed = column === undefined ? ("left" as const) : undefined;
    return {
      key: column === undefined ? "__index" : `c${column}`,
      fixed,
      width: column === undefined ? NUMBERS : COLUMN,
      height: ROW,
      getDrawX: () => (fixed ? x : x - scroll.x),
      getDrawY: () => HEADER + row * ROW - scroll.y,
    };
  };
  const renderRows = [];
  for (let row = options.drawn[0]; row <= options.drawn[1]; row += 1)
    renderRows.push({
      data: { __k: String(row) },
      cells: [undefined, 0, 1, 2, 3, 4].map((column) => cell(row, column)),
    });
  const table = {
    ctx: {
      containerElement: {
        getBoundingClientRect: () => new DOMRect(100, 50, 440, 260),
      },
      fixedLeftWidth: NUMBERS,
      fixedRightWidth: 0,
      header: {
        leafCellHeaders: [0, 1, 2, 3, 4].map((column) => ({
          key: `c${column}`,
        })),
      },
      body: { y: HEADER, visibleWidth: 440, visibleHeight: 230, renderRows },
      database: {
        getRowIndexForRowKey: (key: string) =>
          Number(key) < 1000 ? Number(key) : undefined,
      },
    },
    scrollToRowkey: vi.fn((key: string) => {
      scroll.y = Number(key) * ROW - 100;
    }),
    scrollToColkey: vi.fn(),
    on: (event: string, callback: () => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)?.add(callback);
    },
    off: (event: string, callback: () => void) =>
      listeners.get(event)?.delete(callback),
  };
  const root = document.createElement("div");
  root.innerHTML = `<div class="excel-wrapper">
    <div class="loading hidden"></div>
    ${(options.sheets ?? []).map((name) => `<button class="sheet-tab" title="${name}">${name}</button>`).join("")}
    <div class="table-target"></div>
  </div>`;
  const host = root.querySelector<HTMLElement>(".table-target")!;
  host.dataset.pineSpreadsheet = "";
  Object.assign(host, {
    pineSpreadsheet: { table: () => table, sheetName: () => sheet },
  });
  for (const tab of root.querySelectorAll<HTMLElement>(".sheet-tab"))
    tab.addEventListener("click", () => {
      sheet = tab.title;
    });
  document.body.append(root);
  return {
    root,
    table,
    scroll,
    fire: (event: string) => listeners.get(event)?.forEach((call) => call()),
  };
}

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

function frames() {
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
    setTimeout(() => callback(0), 0),
  );
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
}

const rects = (
  root: HTMLElement,
  cells: Parameters<NonNullable<typeof spreadsheetAnnotations.cellRects>>[1],
) =>
  spreadsheetAnnotations.cellRects!(root, cells).map((rect) => ({
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
  }));

describe("spreadsheet annotations", () => {
  it("serves workbooks and offers cell comments", () => {
    expect(spreadsheetAnnotations.renderers).toEqual([
      "spreadsheet-openxml",
      "spreadsheet-dbf",
      "apple-numbers",
    ]);
    expect(spreadsheetAnnotations.capabilities).toEqual({
      annotateCells: true,
    });
  });

  it("boxes the drawn cells of a range in window coordinates", () => {
    const { root } = workbook({ drawn: [0, 9], sheet: "Budget" });
    // B2:C3 → columns 1–2, rows 1–2.
    expect(
      rects(root, {
        sheet: "Budget",
        startRow: 1,
        startColumn: 1,
        endRow: 2,
        endColumn: 2,
      }),
    ).toEqual([
      {
        x: 100 + NUMBERS + COLUMN,
        y: 50 + HEADER + ROW,
        width: 2 * COLUMN,
        height: 2 * ROW,
      },
    ]);
  });

  it("clips a range to the drawn rows of the virtual grid", () => {
    // Rows 40–55 are drawn; the grid is scrolled to row 45 at the top.
    const { root } = workbook({ drawn: [40, 55], scroll: { x: 0, y: 900 } });
    expect(
      rects(root, { startRow: 0, startColumn: 0, endRow: 46, endColumn: 0 }),
    ).toEqual([
      { x: 100 + NUMBERS, y: 50 + HEADER, width: COLUMN, height: 2 * ROW },
    ]);
    // Rows above the drawn ones and below the body have no box.
    expect(
      rects(root, { startRow: 0, startColumn: 0, endRow: 30, endColumn: 0 }),
    ).toEqual([]);
    expect(
      rects(root, { startRow: 56, startColumn: 0, endRow: 60, endColumn: 0 }),
    ).toEqual([]);
  });

  it("clips columns scrolled under the frozen row numbers", () => {
    const { root } = workbook({ drawn: [0, 5], scroll: { x: 150, y: 0 } });
    expect(
      rects(root, { startRow: 0, startColumn: 0, endRow: 0, endColumn: 1 }),
    ).toEqual([{ x: 100 + NUMBERS, y: 50 + HEADER, width: 50, height: ROW }]);
    expect(
      rects(root, { startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 }),
    ).toEqual([]);
  });

  it("has no box for cells on another sheet", () => {
    const { root } = workbook({ drawn: [0, 5], sheet: "Budget" });
    expect(
      rects(root, {
        sheet: "Summary",
        startRow: 0,
        startColumn: 0,
        endRow: 0,
        endColumn: 0,
      }),
    ).toEqual([]);
  });

  it("switches to the comment's sheet and scrolls its cells into view", async () => {
    frames();
    const { root, table } = workbook({
      drawn: [0, 9],
      sheet: "Budget",
      sheets: ["Budget", "Summary"],
    });
    await spreadsheetAnnotations.reveal!(
      root,
      {
        place: { kind: "sheet", name: "Summary" },
        shape: {
          kind: "cells",
          cells: {
            sheet: "Summary",
            startRow: 3,
            startColumn: 1,
            endRow: 4,
            endColumn: 1,
          },
        },
      },
      viewer,
    );
    // Row 3 was drawn and shown, so the grid did not scroll.
    expect(table.scrollToRowkey).not.toHaveBeenCalled();
    expect(
      rects(root, {
        sheet: "Summary",
        startRow: 3,
        startColumn: 1,
        endRow: 3,
        endColumn: 1,
      }),
    ).toHaveLength(1);
  });

  it("scrolls to cells that are not shown", async () => {
    frames();
    const { root, table } = workbook({ drawn: [0, 9] });
    // Row 50 is not drawn; the fake grid never draws it, so revealing keeps
    // asking for it until it gives up.
    await spreadsheetAnnotations.reveal!(
      root,
      {
        shape: {
          kind: "cells",
          cells: { startRow: 50, startColumn: 2, endRow: 50, endColumn: 2 },
        },
      },
      viewer,
    );
    expect(table.scrollToRowkey).toHaveBeenCalledWith("50");
    expect(table.scrollToColkey).toHaveBeenCalledWith("c2");
  });

  it("reports grid scrolls once per change", async () => {
    frames();
    const { root, scroll, fire } = workbook({ drawn: [0, 9] });
    const changed = vi.fn();
    const stop = spreadsheetAnnotations.observe!(root, changed);
    await new Promise((resolve) => setTimeout(resolve, 5));
    changed.mockClear();
    fire("draw");
    await new Promise((resolve) => setTimeout(resolve, 5));
    // A redraw that moved nothing is not a change.
    expect(changed).not.toHaveBeenCalled();
    scroll.y = 40;
    fire("onScrollY");
    fire("onScrollY");
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(changed).toHaveBeenCalledTimes(1);
    stop();
    scroll.y = 80;
    fire("onScrollY");
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(changed).toHaveBeenCalledTimes(1);
  });
});
