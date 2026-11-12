// Pure decisions about the reply budget (CMD §11): how many sends a context
// token has left, which priority may still send, when the budget notice is
// due, how the out-queue collapses, and how pushes merge.

import { OUT_QUEUE_MAX, USABLE } from "./constants";
import type { QueuedOutbound, WeChatPersistedState } from "./types";

export type OutboundPriority = 0 | 1 | 2 | 3 | 4;

/** Sends the bridge may still spend on the current token. */
export function remainingSends(
  token: WeChatPersistedState["contextToken"],
): number {
  if (!token) return 0;
  return Math.max(0, USABLE - token.sent);
}

/** Lowest `remaining` at which each priority may send (P0 replies always may while one is left). */
export const PRIORITY_MIN_REMAINING: Readonly<
  Record<OutboundPriority, number>
> = { 0: 1, 1: 2, 2: 2, 3: 5, 4: 4 };

export function allows(priority: OutboundPriority, remaining: number): boolean {
  return remaining >= PRIORITY_MIN_REMAINING[priority];
}

/** The last usable slot goes to `T-BUDGET`, once per token. */
export function budgetNoticeDue(
  remaining: number,
  noticeSent: boolean,
): boolean {
  return remaining === 1 && !noticeSent;
}

function sessionOfKey(key: string, prefix: string): string | undefined {
  return key.startsWith(prefix) ? key.slice(prefix.length) : undefined;
}

/**
 * Adds an item to the out-queue: an item with the same key is replaced, a
 * session's result replaces its progress (and a progress is not queued after
 * its result), and the queue keeps at most `max` items by dropping the least
 * important, oldest first.
 */
export function enqueue(
  queue: readonly QueuedOutbound[],
  item: QueuedOutbound,
  max = OUT_QUEUE_MAX,
): QueuedOutbound[] {
  const resultOf = sessionOfKey(item.key, "result:");
  const progressOf = sessionOfKey(item.key, "progress:");
  if (
    progressOf !== undefined &&
    queue.some((queued) => queued.key === `result:${progressOf}`)
  ) {
    return [...queue];
  }
  const next = queue.filter(
    (queued) =>
      queued.key !== item.key &&
      (resultOf === undefined || queued.key !== `progress:${resultOf}`),
  );
  next.push(item);
  while (next.length > max) {
    let drop = 0;
    for (let index = 1; index < next.length; index += 1) {
      const candidate = next[index];
      const current = next[drop];
      if (
        candidate &&
        current &&
        (candidate.priority > current.priority ||
          (candidate.priority === current.priority &&
            candidate.queuedAtMs < current.queuedAtMs))
      ) {
        drop = index;
      }
    }
    next.splice(drop, 1);
  }
  return next;
}

/** Removes the items under `key` (a decided card, an ended run). */
export function withoutKey(
  queue: readonly QueuedOutbound[],
  key: string,
): QueuedOutbound[] {
  return queue.filter((queued) => queued.key !== key);
}

/** Cards per merged message (CMD §5.2). */
export const MERGE_CARDS_MAX = 3;

export interface MergePlan<T> {
  /** One message: at most MERGE_CARDS_MAX cards (P1), then the results (P2). */
  merged: T[];
  /** Cards beyond MERGE_CARDS_MAX: named by `T-MORECARDS`. */
  overflow: T[];
  /** P3 / P4 items, each its own message. */
  single: T[];
}

/** Groups pushes raised within one merge window, keeping arrival order inside each group. */
export function planMerge<T extends { priority: 1 | 2 | 3 | 4 }>(
  items: readonly T[],
): MergePlan<T> {
  const cards = items.filter((item) => item.priority === 1);
  return {
    merged: [
      ...cards.slice(0, MERGE_CARDS_MAX),
      ...items.filter((item) => item.priority === 2),
    ],
    overflow: cards.slice(MERGE_CARDS_MAX),
    single: items.filter((item) => item.priority >= 3),
  };
}
