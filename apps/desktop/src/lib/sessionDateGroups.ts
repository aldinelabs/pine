import type { PineSessionSummary } from "@/shared/sessions";

const DAY_MS = 24 * 60 * 60 * 1000;

export type SessionDateGroupKey =
  "pastThreeDays" | "pastWeek" | "pastMonth" | "older";

const SESSION_DATE_WINDOWS: readonly {
  key: SessionDateGroupKey;
  labelKey: string;
  maxAgeMs: number;
}[] = [
  {
    key: "pastThreeDays",
    labelKey: "sessions.groupPastThreeDays",
    maxAgeMs: 3 * DAY_MS,
  },
  { key: "pastWeek", labelKey: "sessions.groupPastWeek", maxAgeMs: 7 * DAY_MS },
  {
    key: "pastMonth",
    labelKey: "sessions.groupPastMonth",
    maxAgeMs: 30 * DAY_MS,
  },
  {
    key: "older",
    labelKey: "sessions.groupOlder",
    maxAgeMs: Number.POSITIVE_INFINITY,
  },
];

/**
 * Split sessions sorted newest first into rolling age windows, keeping their
 * order inside each window. Windows without sessions are left out.
 */
export function groupSessionsByDate<T extends PineSessionSummary>(
  sessions: readonly T[],
  nowMs: number,
  translate: (key: string) => string,
): { key: SessionDateGroupKey; label: string; sessions: T[] }[] {
  const keyFor = (session: T): SessionDateGroupKey => {
    const age = nowMs - new Date(session.updatedAt).getTime();
    return (
      SESSION_DATE_WINDOWS.find((window) => age <= window.maxAgeMs)?.key ??
      "older"
    );
  };
  return SESSION_DATE_WINDOWS.map((window) => ({
    key: window.key,
    label: translate(window.labelKey),
    sessions: sessions.filter((session) => keyFor(session) === window.key),
  })).filter((group) => group.sessions.length > 0);
}
