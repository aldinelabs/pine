// Everything the bridge sends to WeChat goes through `Outbound`.
// Replies (P0) go first; pushes (P1-P4) are merged within MERGE_WINDOW_MS,
// sent while the token's budget allows their priority, and otherwise queued
// for the digest that leads the reply to the user's next message.

import {
  allows,
  budgetNoticeDue,
  enqueue,
  planMerge,
  remainingSends,
  withoutKey,
  type OutboundPriority,
} from "./budget";
import type { ChannelSendResult, MessageChannel } from "./channel";
import {
  MERGE_WINDOW_MS,
  PROGRESS_AFTER_MS,
  REPLY_MAX,
  USABLE,
} from "./constants";
import type { DigestItem, WeChatStateStore } from "./types";

export interface OutboundPush {
  /** Collapses and retracts: "ask:<n>", "result:<sessionId>", "progress:<sessionId>", "autorun:<id>", "auto-on:<id>". */
  key: string;
  priority: 1 | 2 | 3 | 4;
  text: string;
  /** What the digest says when the push could not be sent. */
  digest: DigestItem;
}

export interface OutboundDeps {
  channel: () => MessageChannel | undefined;
  ownerUserId: () => string | undefined;
  store: WeChatStateStore;
  now: () => number;
  renderDigest(items: DigestItem[]): string;
  renderBudgetNotice(): string;
  /** `T-MORECARDS`. Without it, cards beyond the merge limit are queued instead. */
  renderMoreCards?(n: number): string;
  /** A push was delivered (all keys of a merged message, with its send time). */
  onDelivered?(key: string, atMs: number): void;
  /** A send answered "scan again": sending stops until the next inbound message. */
  onReauthRequired?(): void;
}

const SEPARATOR = "\n\n";

/**
 * The pushes (and an optional trailing line) joined fit in one message. The
 * count includes Markdown markup; each push closes its own blocks, so a blank
 * line between them keeps them apart.
 */
function fits(items: readonly OutboundPush[], tail?: string): boolean {
  const parts = items.map((item) => item.text);
  if (tail !== undefined) parts.push(tail);
  return Array.from(parts.join(SEPARATOR)).length <= REPLY_MAX;
}

