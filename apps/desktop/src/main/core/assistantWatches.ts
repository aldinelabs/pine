import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  ASSISTANT_WATCHES_MAX,
  type AssistantTurnSource,
  type AssistantWatch,
  type AssistantWatchTrigger,
} from "../../shared/assistant";
import {
  isValidTimeZone,
  nextOccurrence,
  parseRrule,
  smallestGapMs,
  systemTimeZone,
} from "../automation/time";

/**
 * The Assistant's watches (docs/orchestrator-proposal.md §3.3 `watch`): "tell
 * me when X finishes", "remind me at 9 tomorrow", "brief me every day at
 * 18:00". Each one only wakes the Assistant; nothing here runs any work.
 * Times use the automation scheduler's expressions (an instant, or an RRULE
 * in a time zone), and the list lives in the Assistant's data folder.
 */

/** How often due watches are checked; also catches up after sleep. */
const TICK_MS = 30_000;
/** A schedule runs at most this often, so briefings stay cheap. */
export const WATCH_SCHEDULE_MIN_GAP_MS = 60 * 60_000;
/** An `at` reminder can be set this far ahead at most. */
const AT_MAX_AHEAD_MS = 366 * 24 * 60 * 60_000;
/**
 * A schedule's time missed by more than this (the computer was off) is
 * skipped rather than reported late; a one-time reminder is always sent.
 */
const SCHEDULE_CATCH_UP_MS = 6 * 60 * 60_000;
/** Late by more than this, the wake-up says so. */
const LATE_MS = 10 * 60_000;
const LABEL_MAX = 300;

const TriggerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("at"), at: z.string() }),
  z.object({
    kind: z.literal("schedule"),
    rrule: z.string().min(1).max(1_000),
    timezone: z.string().min(1).max(100),
  }),
  z.object({
    kind: z.literal("session"),
    projectId: z.string().min(1),
    sessionId: z.string().min(1),
  }),
]);

const WatchSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).max(LABEL_MAX),
  trigger: TriggerSchema,
  source: z.enum(["wechat", "desktop"]),
  createdAt: z.string(),
  nextAt: z.string().optional(),
  lastFiredAt: z.string().optional(),
  sessionTitle: z.string().optional(),
  projectName: z.string().optional(),
});

const WatchesFileSchema = z.object({
  version: z.literal(1),
  watches: z.array(WatchSchema),
});

/** The watch as requested by the Assistant's tool, before it is checked. */
export type WatchRequest =
  | { kind: "at"; at: string }
  | { kind: "schedule"; rrule: string; timezone?: string }
  | { kind: "session"; projectId: string; sessionId: string };

export interface WatchFiring {
  watch: AssistantWatch;
  /** How late it wakes the Assistant, when it is late. */
  lateMs?: number;
  /** For a session watch: how the session's turn ended. */
  sessionState?: "finished" | "failed" | "stopped";
}

export interface AssistantWatchesOptions {
  file: string;
  /** Wakes the Assistant for a watch; a failure is logged, never retried. */
  fire(firing: WatchFiring): Promise<void>;
  now?: () => Date;
}

/** Reads a trigger's next time from `after`; undefined once it never comes again. */
export function nextWatchTime(
  trigger: AssistantWatchTrigger,
  after: Date,
): Date | undefined {
  if (trigger.kind === "at") {
    const at = new Date(trigger.at);
    return at.getTime() > after.getTime() ? at : undefined;
  }
  if (trigger.kind === "session") return undefined;
  return nextOccurrence(parseRrule(trigger.rrule), after, trigger.timezone);
}

/**
 * Checks a requested trigger and returns it as stored. Throws a message the
 * model can act on when the time is unreadable, past, or too frequent.
 */
export function checkedTrigger(
  request: WatchRequest,
  now: Date,
): AssistantWatchTrigger {
  if (request.kind === "session") return request;
  if (request.kind === "at") {
    const at = new Date(request.at);
    if (
      !/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(request.at) ||
      isNaN(at.getTime())
    )
      throw new Error(
        "Give `at` as an ISO 8601 date and time with its offset, such as 2026-11-25T09:00:00+08:00.",
      );
    if (at.getTime() <= now.getTime())
      throw new Error("That time has already passed. Check the date and time.");
    if (at.getTime() - now.getTime() > AT_MAX_AHEAD_MS)
      throw new Error("A reminder can be at most a year ahead.");
    return { kind: "at", at: at.toISOString() };
  }
  const timezone = request.timezone?.trim() || systemTimeZone();
  if (!isValidTimeZone(timezone))
    throw new Error(`Unknown time zone "${timezone}".`);
  let rule;
  try {
    rule = parseRrule(request.rrule);
  } catch (error) {
    throw new Error(
      `Unreadable schedule: ${error instanceof Error ? error.message : String(error)} Use an RRULE such as FREQ=DAILY;BYHOUR=18;BYMINUTE=0.`,
    );
  }
  if (!nextOccurrence(rule, now, timezone))
    throw new Error("That schedule never comes up again.");
  const gap = smallestGapMs(rule, now, timezone);
  if (gap !== undefined && gap < WATCH_SCHEDULE_MIN_GAP_MS)
    throw new Error(
      "A schedule may wake you at most once an hour. Use a less frequent rule.",
    );
  return {
    kind: "schedule",
    rrule: request.rrule.trim().replace(/^RRULE:/i, ""),
    timezone,
  };
}

