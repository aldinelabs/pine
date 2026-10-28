import { describe, expect, it } from "vitest";
import { formatDuration } from "../formatDuration";

describe("formatDuration", () => {
  it("formats minutes and hours", () => {
    expect(formatDuration(4.6)).toBe("0:04");
    expect(formatDuration(125)).toBe("2:05");
    expect(formatDuration(3725)).toBe("1:02:05");
  });

  it("treats unknown lengths as zero", () => {
    expect(formatDuration(Number.NaN)).toBe("0:00");
    expect(formatDuration(Infinity)).toBe("0:00");
  });
});
