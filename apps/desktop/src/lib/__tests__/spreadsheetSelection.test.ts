import { describe, expect, it } from "vitest";
import {
  isSpreadsheetPreview,
  spreadsheetCellText,
  spreadsheetColumnName,
  spreadsheetPreviewSelection,
} from "../spreadsheetSelection";

function preview(
  selector: { enable?: boolean; xArr: number[]; yArr: number[] },
  values: unknown[][],
  sheetName?: string,
) {
  const root = document.createElement("div");
  const host = document.createElement("div");
  host.dataset.pineSpreadsheet = "";
  Object.assign(host, {
    pineSpreadsheet: {
      sheetName: () => sheetName,
      table: () => ({
        ctx: {
          selector,
          database: {
            // Column 0 is the row-number column; rows start at sheet row 4.
            getVirtualBodyCell: (row: number, column: number) =>
              column === 0
                ? { column: { key: "__index" }, row: { __k: String(row + 4) } }
                : {
                    column: { key: `c${column + 1}` },
                    row: { __k: String(row + 4) },
                    displayText: values[row]?.[column - 1],
                  },
          },
        },
      }),
    },
  });
  root.append(host);
  return root;
}

describe("spreadsheet selection", () => {
  it("names columns like a spreadsheet", () => {
    expect(spreadsheetColumnName(0)).toBe("A");
    expect(spreadsheetColumnName(25)).toBe("Z");
    expect(spreadsheetColumnName(26)).toBe("AA");
  });

  it("quotes values that would break the tab-separated grid", () => {
    expect(spreadsheetCellText(undefined)).toBe("");
    expect(spreadsheetCellText(42)).toBe("42");
    expect(spreadsheetCellText("a\tb")).toBe('"a\\tb"');
  });

  it("reads the selected range with its sheet location, skipping row numbers", () => {
    const root = preview(
      { enable: true, xArr: [0, 2], yArr: [0, 1] },
      [
        ["Name", "Value"],
        ["Pine", 42],
      ],
      "Budget",
    );
    expect(isSpreadsheetPreview(root)).toBe(true);
    expect(spreadsheetPreviewSelection(root, "Selected")).toEqual({
      startLine: 5,
      endLine: 6,
      label: "Selected · Budget!C5:D6",
      text: "Name\tValue\nPine\t42",
    });
  });

  it("ignores empty, cleared and unrelated selections", () => {
    expect(
      spreadsheetPreviewSelection(
        preview({ enable: true, xArr: [1, 1], yArr: [0, 0] }, [[""]]),
        "Selected",
      ),
    ).toBeUndefined();
    expect(
      spreadsheetPreviewSelection(
        preview({ enable: false, xArr: [1, 1], yArr: [0, 0] }, [["x"]]),
        "Selected",
      ),
    ).toBeUndefined();
    expect(
      spreadsheetPreviewSelection(
        preview({ xArr: [-1, -1], yArr: [-1, -1] }, [["x"]]),
        "Selected",
      ),
    ).toBeUndefined();
    expect(isSpreadsheetPreview(document.createElement("div"))).toBe(false);
  });
});
