// @vitest-environment node
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AssistantWatches,
  checkedTrigger,
  type WatchFiring,
} from "../assistantWatches";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture(start: string) {
  const root = await mkdtemp(path.join(os.tmpdir(), "pine-watches-"));
  roots.push(root);
  let now = new Date(start);
  const fired: WatchFiring[] = [];
  const file = path.join(root, "watches.json");
  const make = () =>
    new AssistantWatches({
      file,
      now: () => now,
      fire: (firing) => {
        fired.push(firing);
        return Promise.resolve();
      },
    });
  return {
    file,
    fired,
    watches: make(),
    reopen: make,
    setNow: (value: string) => {
      now = new Date(value);
    },
  };
}

describe("checking a watch's time", () => {
  const now = new Date("2026-11-24T10:00:00.000Z");

  it("takes an instant ahead with its offset", () => {
    expect(
      checkedTrigger({ kind: "at", at: "2026-11-25T09:00:00+08:00" }, now),
    ).toEqual({ kind: "at", at: "2026-11-25T01:00:00.000Z" });
  });

  it("refuses times past, unreadable or too far ahead", () => {
    expect(() =>
      checkedTrigger({ kind: "at", at: "2026-11-24T09:00:00Z" }, now),
    ).toThrow(/already passed/);
    expect(() =>
      checkedTrigger({ kind: "at", at: "tomorrow 9am" }, now),
    ).toThrow(/ISO 8601/);
    expect(() =>
      checkedTrigger({ kind: "at", at: "2028-11-24T09:00:00Z" }, now),
    ).toThrow(/a year/);
  });

  it("takes an automation-style schedule, at most hourly", () => {
    expect(
      checkedTrigger(
        {
          kind: "schedule",
          rrule: "RRULE:FREQ=DAILY;BYHOUR=18;BYMINUTE=0",
          timezone: "Asia/Shanghai",
        },
        now,
      ),
    ).toEqual({
      kind: "schedule",
      rrule: "FREQ=DAILY;BYHOUR=18;BYMINUTE=0",
      timezone: "Asia/Shanghai",
    });
    expect(() =>
      checkedTrigger(
        {
          kind: "schedule",
          rrule: "FREQ=MINUTELY;INTERVAL=10",
          timezone: "UTC",
        },
        now,
      ),
    ).toThrow(/once an hour/);
    expect(() =>
      checkedTrigger(
        { kind: "schedule", rrule: "FREQ=DAILY", timezone: "Mars/Base" },
        now,
      ),
    ).toThrow(/time zone/);
  });
});

describe("the Assistant's watches", () => {
  it("wakes the Assistant once for a reminder, then forgets it", async () => {
    const { watches, fired, setNow } = await fixture("2026-11-24T10:00:00Z");
    await watches.create({
      label: "看周报",
      trigger: { kind: "at", at: "2026-11-25T01:00:00Z" },
      source: "wechat",
    });

    await watches.tick();
    expect(fired).toEqual([]);

    setNow("2026-11-25T01:00:10Z");
    await watches.tick();
    await watches.tick();
    expect(fired.map((firing) => firing.watch.label)).toEqual(["看周报"]);
    expect(fired[0]?.lateMs).toBeUndefined();
    expect(await watches.list()).toEqual([]);
  });

  it("keeps a daily briefing on time and survives a restart", async () => {
    const { watches, fired, setNow, reopen, file } = await fixture(
      "2026-11-24T08:00:00Z",
    );
    const watch = await watches.create({
      label: "每日简报",
      trigger: {
        kind: "schedule",
        rrule: "FREQ=DAILY;BYHOUR=18;BYMINUTE=0",
        timezone: "Asia/Shanghai",
      },
      source: "desktop",
    });
    expect(watch.nextAt).toBe("2026-11-24T10:00:00.000Z");
    expect(JSON.parse(await readFile(file, "utf8")).watches).toHaveLength(1);

    setNow("2026-11-24T10:00:05Z");
    const restarted = reopen();
    await restarted.tick();
    expect(fired).toHaveLength(1);
    const [next] = await restarted.list();
    expect(next?.nextAt).toBe("2026-11-25T10:00:00.000Z");
    expect(next?.lastFiredAt).toBe("2026-11-24T10:00:05.000Z");
  });

  it("says a reminder is late, and skips a briefing missed by hours", async () => {
    const { watches, fired, setNow } = await fixture("2026-11-24T08:00:00Z");
    await watches.create({
      label: "提醒",
      trigger: { kind: "at", at: "2026-11-24T09:00:00Z" },
      source: "desktop",
    });
    await watches.create({
      label: "简报",
      trigger: {
        kind: "schedule",
        rrule: "FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
        timezone: "UTC",
      },
      source: "desktop",
    });

    // The computer slept through both.
    setNow("2026-11-24T20:00:00Z");
    await watches.tick();

    expect(fired.map((firing) => firing.watch.label)).toEqual(["提醒"]);
    expect(fired[0]?.lateMs).toBe(11 * 60 * 60_000);
    const [briefing] = await watches.list();
    expect(briefing?.nextAt).toBe("2026-11-25T09:00:00.000Z");
  });

  it("wakes the Assistant when a watched session ends its turn", async () => {
    const { watches, fired } = await fixture("2026-11-24T08:00:00Z");
    const fire = vi.fn();
    await watches.create({
      label: "修首页跑完告诉我",
      trigger: { kind: "session", projectId: "p", sessionId: "s" },
      source: "wechat",
    });

    await watches.sessionEnded("other", "finished");
    expect(fired).toEqual([]);
    await watches.sessionEnded("s", "failed");
    await watches.sessionEnded("s", "finished");

    expect(fired).toHaveLength(1);
    expect(fired[0]?.sessionState).toBe("failed");
    expect(await watches.list()).toEqual([]);
    expect(fire).not.toHaveBeenCalled();
  });

  it("lists, cancels and clears", async () => {
    const { watches } = await fixture("2026-11-24T08:00:00Z");
    const one = await watches.create({
      label: "一",
      trigger: { kind: "at", at: "2026-11-25T01:00:00Z" },
      source: "desktop",
    });
    await watches.create({
      label: "二",
      trigger: { kind: "at", at: "2026-11-26T01:00:00Z" },
      source: "desktop",
    });

    expect((await watches.cancel(one.id))?.label).toBe("一");
    expect(await watches.cancel(one.id)).toBeUndefined();
    expect((await watches.list()).map((watch) => watch.label)).toEqual(["二"]);
    await watches.clear();
    expect(await watches.list()).toEqual([]);
  });
});
