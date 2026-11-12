import { describe, expect, it, vi } from "vitest";
import { countLines, countNonEmptyLines } from "../lineCount";

const samples = [
  "",
  "one",
  "one\n",
  "\n",
  "\n\n\n",
  "one\ntwo\nthree",
  "  \n\t\nvalue\n  \n\r\nlast",
  "a\r\nb\r\n",
  " \nx",
];

describe("line counts", () => {
  it("counts lines as splitting on newlines does", () => {
    for (const text of samples)
      expect(countLines(text)).toBe(text.split("\n").length);
  });

  it("counts lines with content as trimming each line does", () => {
    for (const text of samples)
      expect(countNonEmptyLines(text)).toBe(
        text.split("\n").filter((line) => line.trim()).length,
      );
  });

  it("does not allocate an array of lines", () => {
    const text = "line\n".repeat(10_000);
    const split = vi.spyOn(String.prototype, "split");
    try {
      expect(countLines(text)).toBe(10_001);
      expect(countNonEmptyLines(text)).toBe(10_000);
      expect(split).not.toHaveBeenCalled();
    } finally {
      split.mockRestore();
    }
  });
});
