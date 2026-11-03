import { describe, expect, it } from "vitest";
import {
  formatDate,
  inTimeWindow,
  nextOccurrence,
  occurrencesBetween,
  parseIsoDuration,
  parseRrule,
  periodKey,
  smallestGapMs,
} from "../time";

describe("automation time", () => {
  it("parses ISO durations", () => {
    expect(parseIsoDuration("PT15M")).toBe(15 * 60_000);
    expect(parseIsoDuration("P1DT2H")).toBe(26 * 3_600_000);
    expect(parseIsoDuration("P1W")).toBe(7 * 86_400_000);
    expect(parseIsoDuration("15m")).toBeUndefined();
    expect(parseIsoDuration("PT")).toBeUndefined();
  });

  it("expands rules in the rule's time zone", () => {
    const rule = parseRrule("FREQ=WEEKLY;BYDAY=MO;BYHOUR=9");
    const next = nextOccurrence(
      rule,
      new Date("2026-11-03T00:00:00Z"),
      "Asia/Shanghai",
    );
    // Monday 9:00 in Shanghai is 01:00 UTC.
    expect(next?.toISOString()).toBe("2026-11-09T01:00:00.000Z");
  });

  it("keeps local wall-clock time across a DST change", () => {
    const rule = parseRrule("FREQ=DAILY;BYHOUR=9");
    const occurrences = occurrencesBetween(
      rule,
      new Date("2026-10-31T12:00:00Z"),
      new Date("2026-11-02T23:00:00Z"),
      "America/New_York",
    ).map((instant) => instant.toISOString());
    // Daylight saving time ends on November 1, 2026.
    expect(occurrences).toEqual([
      "2026-10-31T13:00:00.000Z",
      "2026-11-01T14:00:00.000Z",
      "2026-11-02T14:00:00.000Z",
    ]);
  });

  it("handles the third workday of the month", () => {
    const rule = parseRrule(
      "FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=3;BYHOUR=10",
    );
    const next = nextOccurrence(rule, new Date("2026-10-31T00:00:00Z"), "UTC");
    expect(next?.toISOString()).toBe("2026-11-04T10:00:00.000Z");
  });

  it("rejects DTSTART and reports busy rules", () => {
    expect(() =>
      parseRrule("DTSTART:20260101T000000Z\nRRULE:FREQ=DAILY"),
    ).toThrow();
    const busy = parseRrule("FREQ=MINUTELY;INTERVAL=2");
    expect(smallestGapMs(busy, new Date(), "UTC")).toBe(120_000);
  });

  it("checks time windows, including overnight ones", () => {
    const window = { days: ["MO" as const], from: "08:00", to: "11:00" };
    expect(inTimeWindow(new Date("2026-11-02T09:00:00Z"), window, "UTC")).toBe(
      true,
    );
    expect(inTimeWindow(new Date("2026-11-03T09:00:00Z"), window, "UTC")).toBe(
      false,
    );
    const overnight = { days: ["MO" as const], from: "22:00", to: "02:00" };
    // 01:00 on Tuesday belongs to Monday's window.
    expect(
      inTimeWindow(new Date("2026-11-03T01:00:00Z"), overnight, "UTC"),
    ).toBe(true);
  });

  it("formats dates and periods", () => {
    const instant = new Date("2026-01-01T03:04:05Z");
    expect(formatDate(instant, "yyyy-MM-dd HH:mm:ss", "UTC")).toBe(
      "2026-01-01 03:04:05",
    );
    expect(periodKey(instant, "day", "UTC")).toBe("2026-01-01");
    expect(periodKey(instant, "week", "UTC")).toBe("2026-W01");
    expect(periodKey(new Date("2027-01-01T00:00:00Z"), "week", "UTC")).toBe(
      "2026-W53",
    );
  });
});
