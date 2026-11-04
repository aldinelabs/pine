import { describe, expect, it } from "vitest";
import {
  createDatetimeToolDefinition,
  describeDatetime,
} from "../datetimeTool";

// 2024-07-04T12:34:56.789Z, a Thursday.
const NOW = Date.UTC(2024, 6, 4, 12, 34, 56, 789);

describe("describeDatetime", () => {
  it("describes the instant in a given zone", () => {
    const r = describeDatetime({ timeZone: "Asia/Shanghai" }, () => NOW);
    expect(r.unixSeconds).toBe(1720096496);
    expect(r.unixMilliseconds).toBe(NOW);
    expect(r.utcIso).toBe("2024-07-04T12:34:56.789Z");
    expect(r.localIso).toBe("2024-07-04T20:34:56.789+08:00");
    expect(r.utcOffsetMinutes).toBe(480);
    expect(r.observesDst).toBe(false);
    expect(r.weekday).toBe("Thursday");
    expect(r.dayOfYear).toBe(186);
    expect(r.isoWeek).toBe("2024-W27");
  });

  it("detects daylight saving time", () => {
    const summer = describeDatetime(
      { timeZone: "America/New_York" },
      () => NOW,
    );
    expect(summer.utcOffset).toBe("-04:00");
    expect(summer.isDst).toBe(true);
    const winter = describeDatetime(
      { timeZone: "America/New_York", timestamp: Date.UTC(2024, 0, 15) / 1000 },
      () => NOW,
    );
    expect(winter.utcOffset).toBe("-05:00");
    expect(winter.isDst).toBe(false);
  });

  it("accepts seconds or milliseconds", () => {
    const seconds = describeDatetime({ timeZone: "UTC", timestamp: 0 });
    const millis = describeDatetime({ timeZone: "UTC", timestamp: 1e12 });
    expect(seconds.utcIso).toBe("1970-01-01T00:00:00.000Z");
    expect(millis.utcIso).toBe("2001-09-09T01:46:40.000Z");
  });

  it("rejects unknown time zones and bad timestamps", () => {
    expect(() => describeDatetime({ timeZone: "Mars/Base" })).toThrow(
      /Unknown time zone/,
    );
    expect(() => describeDatetime({ timestamp: Number.NaN })).toThrow();
    expect(() => describeDatetime({ timestamp: 9e15 })).toThrow();
  });
});

describe("createDatetimeToolDefinition", () => {
  it("is named datetime and urges frequent re-checks", async () => {
    const tool = createDatetimeToolDefinition(() => NOW);
    expect(tool.name).toBe("datetime");
    expect(tool.description).toMatch(/as often as needed/);
    expect(tool.description).toMatch(/number of conversation turns or steps/);
    const result = await tool.execute(
      "id",
      { timeZone: "UTC" },
      undefined,
      undefined,
      undefined as never,
    );
    expect(
      JSON.parse((result.content[0] as { text: string }).text).utcIso,
    ).toBe("2024-07-04T12:34:56.789Z");
  });
});
