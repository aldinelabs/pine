// Numbered asks: everything the bridge waits on the user for.
// Numbers are 11-99, single use, and leave a tombstone when closed so a late
// reply reads "already handled" instead of "unknown number".

import {
  ALLOW_BARE_APPROVE,
  ASK_MAX,
  ASK_MIN,
  ASK_SKEW_MS,
  BARE_GAP_MS,
  CONFIRM_TTL_MS,
  HELD_TTL_MS,
  TOMBSTONE_TTL_MS,
} from "./constants";
import type {
  ApprovalAsk,
  Ask,
  ConfirmAsk,
  HeldAsk,
  QuestionAsk,
} from "./types";

type Unnumbered<T> = Omit<T, "number" | "createdAtMs">;
/** What `AskBook.open` takes: the book assigns the number and the creation time; expiry defaults by kind. */
export type AskInput =
  | Unnumbered<ApprovalAsk>
  | Unnumbered<QuestionAsk>
  | (Omit<Unnumbered<ConfirmAsk>, "expiresAtMs"> & { expiresAtMs?: number })
  | (Omit<Unnumbered<HeldAsk>, "expiresAtMs"> & { expiresAtMs?: number });

export type AskCloseReason =
  /** Answered, approved, rejected or executed from WeChat. */
  | "used"
  /** Decided elsewhere (a Pine window, Pine Remote), or the request is gone. */
  | "decided"
  | "expired"
  /** Run end, restart, another command, `.pause`, unbind. */
  | "invalidated";

export interface AskTombstone {
  number: number;
  kind: Ask["kind"];
  reason: AskCloseReason;
  closedAtMs: number;
}

export interface AskBookOptions {
  now: () => number;
  /** Persisted `nextAsk`; out of range starts at ASK_MIN. */
  nextAsk?: number;
  /** Called whenever `nextAsk` moves, so it can be persisted. */
  onNextAsk?: (nextAsk: number) => void;
}

const ASK_COUNT = ASK_MAX - ASK_MIN + 1;

export class AskBook {
  private readonly openAsks = new Map<number, Ask>();
  private readonly tombstones = new Map<number, AskTombstone>();
  private next: number;

  constructor(private readonly options: AskBookOptions) {
    this.next = inRange(options.nextAsk) ? options.nextAsk : ASK_MIN;
  }

  /** The number `open` tries first. */
  get nextAsk(): number {
    return this.next;
  }

  /**
   * Opens an ask under the next free number. An approval or question already
   * open for the same request is returned as it is. `undefined` when all 89
   * numbers are open or tombstoned.
   */
  open(input: AskInput): Ask | undefined {
    this.sweep();
    if (input.kind === "approval" || input.kind === "question") {
      const existing = this.byRequest(input.requestId);
      if (existing) return existing;
    }
    const number = this.freeNumber();
    if (number === undefined) return undefined;
    const createdAtMs = this.options.now();
    let ask: Ask;
    switch (input.kind) {
      case "confirm":
        ask = {
          ...input,
          number,
          createdAtMs,
          expiresAtMs: input.expiresAtMs ?? createdAtMs + CONFIRM_TTL_MS,
        };
        break;
      case "held":
        ask = {
          ...input,
          number,
          createdAtMs,
          expiresAtMs: input.expiresAtMs ?? createdAtMs + HELD_TTL_MS,
        };
        break;
      default:
        ask = { ...input, number, createdAtMs };
    }
    this.openAsks.set(number, ask);
    this.next = number >= ASK_MAX ? ASK_MIN : number + 1;
    this.options.onNextAsk?.(this.next);
    return ask;
  }

  /** The open ask under `n`. */
  get(n: number): Ask | undefined {
    this.sweep();
    return this.openAsks.get(n);
  }

  status(n: number): "open" | "tombstone" | "unknown" {
    this.sweep();
    if (this.openAsks.has(n)) return "open";
    return this.tombstones.has(n) ? "tombstone" : "unknown";
  }

  /** Why `n` is closed, while its tombstone lasts (`E-DONE`). */
  tombstoneOf(n: number): AskTombstone | undefined {
    this.sweep();
    return this.tombstones.get(n);
  }

  /** Open asks, oldest first. */
  list(): Ask[] {
    this.sweep();
    return [...this.openAsks.values()].sort(
      (a, b) => a.createdAtMs - b.createdAtMs || a.number - b.number,
    );
  }

  byRequest(requestId: string): ApprovalAsk | QuestionAsk | undefined {
    for (const ask of this.openAsks.values()) {
      if (
        (ask.kind === "approval" || ask.kind === "question") &&
        ask.requestId === requestId
      ) {
        return ask;
      }
    }
    return undefined;
  }

