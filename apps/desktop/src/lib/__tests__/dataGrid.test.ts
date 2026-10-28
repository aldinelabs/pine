import { describe, expect, it } from "vitest";
import { formatGridCell } from "../dataGrid";

describe("formatGridCell", () => {
  it("formats values by kind", () => {
    expect(formatGridCell(null, "en-US")).toEqual({
      text: "NULL",
      kind: "null",
    });
    expect(formatGridCell(1234.5, "en-US")).toEqual({
      text: "1,234.5",
      kind: "number",
    });
    expect(formatGridCell(12n, "en-US").kind).toBe("number");
    expect(formatGridCell("12.50", "en-US").kind).toBe("number");
    expect(formatGridCell("a\nb", "en-US")).toEqual({
      text: "a ↵ b",
      kind: "text",
    });
    expect(formatGridCell(undefined, "en-US").kind).toBe("empty");
    expect(formatGridCell({ a: 1n }, "en-US").text).toBe('{"a":"1"}');
  });

  it("summarizes binary values", () => {
    const cell = formatGridCell(new Uint8Array(20).fill(255), "en-US");
    expect(cell.kind).toBe("binary");
    expect(cell.text).toMatch(/^20 B · ff ff/);
    expect(cell.text.endsWith("…")).toBe(true);
  });
});
