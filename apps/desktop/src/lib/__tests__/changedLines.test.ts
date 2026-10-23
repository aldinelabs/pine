import { describe, expect, it } from "vitest";
import { changedLineRanges } from "../changedLines";

const lines = (...values: string[]): string => values.join("\n");

describe("changed line ranges", () => {
  it("marks nothing when the text is unchanged", () => {
    expect(changedLineRanges("a\nb", "a\nb")).toEqual([]);
  });

  it("marks modified and inserted lines in the new version", () => {
    expect(
      changedLineRanges(
        lines("a", "b", "c", "d", "e"),
        lines("a", "B", "c", "x", "y", "d", "e"),
      ),
    ).toEqual([
      { start: 2, end: 2 },
      { start: 4, end: 5 },
    ]);
  });

  it("marks lines appended at the end and inserted at the start", () => {
    expect(changedLineRanges(lines("a", "b"), lines("a", "b", "c"))).toEqual([
      { start: 3, end: 3 },
    ]);
    expect(changedLineRanges(lines("a", "b"), lines("z", "a", "b"))).toEqual([
      { start: 1, end: 1 },
    ]);
  });

  it("leaves nothing to mark for pure deletions", () => {
    expect(changedLineRanges(lines("a", "b", "c"), lines("a", "c"))).toEqual(
      [],
    );
  });

  it("treats line ending changes alone as unchanged lines", () => {
    expect(changedLineRanges("a\r\nb", "a\nb")).toEqual([]);
  });

  it("finds moved lines without marking the ones that stayed", () => {
    expect(
      changedLineRanges(lines("a", "b", "c", "d"), lines("b", "c", "a", "d")),
    ).toEqual([{ start: 3, end: 3 }]);
  });

  it("marks the whole edited block when the versions differ too much", () => {
    const before = Array.from({ length: 2_000 }, (_, i) => `old ${i}`);
    const after = Array.from({ length: 2_000 }, (_, i) => `new ${i}`);
    expect(
      changedLineRanges(
        lines("head", ...before, "tail"),
        lines("head", ...after, "tail"),
      ),
    ).toEqual([{ start: 2, end: 2_001 }]);
  });
});
