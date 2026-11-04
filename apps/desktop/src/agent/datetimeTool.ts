import {
  defineTool,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { DATETIME_TOOL_NAME } from "../shared/agent";

const WEEKDAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

const datetimeParams = Type.Object({
  timeZone: Type.Optional(
    Type.String({
      description:
        "IANA time zone such as Asia/Shanghai or America/New_York. Defaults to this computer's time zone.",
    }),
  ),
  timestamp: Type.Optional(
    Type.Number({
      description:
        "Unix time to describe, in seconds or milliseconds (values above 1e11 are milliseconds). Defaults to now.",
    }),
  ),
  locale: Type.Optional(
    Type.String({
      description:
        "BCP 47 locale such as zh-CN for the formatted strings. Defaults to this computer's locale.",
    }),
  ),
});

export type DatetimeParams = Static<typeof datetimeParams>;

function pad(value: number, length = 2): string {
  return String(value).padStart(length, "0");
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function zonedParts(ms: number, timeZone: string): ZonedParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  });
  const values: Record<string, number> = {};
  for (const part of formatter.formatToParts(ms)) {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  }
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
  };
}

/** Offset of `timeZone` from UTC at `ms`, in minutes (east is positive). */
function offsetMinutes(ms: number, timeZone: string): number {
  const p = zonedParts(ms, timeZone);
  const asUtc = Date.UTC(
    p.year,
    p.month - 1,
    p.day,
    p.hour,
    p.minute,
    p.second,
  );
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60_000);
}

function formatOffset(minutes: number, separator: string): string {
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  return `${sign}${pad(Math.floor(abs / 60))}${separator}${pad(abs % 60)}`;
}

function isoWeek(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  const weekday = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - weekday);
  const weekYear = date.getUTCFullYear();
  const yearStart = Date.UTC(weekYear, 0, 1);
  return {
    year: weekYear,
    week: Math.ceil(((date.getTime() - yearStart) / 86_400_000 + 1) / 7),
  };
}

function resolveTimeZone(requested: string | undefined): string {
  const zone = requested?.trim();
  if (!zone) return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
    }).resolvedOptions().timeZone;
  } catch {
    throw new Error(
      `Unknown time zone "${zone}". Use an IANA name such as Asia/Shanghai.`,
    );
  }
}

function resolveLocale(requested: string | undefined): string {
  const locale = requested?.trim();
  if (!locale) return Intl.DateTimeFormat().resolvedOptions().locale;
  try {
    return Intl.DateTimeFormat.supportedLocalesOf(locale)[0] ?? "en-US";
  } catch {
    throw new Error(`Invalid locale "${locale}". Use a tag such as zh-CN.`);
  }
}

/** Everything about one instant: epoch, ISO strings, zone, and local time. */
export function describeDatetime(
  params: DatetimeParams = {},
  now: () => number = Date.now,
) {
  let ms = now();
  if (params.timestamp !== undefined) {
    if (!Number.isFinite(params.timestamp)) {
      throw new Error("timestamp must be a finite number.");
    }
    ms =
      Math.abs(params.timestamp) > 1e11
        ? Math.trunc(params.timestamp)
        : Math.trunc(params.timestamp * 1000);
  }
  if (Number.isNaN(new Date(ms).getTime())) {
    throw new Error("timestamp is outside the representable date range.");
  }

  const timeZone = resolveTimeZone(params.timeZone);
  const locale = resolveLocale(params.locale);
  const offset = offsetMinutes(ms, timeZone);
  const p = zonedParts(ms, timeZone);
  const date = `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;
  const time = `${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`;
  const millis = pad(((ms % 1000) + 1000) % 1000, 3);

  const year = new Date(ms).getUTCFullYear();
  const winter = offsetMinutes(Date.UTC(year, 0, 1), timeZone);
  const summer = offsetMinutes(Date.UTC(year, 6, 1), timeZone);
  const observesDst = winter !== summer;

  const short = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale, { timeZone, ...options }).format(ms);
  const weekdayIndex =
    (new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay() + 6) % 7;
  const dayOfYear =
    Math.round(
      (Date.UTC(p.year, p.month - 1, p.day) - Date.UTC(p.year, 0, 1)) /
        86_400_000,
    ) + 1;
  const week = isoWeek(p.year, p.month, p.day);

  return {
    unixSeconds: Math.floor(ms / 1000),
    unixMilliseconds: ms,
    utcIso: new Date(ms).toISOString(),
    localIso: `${date}T${time}.${millis}${formatOffset(offset, ":")}`,
    rfc2822: new Date(ms).toUTCString(),
    timeZone,
    timeZoneAbbreviation:
      new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" })
        .formatToParts(ms)
        .find((part) => part.type === "timeZoneName")?.value ?? timeZone,
    utcOffset: formatOffset(offset, ":"),
    utcOffsetMinutes: offset,
    observesDst,
    isDst: observesDst && offset === Math.max(winter, summer),
    localDate: date,
    localTime: time,
    weekday: WEEKDAYS[weekdayIndex],
    isoWeekday: weekdayIndex + 1,
    dayOfYear,
    isoWeek: `${week.year}-W${pad(week.week)}`,
    formatted: {
      locale,
      full: short({ dateStyle: "full", timeStyle: "long" }),
      date: short({ dateStyle: "long" }),
      time: short({ timeStyle: "medium" }),
    },
    systemTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    processUptimeSeconds: Math.round(process.uptime()),
  };
}

/** Read-only clock access: models cannot know the current time on their own. */
export function createDatetimeToolDefinition(
  now: () => number = Date.now,
): ToolDefinition {
  return defineTool({
    name: DATETIME_TOOL_NAME,
    label: "Date and Time",
    description:
      "Get the current date and time, or describe a given Unix timestamp: Unix seconds and milliseconds, UTC and local ISO 8601, RFC 2822, time zone name, abbreviation and UTC offset, DST state, local date and time, weekday, day of year, ISO week, and locale-formatted strings. Defaults to this computer's time zone; pass timeZone for another zone. Read-only, cheap, and safe to call as often as needed: during time-sensitive tasks (deadlines, elapsed time, scheduling, waiting, polling, timestamps in files or logs) call it again whenever the current time matters, instead of reusing an earlier result. Never estimate the current time from the number of conversation turns or steps, and never guess it from memory.",
    promptSnippet: `Use ${DATETIME_TOOL_NAME} whenever the answer depends on the current date or time, or to convert a timestamp or time zone. Never guess the date from memory, and never estimate elapsed time from the number of turns or steps. In time-sensitive tasks call it frequently and re-check rather than trusting an earlier reading`,
    parameters: datetimeParams,
    prepareArguments: (args) => args as DatetimeParams,
    execute: (_toolCallId, params) => {
      const result = describeDatetime(params, now);
      return Promise.resolve({
        content: [
          { type: "text" as const, text: JSON.stringify(result, null, 2) },
        ],
        details: result,
      });
    },
  }) as ToolDefinition;
}
