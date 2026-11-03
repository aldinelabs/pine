import { RRule, type Options } from "rrule";
import type {
  AutomationTimeWindow,
  AutomationWeekday,
} from "../../shared/automation";

const WEEKDAYS: AutomationWeekday[] = [
  "SU",
  "MO",
  "TU",
  "WE",
  "TH",
  "FR",
  "SA",
];

/** ISO 8601 durations such as PT15M, P1D or P1W, in milliseconds. */
export function parseIsoDuration(value: string): number | undefined {
  const match =
    /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(
      value,
    );
  if (!match || value === "P" || value.endsWith("T")) return undefined;
  const [, weeks, days, hours, minutes, seconds] = match.map((part) =>
    part === undefined ? 0 : Number(part),
  );
  return (
    ((((weeks * 7 + days) * 24 + hours) * 60 + minutes) * 60 + seconds) * 1_000
  );
}

export function systemTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: AutomationWeekday;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

export function wallClock(instant: Date, timeZone: string): WallClock {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      weekday: "short",
    });
    formatters.set(timeZone, formatter);
  }
  const parts = Object.fromEntries(
    formatter.formatToParts(instant).map((part) => [part.type, part.value]),
  );
  const weekday =
    (
      {
        Sun: "SU",
        Mon: "MO",
        Tue: "TU",
        Wed: "WE",
        Thu: "TH",
        Fri: "FR",
      } as Record<string, AutomationWeekday>
    )[parts.weekday] ?? "SA";
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday,
  };
}

/** A Date whose UTC fields read as the wall clock in the time zone. */
function toFloating(instant: Date, timeZone: string): Date {
  const wall = wallClock(instant, timeZone);
  return new Date(
    Date.UTC(
      wall.year,
      wall.month - 1,
      wall.day,
      wall.hour,
      wall.minute,
      wall.second,
    ),
  );
}

/** The instant whose wall clock in the time zone reads as `floating`. */
function fromFloating(floating: Date, timeZone: string): Date {
  const guess = floating.getTime();
  const offset = toFloating(new Date(guess), timeZone).getTime() - guess;
  let candidate = guess - offset;
  const corrected =
    toFloating(new Date(candidate), timeZone).getTime() - candidate;
  if (corrected !== offset) candidate = guess - corrected;
  return new Date(candidate);
}

// Rules without DTSTART anchor to a fixed local midnight, so unspecified
// minutes and seconds are zero and intervals are stable across restarts.
const ANCHOR = Date.UTC(2020, 0, 1, 0, 0, 0);

export interface AutomationRule {
  options: Partial<Options>;
  /** Sub-daily rules re-anchor at the local day being expanded. */
  subDaily: boolean;
}

export function parseRrule(value: string): AutomationRule {
  const source = value.trim().replace(/^RRULE:/i, "");
  if (/DTSTART|\n/i.test(source))
    throw new Error("Use a single RRULE without DTSTART.");
  const options = RRule.parseString(source);
  if (options.freq === undefined) throw new Error("The rule needs FREQ.");
  if (options.freq === RRule.SECONDLY)
    throw new Error(
      "Rules more frequent than every 5 minutes are not allowed.",
    );
  return {
    options,
    subDaily: options.freq === RRule.HOURLY || options.freq === RRule.MINUTELY,
  };
}

function expand(rule: AutomationRule, floatingAfter: Date): RRule {
  const dtstart = rule.subDaily
    ? new Date(
        Date.UTC(
          floatingAfter.getUTCFullYear(),
          floatingAfter.getUTCMonth(),
          floatingAfter.getUTCDate() - 1,
        ),
      )
    : new Date(ANCHOR);
  return new RRule({ ...rule.options, dtstart, tzid: null });
}

