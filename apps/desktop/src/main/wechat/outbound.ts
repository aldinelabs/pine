// Everything the bridge sends to WeChat goes through `Outbound` (CMD §11).
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
import { MERGE_WINDOW_MS, REPLY_MAX, USABLE } from "./constants";
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

export class Outbound {
  private buffer: OutboundPush[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private chain: Promise<unknown> = Promise.resolve();
  private halted = false;
  private disposed = false;

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

  /** Withdraws a push that is waiting or queued (a decided card, an ended run). */
  retract(key: string): void {
    this.buffer = this.buffer.filter((pending) => pending.key !== key);
    if (this.deps.store.get().outQueue.some((item) => item.key === key)) {
      this.deps.store.updateSoon((draft) => {
        draft.outQueue = withoutKey(draft.outQueue, key);
      });
    }
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

  setTyping(on: boolean): void {
    const channel = this.deps.channel();
    const owner = this.deps.ownerUserId();
    if (!channel || owner === undefined || this.halted) return;
    const token = this.deps.store.get().contextToken?.value;
    void channel.setTyping(owner, token, on).catch(() => undefined);
  }

  /** Sends left on the current token. */
  remaining(): number {
    if (this.halted) return 0;
    return remainingSends(this.deps.store.get().contextToken);
  }

  /** Stops the merge timer; pushes still waiting are queued for the digest. */
  dispose(): void {
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
      const more =
        plan.overflow.length > 0
          ? this.deps.renderMoreCards?.(plan.overflow.length)
          : undefined;
      const named = more !== undefined;
      const unnamed = named ? [] : plan.overflow;
      const parts = plan.merged.map((item) => item.text);
      if (named) parts.push(more);
      const sent = await this.sendPush(1, parts.join(SEPARATOR), [
        ...plan.merged,
        ...(named ? plan.overflow : []),
      ]);
      if (sent !== undefined) {
        for (const item of plan.merged) this.deps.onDelivered?.(item.key, sent);
      }
      if (unnamed.length > 0) this.queue(unnamed);
    } else if (plan.overflow.length > 0) {
      this.queue(plan.overflow);
    }
    // Each P3 / P4 is its own message; `sendPush` queues it when it cannot go.
    for (const item of plan.single) {
      await this.sendPush(item.priority, item.text, [item]);
    }
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