  /** The card was delivered; the first delivery counts. */
  markDelivered(n: number, atMs: number): void {
    const ask = this.openAsks.get(n);
    if (ask && ask.deliveredAtMs === undefined) ask.deliveredAtMs = atMs;
  }

  /** `.show` delivered the whole approval subject; it also delivers the card. */
  markShown(n: number, atMs: number): void {
    const ask = this.openAsks.get(n);
    if (ask?.kind !== "approval") return;
    ask.shownAtMs = atMs;
    if (ask.deliveredAtMs === undefined) ask.deliveredAtMs = atMs;
  }

  /** Closes `n`, leaving a tombstone. Returns the ask, or `undefined` when it was not open. */
  close(n: number, reason: AskCloseReason): Ask | undefined {
    const ask = this.openAsks.get(n);
    if (!ask) return undefined;
    this.openAsks.delete(n);
    this.tombstones.set(n, {
      number: n,
      kind: ask.kind,
      reason,
      closedAtMs: this.options.now(),
    });
    return ask;
  }

  closeWhere(predicate: (ask: Ask) => boolean, reason: AskCloseReason): Ask[] {
    const closed: Ask[] = [];
    for (const ask of [...this.openAsks.values()]) {
      if (predicate(ask) && this.close(ask.number, reason)) closed.push(ask);
    }
    return closed;
  }

  /** Expires confirmations and held batches, forgets old tombstones. Returns the asks that expired now. */
  sweep(): Ask[] {
    const now = this.options.now();
    for (const [n, tombstone] of this.tombstones) {
      if (now - tombstone.closedAtMs >= TOMBSTONE_TTL_MS) {
        this.tombstones.delete(n);
      }
    }
    const expired: Ask[] = [];
    for (const ask of [...this.openAsks.values()]) {
      if (
        (ask.kind === "confirm" || ask.kind === "held") &&
        now >= ask.expiresAtMs &&
        this.close(ask.number, "expired")
      ) {
        expired.push(ask);
      }
    }
    return expired;
  }

  /** Open and tombstoned numbers: what `splitAskPrefix` may read as an ask number. */
  knownNumbers(): Set<number> {
    this.sweep();
    return new Set([...this.openAsks.keys(), ...this.tombstones.keys()]);
  }

  private freeNumber(): number | undefined {
    for (let offset = 0; offset < ASK_COUNT; offset += 1) {
      const n = ASK_MIN + ((this.next - ASK_MIN + offset) % ASK_COUNT);
      if (!this.openAsks.has(n) && !this.tombstones.has(n)) return n;
    }
    return undefined;
  }
}

function inRange(value: number | undefined): value is number {
  return (
    value !== undefined &&
    Number.isInteger(value) &&
    value >= ASK_MIN &&
    value <= ASK_MAX
  );
}

/** When a message was written and when the poll that returned it started. */
export interface MessageTiming {
  createdAtMs: number;
  pollStartedAtMs: number;
}

/**
 * `.y` without a number. Always: exactly one ask is open and it is
 * a held batch. With ALLOW_BARE_APPROVE also a single approval whose card was
 * delivered more than ASK_SKEW_MS before the message was written and before
 * the poll that returned it started. Never a confirmation.
 */
export function bareApproveAllowed(
  book: Pick<AskBook, "list">,
  message: MessageTiming,
): boolean {
  const open = book.list();
  if (open.length !== 1) return false;
  const ask = open[0];
  if (ask?.kind === "held") return true;
  if (!ALLOW_BARE_APPROVE || ask?.kind !== "approval") return false;
  const delivered = ask.deliveredAtMs;
  return (
    delivered !== undefined &&
    message.createdAtMs > delivered + ASK_SKEW_MS &&
    delivered < message.pollStartedAtMs
  );
}

/**
 * A bare `.2` / `.1,3` while a question card is open.
 * `lastListDeliveredAtMs` is the delivery time of a numbered list that is
 * still valid, `undefined` when none is.
 */
export function bareAnswerAllowed(
  ask: Pick<QuestionAsk, "deliveredAtMs">,
  lastListDeliveredAtMs: number | undefined,
  message: MessageTiming,
): "answer" | "ambiguous" | "no" {
  const delivered = ask.deliveredAtMs;
  const cardFirst =
    delivered !== undefined &&
    delivered + BARE_GAP_MS <= message.createdAtMs &&
    delivered < message.pollStartedAtMs &&
    (lastListDeliveredAtMs === undefined || lastListDeliveredAtMs <= delivered);
  if (cardFirst) return "answer";
  return lastListDeliveredAtMs === undefined ? "no" : "ambiguous";
}
