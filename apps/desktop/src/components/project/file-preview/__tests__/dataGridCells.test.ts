import { afterEach, describe, expect, it } from "vitest";
import {
  dataGridCellText,
  dataGridRangeRect,
  dataGridRevealScroll,
  dataGridSelectedCells,
  type DataGridGeometry,
} from "../dataGridCells";

/** 10 columns of 100px after a 40px row-number column, 32px rows. */
function geometry(scrollTop = 0, scrollLeft = 0): DataGridGeometry {
  return {
    viewport: { left: 10, top: 20, width: 440, height: 340 },
    scrollLeft,
    scrollTop,
    headerHeight: 40,
    numberWidth: 40,
    rowHeight: 32,
    columnWidths: Array.from({ length: 10 }, () => 100),
  };
}

const box = (rect: DOMRect | undefined) =>
  rect && { x: rect.x, y: rect.y, width: rect.width, height: rect.height };

afterEach(() => document.body.replaceChildren());

describe("data grid cells", () => {
  it("boxes a range below the header and right of the row numbers", () => {
    expect(
      box(
        dataGridRangeRect(geometry(), {
          startRow: 1,
          startColumn: 1,
          endRow: 2,
          endColumn: 2,
        }),
      ),
    ).toEqual({ x: 10 + 40 + 100, y: 20 + 40 + 32, width: 200, height: 64 });
  });

  it("clips rows of the virtual list scrolled under the header", () => {
    // Scrolled to row 1000: rows far above have no box, the range that
    // runs into the view is cut at the header.
    const scrolled = geometry(32_000);
    expect(
      dataGridRangeRect(scrolled, {
        startRow: 0,
        startColumn: 0,
        endRow: 900,
        endColumn: 0,
      }),
    ).toBeUndefined();
    expect(
      box(
        dataGridRangeRect(scrolled, {
          startRow: 990,
          startColumn: 0,
          endRow: 1001,
          endColumn: 0,
        }),
      ),
    ).toEqual({ x: 50, y: 60, width: 100, height: 64 });
    // Rows past the bottom of the view are cut there.
    expect(
      box(
        dataGridRangeRect(scrolled, {
          startRow: 1008,
          startColumn: 0,
          endRow: 5000,
          endColumn: 0,
        }),
      )?.height,
    ).toBe(20 + 340 - (20 + 40 + 8 * 32));
  });

  it("clips columns scrolled under the row numbers and drops missing ones", () => {
    expect(
      box(
        dataGridRangeRect(geometry(0, 150), {
          startRow: 0,
          startColumn: 0,
          endRow: 0,
          endColumn: 1,
        }),
      ),
    ).toEqual({ x: 50, y: 60, width: 50, height: 32 });
    expect(
      dataGridRangeRect(geometry(), {
        startRow: 0,
        startColumn: 12,
        endRow: 0,
        endColumn: 14,
      }),
    ).toBeUndefined();
  });

  it("scrolls only when the first cell is not shown whole", () => {
    expect(
      dataGridRevealScroll(geometry(), {
        startRow: 2,
        startColumn: 1,
        endRow: 2,
        endColumn: 1,
      }),
    ).toBeUndefined();
    expect(
      dataGridRevealScroll(geometry(), {
        startRow: 500,
        startColumn: 7,
        endRow: 500,
        endColumn: 7,
      }),
    ).toEqual({ top: 500 * 32 - 100, left: 700 - 24 });
    // A row already shown keeps its vertical position.
    expect(
      dataGridRevealScroll(geometry(64), {
        startRow: 3,
        startColumn: 8,
        endRow: 3,
        endColumn: 8,
      }),
    ).toEqual({ top: 64, left: 800 - 24 });
  });

  it("keeps values whole and quotes those that break the grid", () => {
    expect(dataGridCellText("a\nb", "en-US")).toBe('"a\\nb"');
    expect(dataGridCellText(1234.5, "de-DE")).toBe("1234.5");
    expect(dataGridCellText(null, "en-US")).toBe("NULL");
    expect(dataGridCellText(undefined, "en-US")).toBe("");
    expect(dataGridCellText(new Uint8Array([1, 2]), "en-US")).toBe(
      "2 B · 01 02",
    );
  });

  it("reads the rectangle a text selection spans", () => {
    const grid = document.createElement("div");
    grid.innerHTML = [0, 1, 2]
      .map(
        (row) =>
          `<div data-row="${row}"><div class="number">${row + 1}</div>${[
            0, 1, 2,
          ]
            .map(
              (column) =>
                `<div data-column="${column}">r${row}c${column}</div>`,
            )
            .join("")}</div>`,
      )
      .join("");
    document.body.append(grid);
    const text = (row: number, column: number) =>
      grid.querySelector(`[data-row="${row}"] [data-column="${column}"]`)!
        .firstChild!;
    const selection = document.getSelection()!;

    // Dragged up and left: from r2c2 back to r0c1.
    selection.setBaseAndExtent(text(2, 2), 2, text(0, 1), 1);
    expect(dataGridSelectedCells(grid, selection, 3)).toEqual({
      startRow: 0,
      endRow: 2,
      startColumn: 1,
      endColumn: 2,
    });

    // From a row number, the whole width of the row.
    const number = grid.querySelector('[data-row="1"] .number')!.firstChild!;
    selection.setBaseAndExtent(number, 0, text(1, 0), 2);
    expect(dataGridSelectedCells(grid, selection, 3)).toEqual({
      startRow: 1,
      endRow: 1,
      startColumn: 0,
      endColumn: 0,
    });

    selection.setBaseAndExtent(text(1, 0), 2, text(1, 0), 2);
    expect(dataGridSelectedCells(grid, selection, 3)).toBeUndefined();

    const outside = document.createElement("p");
    outside.textContent = "elsewhere";
    document.body.append(outside);
    selection.setBaseAndExtent(outside.firstChild!, 0, text(0, 0), 1);
    expect(dataGridSelectedCells(grid, selection, 3)).toBeUndefined();
  });
});