/** Splits pushes, in order, into messages of at most REPLY_MAX code points (markup included). */
function fitChunks(items: readonly OutboundPush[]): OutboundPush[][] {
  const chunks: OutboundPush[][] = [];
  let current: OutboundPush[] = [];
  for (const item of items) {
    if (current.length > 0 && !fits([...current, item])) {
      chunks.push(current);
      current = [];
    }
    current.push(item);
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

export class Outbound {
  private buffer: OutboundPush[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private chain: Promise<unknown> = Promise.resolve();
  private halted = false;
  private disposed = false;
  /** "Typing…" is on in WeChat; it ends with the next message out or the run. */
  private typing = false;
  private typingTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly deps: OutboundDeps) {}

  /** A new inbound message arrived: renew the budget for its token; returns the digest text of everything queued (and empties the queue), or undefined. */
  onInbound(contextToken: string | undefined): string | undefined {
    this.halted = false;
    const now = this.deps.now();
    const queued = this.deps.store.get().outQueue;
    this.deps.store.updateSoon((draft) => {
      if (contextToken !== undefined) {
        draft.contextToken = {
          value: contextToken,
          receivedAtMs: now,
          sent: 0,
          budgetNoticeSent: false,
        };
      }
      draft.outQueue = [];
    });
    if (queued.length === 0) return undefined;
    return this.deps.renderDigest(queued.map((item) => item.digest));
  }

  /** P0. Resolves with the send time once sent, or undefined when it could not be sent. */
  reply(text: string): Promise<number | undefined> {
    return this.serial(async () => {
      const token = this.deps.store.get().contextToken;
      let message = text;
      if (token) {
        const remaining = this.remaining();
        if (!allows(0, remaining)) return undefined;
        if (budgetNoticeDue(remaining, token.budgetNoticeSent)) {
          const withNotice = `${text}${SEPARATOR}${this.deps.renderBudgetNotice()}`;
          if (Array.from(withNotice).length <= REPLY_MAX) {
            message = withNotice;
            this.markNoticeSent();
          }
        }
      }
      return this.send(message);
    });
  }

  /** P1-P4. Merged with the pushes of the next MERGE_WINDOW_MS, then sent or queued. */
  push(item: OutboundPush): void {
    if (this.halted || this.disposed) {
      this.queue([item]);
      return;
    }
    this.buffer = this.buffer.filter((pending) => pending.key !== item.key);
    this.buffer.push(item);
    this.timer ??= setTimeout(() => this.flush(), MERGE_WINDOW_MS);
  }

  /**
   * Withdraws a push that is waiting or queued (a decided card, an ended run).
   * Returns whether one was withdrawn; false once it is being sent or was sent.
   */
  retract(key: string): boolean {
    const buffered = this.buffer.length;
    this.buffer = this.buffer.filter((pending) => pending.key !== key);
    const queued = this.deps.store
      .get()
      .outQueue.some((item) => item.key === key);
    if (queued) {
      this.deps.store.updateSoon((draft) => {
        draft.outQueue = withoutKey(draft.outQueue, key);
      });
    }
    return queued || this.buffer.length !== buffered;
  }

  sendFile(file: { name: string; data: Buffer }): Promise<ChannelSendResult> {
    return this.serial(async () => {
      if (this.halted) return { ok: false, reason: "reauth-required" };
      const channel = this.deps.channel();
      const owner = this.deps.ownerUserId();
      if (!channel || owner === undefined) {
        return { ok: false, reason: "network" };
      }
      const token = this.deps.store.get().contextToken;
      if (token && !allows(0, this.remaining())) {
        return { ok: false, reason: "rejected" };
      }
      this.setTyping(false);
      let result: ChannelSendResult;
      try {
        result = await channel.sendFile(owner, token?.value, file);
      } catch {
        result = { ok: false, reason: "network" };
      }
      this.settle(token?.value, result);
      return result;
    });
  }

  /**
   * Shows or cancels "typing…" in WeChat. It is cancelled when the run ends,
   * right before the next message goes out, on pause or halt, and at the
   * latest after PROGRESS_AFTER_MS, so the keepalive never runs on.
   */
  setTyping(on: boolean): void {
    if (this.typingTimer !== undefined) clearTimeout(this.typingTimer);
    this.typingTimer = undefined;
    if (!on && !this.typing) return;
    const channel = this.deps.channel();
    const owner = this.deps.ownerUserId();
    if (!channel || owner === undefined || (on && this.halted)) {
      this.typing = false;
      return;
    }
    this.typing = on;
    const token = this.deps.store.get().contextToken?.value;
    void channel.setTyping(owner, token, on).catch(() => undefined);
    if (on) {
      this.typingTimer = setTimeout(
        () => this.setTyping(false),
        PROGRESS_AFTER_MS,
      );
      this.typingTimer.unref?.();
    }
  }

  /**
   * The channel reported an expired token (iLink -14): send nothing, queue
   * pushes for the digest, until the next inbound message renews the budget.
   */
  halt(): void {
    this.setTyping(false);
    this.halted = true;
  }

  /** Sends left on the current token. */
  remaining(): number {
    if (this.halted) return 0;
    return remainingSends(this.deps.store.get().contextToken);
  }

  /** Stops the merge timer; pushes still waiting are queued for the digest. */
  dispose(): void {
    this.setTyping(false);
    this.disposed = true;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    const waiting = this.buffer;
    this.buffer = [];
    this.queue(waiting);
  }

  private flush(): void {
    this.timer = undefined;
    const items = this.buffer;
    this.buffer = [];
    if (items.length === 0) return;
    void this.serial(() => this.sendPushes(items)).catch(() => undefined);
  }

  private async sendPushes(items: OutboundPush[]): Promise<void> {
    const plan = planMerge(items);
    if (plan.merged.length > 0) {
      const merge = this.fitMerged(plan.merged, plan.overflow);
      const parts = merge.included.map((item) => item.text);
      if (merge.more !== undefined) parts.push(merge.more);
      const sent = await this.sendPush(1, parts.join(SEPARATOR), [
        ...merge.included,
        ...(merge.more !== undefined ? merge.overflow : []),
      ]);
      if (sent !== undefined) {
        for (const item of merge.included) {
          this.deps.onDelivered?.(item.key, sent);
        }
      }
      if (merge.more === undefined) this.queue(merge.overflow);
      // Results that did not fit go in further P2 messages, each within REPLY_MAX.
      for (const chunk of fitChunks(merge.leftover)) {
        const sentAt = await this.sendPush(
          2,
          chunk.map((item) => item.text).join(SEPARATOR),
          chunk,
        );
        if (sentAt !== undefined) {
          for (const item of chunk) this.deps.onDelivered?.(item.key, sentAt);
        }
      }
    } else if (plan.overflow.length > 0) {
      this.queue(plan.overflow);
    }
    // Each P3 / P4 is its own message; `sendPush` queues it when it cannot go.
    for (const item of plan.single) {
      await this.sendPush(item.priority, item.text, [item]);
    }
  }

  /**
   * Fills the merged message greedily within REPLY_MAX (one message,
   * never split): cards first, then results, then the T-MORECARDS
   * line. Cards that do not fit join `overflow`; results that do not fit are
   * `leftover`. The message always keeps its first item.
   */
  private fitMerged(
    merged: readonly OutboundPush[],
    planOverflow: readonly OutboundPush[],
  ): {
    included: OutboundPush[];
    overflow: OutboundPush[];
    leftover: OutboundPush[];
    more?: string;
  } {
    const cards = merged.filter((item) => item.priority === 1);
    const results = merged.filter((item) => item.priority !== 1);
    const included: OutboundPush[] = [];
    let index = 0;
    while (index < cards.length) {
      const card = cards[index];
      if (!card) break;
      if (included.length > 0 && !fits([...included, card])) break;
      included.push(card);
      index += 1;
    }
    let overflow = [...cards.slice(index), ...planOverflow];
    let more: string | undefined;
    while (overflow.length > 0 && this.deps.renderMoreCards) {
      const line = this.deps.renderMoreCards(overflow.length);
      if (fits(included, line)) {
        more = line;
        break;
      }
      const last = included.length > 1 ? included.pop() : undefined;
      if (!last) break;
      overflow = [last, ...overflow];
    }
    const leftover: OutboundPush[] = [];
    for (const item of results) {
      if (
        leftover.length === 0 &&
        (included.length === 0 || fits([...included, item], more))
      ) {
        included.push(item);
      } else {
        leftover.push(item);
      }
    }
    return { included, overflow, leftover, ...(more ? { more } : {}) };
  }

  /** Sends one push message when the budget allows `priority`; otherwise queues `items`. Returns the send time. */
  private async sendPush(
    priority: OutboundPriority,
    text: string,
    items: OutboundPush[],
  ): Promise<number | undefined> {
    const remaining = this.remaining();
    if (!allows(priority, remaining)) {
      this.queue(items);
      await this.sendBudgetNoticeIfDue();
      return undefined;
    }
    const sent = await this.send(text);
    if (sent === undefined) {
      this.queue(items);
      return undefined;
    }
    if (items.length === 1 && priority >= 3) {
      const [item] = items;
      if (item) this.deps.onDelivered?.(item.key, sent);
    }
    return sent;
  }

  private async sendBudgetNoticeIfDue(): Promise<void> {
    const token = this.deps.store.get().contextToken;
    if (!token || !budgetNoticeDue(this.remaining(), token.budgetNoticeSent)) {
      return;
    }
    this.markNoticeSent();
    await this.send(this.deps.renderBudgetNotice());
  }

  /** One `sendText`; counts it against the token, or marks the token exhausted. */
  private async send(text: string): Promise<number | undefined> {
    if (this.halted) return undefined;
    const channel = this.deps.channel();
    const owner = this.deps.ownerUserId();
    if (!channel || owner === undefined) return undefined;
    const token = this.deps.store.get().contextToken?.value;
    this.setTyping(false);
    let result: ChannelSendResult;
    try {
      result = await channel.sendText(owner, token, text);
    } catch {
      result = { ok: false, reason: "network" };
    }
    this.settle(token, result);
    return result.ok ? this.deps.now() : undefined;
  }

  /**
   * After a send: success spends one slot; any failure marks the token
   * exhausted so nothing is retried until the next inbound message (no
   * retry storm), and "reauth-required" stops sending altogether.
   */
  private settle(token: string | undefined, result: ChannelSendResult): void {
    if (token !== undefined) {
      this.deps.store.updateSoon((draft) => {
        if (draft.contextToken?.value !== token) return;
        draft.contextToken.sent = result.ok
          ? draft.contextToken.sent + 1
          : Math.max(draft.contextToken.sent, USABLE);
      });
    }
    if (!result.ok && result.reason === "reauth-required" && !this.halted) {
      this.halted = true;
      this.deps.onReauthRequired?.();
    }
  }

  private markNoticeSent(): void {
    this.deps.store.updateSoon((draft) => {
      if (draft.contextToken) draft.contextToken.budgetNoticeSent = true;
    });
  }

  private queue(items: readonly OutboundPush[]): void {
    if (items.length === 0) return;
    const now = this.deps.now();
    this.deps.store.updateSoon((draft) => {
      let next = draft.outQueue;
      for (const item of items) {
        next = enqueue(next, {
          key: item.key,
          priority: item.priority,
          digest: item.digest,
          queuedAtMs: now,
        });
      }
      draft.outQueue = next;
    });
  }

  private serial<T>(task: () => Promise<T>): Promise<T> {
    const run = this.chain.then(task, task);
    this.chain = run.catch(() => undefined);
    return run;
  }
}