export class AssistantWatches {
  private known: Promise<AssistantWatch[]> | undefined;
  private writes: Promise<unknown> = Promise.resolve();
  private timer: ReturnType<typeof setInterval> | undefined;
  private ticking = false;

  constructor(private readonly options: AssistantWatchesOptions) {}

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  list(): Promise<AssistantWatch[]> {
    this.known ??= (async () => {
      try {
        return WatchesFileSchema.parse(
          JSON.parse(await readFile(this.options.file, "utf8")),
        ).watches;
      } catch {
        // Missing or damaged: no watches rather than a broken Assistant.
        return [];
      }
    })();
    return this.known;
  }

  private update(
    change: (watches: AssistantWatch[]) => AssistantWatch[],
  ): Promise<AssistantWatch[]> {
    const write = this.writes.then(async () => {
      const next = change(await this.list());
      const file = this.options.file;
      await mkdir(path.dirname(file), { recursive: true });
      const temporary = `${file}.${randomUUID()}.tmp`;
      await writeFile(
        temporary,
        `${JSON.stringify({ version: 1, watches: next }, null, 2)}\n`,
        { encoding: "utf8", mode: 0o600 },
      );
      await rename(temporary, file);
      this.known = Promise.resolve(next);
      return next;
    });
    this.writes = write.catch(() => undefined);
    return write;
  }

  async create(input: {
    label: string;
    trigger: WatchRequest;
    source: AssistantTurnSource;
    sessionTitle?: string;
    projectName?: string;
  }): Promise<AssistantWatch> {
    const label = input.label.trim().slice(0, LABEL_MAX);
    if (!label) throw new Error("Say what the reminder is about.");
    const now = this.now();
    const trigger = checkedTrigger(input.trigger, now);
    if ((await this.list()).length >= ASSISTANT_WATCHES_MAX)
      throw new Error(
        `There are already ${ASSISTANT_WATCHES_MAX} reminders and watches. Cancel one the user no longer needs first.`,
      );
    const next = nextWatchTime(trigger, now);
    const watch: AssistantWatch = {
      id: randomUUID(),
      label,
      trigger,
      source: input.source,
      createdAt: now.toISOString(),
      ...(next ? { nextAt: next.toISOString() } : {}),
      ...(input.sessionTitle ? { sessionTitle: input.sessionTitle } : {}),
      ...(input.projectName ? { projectName: input.projectName } : {}),
    };
    await this.update((watches) => [
      ...watches.filter(
        (existing) =>
          // Watching the same session twice is one watch.
          !(
            trigger.kind === "session" &&
            existing.trigger.kind === "session" &&
            existing.trigger.sessionId === trigger.sessionId
          ),
      ),
      watch,
    ]);
    return watch;
  }

  async cancel(watchId: string): Promise<AssistantWatch | undefined> {
    let removed: AssistantWatch | undefined;
    await this.update((watches) =>
      watches.filter((watch) => {
        if (watch.id !== watchId) return true;
        removed = watch;
        return false;
      }),
    );
    return removed;
  }

  async clear(): Promise<void> {
    await this.update(() => []);
  }

  /** Checks every 30 seconds, and once now for what came due while Pine was off. */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref?.();
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Wakes the Assistant for every timed watch that is due, then moves it on. */
  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const now = this.now();
      const due = (await this.list()).filter(
        (watch) =>
          watch.nextAt !== undefined &&
          new Date(watch.nextAt).getTime() <= now.getTime(),
      );
      if (!due.length) return;
      const firings: WatchFiring[] = [];
      await this.update((watches) =>
        watches.flatMap((watch) => {
          if (!due.some((candidate) => candidate.id === watch.id))
            return [watch];
          const lateMs = now.getTime() - new Date(watch.nextAt ?? 0).getTime();
          const next = nextWatchTime(watch.trigger, now);
          const skipped =
            watch.trigger.kind === "schedule" && lateMs > SCHEDULE_CATCH_UP_MS;
          if (!skipped)
            firings.push({
              watch,
              ...(lateMs > LATE_MS ? { lateMs } : {}),
            });
          if (!next) return [];
          return [
            {
              ...watch,
              nextAt: next.toISOString(),
              ...(skipped ? {} : { lastFiredAt: now.toISOString() }),
            },
          ];
        }),
      );
      for (const firing of firings) await this.fire(firing);
    } catch (error) {
      console.error("Failed to check the Assistant's reminders.", error);
    } finally {
      this.ticking = false;
    }
  }

  /** A session ended its turn: wakes the Assistant for each watch on it, once. */
  async sessionEnded(
    sessionId: string,
    state: "finished" | "failed" | "stopped",
  ): Promise<void> {
    const watching = (await this.list()).filter(
      (watch) =>
        watch.trigger.kind === "session" &&
        watch.trigger.sessionId === sessionId,
    );
    if (!watching.length) return;
    await this.update((watches) =>
      watches.filter(
        (watch) => !watching.some((fired) => fired.id === watch.id),
      ),
    );
    for (const watch of watching)
      await this.fire({ watch, sessionState: state });
  }

  private async fire(firing: WatchFiring): Promise<void> {
    try {
      await this.options.fire(firing);
    } catch (error) {
      console.error("Failed to wake the Assistant for a reminder.", error);
    }
  }
}