/** The first occurrence strictly after `after`, as a real instant. */
export function nextOccurrence(
  rule: AutomationRule,
  after: Date,
  timeZone: string,
): Date | undefined {
  const floatingAfter = toFloating(after, timeZone);
  const next = expand(rule, floatingAfter).after(floatingAfter, false);
  if (!next) return undefined;
  const instant = fromFloating(next, timeZone);
  // A wall-clock time skipped by a DST change can map before `after`.
  return instant.getTime() > after.getTime()
    ? instant
    : nextOccurrence(rule, new Date(after.getTime() + 60_000), timeZone);
}

/** Occurrences in (from, to], oldest first, at most `limit`. */
export function occurrencesBetween(
  rule: AutomationRule,
  from: Date,
  to: Date,
  timeZone: string,
  limit = 10,
): Date[] {
  const result: Date[] = [];
  let cursor = from;
  while (result.length < limit) {
    const next = nextOccurrence(rule, cursor, timeZone);
    if (!next || next.getTime() > to.getTime()) break;
    result.push(next);
    cursor = next;
  }
  return result;
}

/** The smallest gap between the next occurrences, to reject busy rules. */
export function smallestGapMs(
  rule: AutomationRule,
  from: Date,
  timeZone: string,
): number | undefined {
  let previous = nextOccurrence(rule, from, timeZone);
  if (!previous) return undefined;
  let smallest = Infinity;
  for (let index = 0; index < 20; index += 1) {
    const next = nextOccurrence(rule, previous, timeZone);
    if (!next) break;
    smallest = Math.min(smallest, next.getTime() - previous.getTime());
    previous = next;
  }
  return smallest === Infinity ? undefined : smallest;
}

function minutesOfDay(clock: string): number {
  const [hours, minutes] = clock.split(":").map(Number);
  return hours * 60 + minutes;
}

/** Whether the instant falls in the window, in local time. */
export function inTimeWindow(
  instant: Date,
  window: AutomationTimeWindow | undefined,
  timeZone = systemTimeZone(),
): boolean {
  if (!window) return true;
  const wall = wallClock(instant, timeZone);
  const now = wall.hour * 60 + wall.minute;
  const from = minutesOfDay(window.from);
  const to = minutesOfDay(window.to);
  // An overnight window belongs to the day it started on.
  const overnight = from > to;
  const insideTime = overnight
    ? now >= from || now < to
    : now >= from && now < to;
  if (!insideTime) return false;
  if (!window.days) return true;
  let day = wall.weekday;
  if (overnight && now < to) day = WEEKDAYS[(WEEKDAYS.indexOf(day) + 6) % 7];
  return window.days.includes(day);
}

/** Calendar day key ("2026-11-03") and ISO week key in local time. */
export function periodKey(
  instant: Date,
  period: "day" | "week",
  timeZone = systemTimeZone(),
): string {
  const wall = wallClock(instant, timeZone);
  if (period === "day")
    return `${wall.year}-${String(wall.month).padStart(2, "0")}-${String(wall.day).padStart(2, "0")}`;
  // ISO week: the Thursday of this week decides the year.
  const date = new Date(Date.UTC(wall.year, wall.month - 1, wall.day));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((date.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function isWorkday(instant: Date, timeZone = systemTimeZone()): boolean {
  const day = wallClock(instant, timeZone).weekday;
  return day !== "SA" && day !== "SU";
}

/** A small subset of Unicode date patterns: yyyy MM dd HH mm ss. */
export function formatDate(
  instant: Date,
  pattern: string,
  timeZone = systemTimeZone(),
): string {
  const wall = wallClock(instant, timeZone);
  const pad = (value: number, length = 2) =>
    String(value).padStart(length, "0");
  return pattern.replace(/yyyy|MM|dd|HH|mm|ss/g, (token) => {
    switch (token) {
      case "yyyy":
        return pad(wall.year, 4);
      case "MM":
        return pad(wall.month);
      case "dd":
        return pad(wall.day);
      case "HH":
        return pad(wall.hour);
      case "mm":
        return pad(wall.minute);
      default:
        return pad(wall.second);
    }
  });
}
