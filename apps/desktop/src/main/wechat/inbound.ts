// The inbound pipeline (plan section 5.2): acceptance, persistence, the
// priority lane, the serial worker, the stale rule, media staging, dispatch
// to the command handlers and the one reply per message.
//
// `onMessages` only persists and enqueues; it never handles a message and
// never downloads media, so the poller is released at once. Handling happens
// on two lanes: `stop`, `pause`, `reject`, `guide` and `kill` run on the
// priority lane, everything else on the serial worker, in arrival order.

import { APPROVAL_MODE_ORDER } from "../../shared/agent";
import type { WeChatSettings } from "../../shared/wechatRemote";
import type { AskBook } from "./asks";
import {
  AttachmentLimitError,
  AttachmentTimeoutError,
  AttachmentTooLargeError,
} from "./attachments";
import type { ChannelInboundMessage } from "./channel";
import { specOf } from "./commandSpec";
import {
  FILE_MAX_BYTES,
  FUTURE_SKEW_MS,
  INBOX_MAX,
  PAUSED_NOTICE_INTERVAL_MS,
  STALE_MS,
} from "./constants";
import type { HandleTables, Pager } from "./handles";
import type {
  CommandContext,
  CommandResult,
  HandlerRegistry,
} from "./handlers/types";
import type { Outbound } from "./outbound";
import { autoActionOf, parseCommand, splitAskPrefix } from "./parseCommand";
import type { InboundAttachmentsApi, WeChatCorePorts } from "./ports";
import type { RateLimits } from "./rateLimit";
import { joinReplies, parseMode, render } from "./replies";
import { WeChatRefusal, type SessionDirectory } from "./sessionDirectory";
import type {
  CommandName,
  ConfirmAsk,
  Parsed,
  ParsedCommand,
  ReplyLanguage,
  StoredInbound,
  StoredMedia,
  WeChatStateStore,
} from "./types";

/** Commands that act on asks: they never invalidate a pending confirmation. */
const ASK_COMMANDS: ReadonlySet<CommandName> = new Set([
  "pending",
  "show",
  "approve",
  "reject",
  "guide",
  "answer",
]);

export interface DispatchOptions {
  confirmed?: ConfirmAsk;
  heldConfirmed?: boolean;
  quotedText?: string;
}

export interface InboundPipelineDeps {
  store: WeChatStateStore;
  handlers: HandlerRegistry;
  asks: AskBook;
  handles: HandleTables;
  pager: Pager;
  limits: RateLimits;
  outbound: Outbound;
  attachments: InboundAttachmentsApi;
  sessions: SessionDirectory;
  core: WeChatCorePorts;
  host: CommandContext["host"];
  settings: () => WeChatSettings;
  lang: () => ReplyLanguage;
  now: () => number;
  /** The bound account; acceptance compares against it. */
  owner: () => { userId: string; botId: string } | undefined;
  paused: () => boolean;
  /** `ctx.bridge.pause()`: sets the pause flag and invalidates open asks. */
  pause: () => Promise<void>;
  /** Downloads a media reference over the current channel. */
  download: (
    ref: string,
    maxBytes: number,
    signal?: AbortSignal,
  ) => Promise<Buffer>;
  /** Sends `E-PAUSED` past the outbound gate, which is closed while paused. */
  sendDirect: (text: string, contextToken: string | undefined) => Promise<void>;
  /** Runs `work` with the outbound gate open although paused (the reply to `.pause`). */
  openWhilePaused: <T>(work: () => Promise<T>) => Promise<T>;
}

interface Inbound {
  id: string;
  createdAtMs: number;
  pollStartedAtMs: number;
  quotedText?: string;
}

/** Plan 5.1 invariant 1. */
export function acceptedMessage(
  message: ChannelInboundMessage,
  account: { userId: string; botId: string },
  seen: ReadonlySet<string>,
): boolean {
  return (
    message.id.length > 0 &&
    message.isUserMessage &&
    message.fromUserId === account.userId &&
    (message.toUserId === undefined ||
      message.toUserId === "" ||
      message.toUserId === account.botId) &&
    !message.groupId &&
    !seen.has(message.id)
  );
}

/** The stored form of an accepted message: text, voice flag, quote, media references. */
export function toStoredInbound(message: ChannelInboundMessage): StoredInbound {
  const entry: StoredInbound = {
    id: message.id,
    createdAtMs: message.createdAtMs,
    pollStartedAtMs: message.pollStartedAtMs,
    media: [],
  };
  if (message.text !== undefined && message.text.trim() !== "") {
    entry.text = message.text;
  } else if (message.voiceTranscript?.trim()) {
    // A transcript is a plain message, never a command.
    entry.text = message.voiceTranscript;
    entry.voice = true;
  }
  if (message.quotedText?.trim()) entry.quotedText = message.quotedText;
  for (const media of message.media) {
    if (media.kind === "voice") {
      if (entry.text === undefined) entry.voice = true;
      continue;
    }
    const stored: StoredMedia = { kind: media.kind, ref: media.ref };
    if (media.fileName !== undefined) stored.fileName = media.fileName;
    if (media.sizeBytes !== undefined) stored.sizeBytes = media.sizeBytes;
    entry.media.push(stored);
  }
  return entry;
}

/** How an entry reads: a transcript is always a plain message. */
export function classify(entry: StoredInbound): Parsed | undefined {
  if (entry.text === undefined) return undefined;
  if (entry.voice) return { kind: "message", text: entry.text };
  return parseCommand(entry.text);
}

/** CMD §5.5: too old, without a usable time, or dated in the future. */
export function isStale(createdAtMs: number, referenceMs: number): boolean {
  if (!Number.isFinite(createdAtMs) || createdAtMs <= 0) return true;
  if (createdAtMs > referenceMs + FUTURE_SKEW_MS) return true;
  return referenceMs - createdAtMs > STALE_MS;
}

/** Whether a started entry may run again after a restart (CMD §5.5). */
export function rerunnable(entry: StoredInbound): boolean {
  const parsed = classify(entry);
  if (!parsed) return true;
  switch (parsed.kind) {
    case "message":
    case "number":
      return false;
    case "unknown":
    case "invalid":
      return true;
    case "command": {
      const cls = specOf(parsed.name).cls;
      return cls === "R" || cls === "R+" || cls === "M-";
    }
  }
}

/** How an entry is listed when it is not run: its text, or its files. */
function describeEntry(entry: StoredInbound): string[] {
  if (entry.text !== undefined) return [entry.text];
  return entry.media.map((media) => `[${media.fileName ?? media.kind}]`);
}

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : "error";
}

function askNumberOf(
  parsed: Parsed,
  known: ReadonlySet<number>,
): number | undefined {
  if (parsed.kind !== "command") return undefined;
  const first = parsed.args[0];
  if (first !== undefined && /^\d+$/.test(first)) return Number(first);
  return splitAskPrefix(parsed.tail, known).ask;
}

export class InboundPipeline {
  /** Ids waiting for the serial worker, in arrival order. */
  private readonly queue: string[] = [];
  /** Accepted in this run: the stale rule measures them from their poll time. */
  private readonly acceptedNow = new Set<string>();
  /** Carried-over ids `resume` already queued or reported in this run. */
  private readonly replayed = new Set<string>();
  private worker: Promise<void> | undefined;
  private priority: Promise<void> = Promise.resolve();
  private readonly side = new Set<Promise<unknown>>();
  private digest: string | undefined;
  private stopped = false;
  /** Stale entries of the current drain, answered by one T-STALE. */
  private staleBatch: StoredInbound[] = [];

  constructor(private readonly deps: InboundPipelineDeps) {}

  // -------------------------------------------------------------------------
  // Poll side: persist and enqueue only

  /** `MessageChannel.onMessages`: acceptance, one store write, enqueue. */
  async onMessages(
    batch: readonly ChannelInboundMessage[],
    cursor: string | undefined,
  ): Promise<void> {
    const owner = this.deps.owner();
    const state = this.deps.store.get();
    const seen = new Set(state.seenMessageIds);
    const accepted: ChannelInboundMessage[] = [];
    for (const message of batch) {
      if (!owner || !acceptedMessage(message, owner, seen)) continue;
      seen.add(message.id);
      accepted.push(message);
    }
    const paused = this.deps.paused();
    const entries: StoredInbound[] = [];
    const overflow: string[] = [];
    let pausedNotice: { token: string | undefined } | undefined;
    if (paused) {
      const last = accepted.at(-1);
      const lastNotice = state.lastPausedNoticeAtMs ?? 0;
      if (last && this.deps.now() - lastNotice >= PAUSED_NOTICE_INTERVAL_MS) {
        pausedNotice = { token: last.contextToken };
      }
    } else {
      // The inbox keeps at most INBOX_MAX entries; what does not fit is never
      // run, and the user is told so once instead of losing it silently.
      let room = INBOX_MAX - state.inbox.length;
      for (const message of accepted) {
        this.renewBudget(message.contextToken);
        const entry = toStoredInbound(message);
        if (room > 0) {
          entries.push(entry);
          room -= 1;
        } else {
          overflow.push(...describeEntry(entry));
        }
      }
    }
    const nowMs = this.deps.now();
    await this.deps.store.update((draft) => {
      if (cursor !== undefined) draft.cursor = cursor;
      draft.seenMessageIds.push(...accepted.map((message) => message.id));
      draft.inbox.push(...entries);
      if (pausedNotice) draft.lastPausedNoticeAtMs = nowMs;
    });
    if (pausedNotice) {
      this.track(
        this.deps.sendDirect(
          render("E-PAUSED", this.deps.lang()),
          pausedNotice.token,
        ),
      );
    }
    if (overflow.length > 0) {
      this.track(
        this.sendReply(
          render("T-OVERFLOW", this.deps.lang(), { items: overflow }),
        ),
      );
    }
    for (const entry of entries) {
      this.acceptedNow.add(entry.id);
      const parsed = classify(entry);
      const stale = isStale(entry.createdAtMs, entry.pollStartedAtMs);
      if (
        !stale &&
        parsed?.kind === "command" &&
        specOf(parsed.name).priority
      ) {
        this.runPriority(entry.id);
      } else {
        this.queue.push(entry.id);
      }
    }
    this.kick();
  }

  /** Inbox entries left from the previous run (D17, CMD §5.5). */
  async resume(): Promise<void> {
    const inbox = this.deps.store.get().inbox;
    const interrupted: StoredInbound[] = [];
    for (const entry of inbox) {
      if (
        this.queue.includes(entry.id) ||
        this.acceptedNow.has(entry.id) ||
        this.replayed.has(entry.id)
      ) {
        continue;
      }
      // A second replay (SIGHUP) must not report an entry the worker holds.
      this.replayed.add(entry.id);
      if (entry.startedAtMs !== undefined && !rerunnable(entry)) {
        interrupted.push(entry);
      } else {
        this.queue.push(entry.id);
      }
    }
    if (interrupted.length > 0) {
      const ids = new Set(interrupted.map((entry) => entry.id));
      await this.deps.store.update((draft) => {
        draft.inbox = draft.inbox.filter((entry) => !ids.has(entry.id));
      });
      const items = interrupted
        .map((entry) => entry.text)
        .filter((text): text is string => text !== undefined);
      if (items.length > 0) {
        await this.sendReply(
          render("T-INTERRUPTED", this.deps.lang(), { items }),
        );
      }
    }
    this.kick();
  }

  /** Stops taking entries; the one being handled finishes. */
  stop(): void {
    this.stopped = true;
    // Entries never taken are replayed again by the next `resume`.
    for (const id of this.queue) this.replayed.delete(id);
    this.queue.length = 0;
  }

  /** Lets the worker run again after `stop` (a later `start`). */
  restart(): void {
    this.stopped = false;
  }

  /** Forgets in-memory lane state (unbind, re-pairing). */
  reset(): void {
    this.queue.length = 0;
    this.acceptedNow.clear();
    this.replayed.clear();
    this.staleBatch = [];
    this.digest = undefined;
  }

  /** Resolves once both lanes and the side sends are idle (tests, shutdown). */
  async idle(): Promise<void> {
    for (;;) {
      const priority = this.priority;
      const worker = this.worker;
      const side = [...this.side];
      await Promise.all([priority, worker?.catch(() => undefined), ...side]);
      if (
        worker === undefined &&
        priority === this.priority &&
        this.worker === undefined &&
        this.side.size === 0
      ) {
        return;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Dispatch with the gates shared by all commands

  /** Runs a parsed input through the shared gates and its handler. */
  dispatch(
    parsed: Parsed,
    inbound: Inbound,
    options: DispatchOptions = {},
  ): Promise<CommandResult> {
    const lang = this.deps.lang();
    if (
      this.deps.paused() &&
      !(parsed.kind === "command" && parsed.name === "pause")
    ) {
      return Promise.resolve({ text: render("E-PAUSED", lang) });
    }
    const ctx = this.context(inbound, options);
    switch (parsed.kind) {
      case "unknown":
        return this.resolved(
          `E-UNKNOWN:${parsed.token}`,
          render("E-UNKNOWN", lang, {
            token: parsed.token,
            ...(parsed.suggestion !== undefined
              ? { suggestion: parsed.suggestion }
              : {}),
          }),
        );
      case "invalid":
        return Promise.resolve({
          text: render("E-ARGS", lang, { spec: specOf(parsed.name) }),
        });
      case "number":
        return this.deps.handlers.number(ctx, parsed.numbers);
      case "message":
        if (!options.heldConfirmed) this.invalidateHeld();
        return this.deps.handlers.message(ctx, parsed.text);
      case "command":
        return this.runCommand(ctx, parsed, options);
    }
  }

  private runCommand(
    ctx: CommandContext,
    command: ParsedCommand,
    options: DispatchOptions,
  ): Promise<CommandResult> {
    const lang = this.deps.lang();
    const spec = specOf(command.name);
    if (spec.needsCurrent && !this.deps.store.get().current) {
      return this.resolved("E-NOSESSION", render("E-NOSESSION", lang));
    }
    if (!options.confirmed && !ASK_COMMANDS.has(command.name)) {
      if (spec.cls === "M" || spec.cls === "D") this.invalidateConfirms();
    }
    if (command.name === "new" && !options.heldConfirmed) this.invalidateHeld();
    const handler = this.deps.handlers.commands[command.name];
    if (!handler) {
      console.error(`WeChat command .${command.name} has no handler.`);
      return Promise.resolve({ text: render("E-FAIL", lang) });
    }
    return handler(ctx, command);
  }

  private invalidateConfirms(): void {
    this.deps.asks.closeWhere((ask) => ask.kind === "confirm", "invalidated");
  }

  private invalidateHeld(): void {
    this.deps.asks.closeWhere((ask) => ask.kind === "held", "invalidated");
  }

  private context(inbound: Inbound, options: DispatchOptions): CommandContext {
    const deps = this.deps;
    const quotedText = options.quotedText ?? inbound.quotedText;
    const ctxInbound: CommandContext["inbound"] = {
      id: inbound.id,
      createdAtMs: inbound.createdAtMs,
      pollStartedAtMs: inbound.pollStartedAtMs,
      ...(quotedText !== undefined ? { quotedText } : {}),
    };
    return {
      get now() {
        return deps.now();
      },
      lang: deps.lang(),
      inbound: ctxInbound,
      ...(options.confirmed ? { confirmed: options.confirmed } : {}),
      heldConfirmed: options.heldConfirmed ?? false,
      get settings() {
        return deps.settings();
      },
      core: deps.core,
      host: deps.host,
      store: deps.store,
      sessions: deps.sessions,
      asks: deps.asks,
      handles: deps.handles,
      pager: deps.pager,
      limits: deps.limits,
      outbound: deps.outbound,
      attachments: deps.attachments,
      bridge: {
        pause: () => deps.pause(),
        dispatch: (parsed, next) => this.dispatch(parsed, inbound, next ?? {}),
      },
    };
  }

  // -------------------------------------------------------------------------
  // Lanes

  private renewBudget(contextToken: string | undefined): void {
    const stored = this.deps.store.get().contextToken?.value;
    if (contextToken !== undefined && contextToken !== stored) {
      this.deps.limits.reset();
    }
    const digest = this.deps.outbound.onInbound(contextToken);
    if (digest) this.digest = joinReplies(this.digest, digest);
  }

  private track(work: Promise<unknown>): void {
    const tracked = work.catch(() => undefined);
    this.side.add(tracked);
    void tracked.finally(() => this.side.delete(tracked));
  }

  private runPriority(id: string): void {
    const next = this.priority.then(() => this.handleEntry(id, false));
    this.priority = next.catch((error: unknown) => {
      console.error("WeChat priority command failed.", describe(error));
    });
  }

  private kick(): void {
    if (this.worker || this.stopped) return;
    this.worker = this.drain().finally(() => {
      this.worker = undefined;
      if (this.queue.length > 0 && !this.stopped) this.kick();
    });
  }

  private async drain(): Promise<void> {
    while (!this.stopped) {
      const id = this.queue.shift();
      if (id === undefined) break;
      const entry = this.entry(id);
      if (!entry) continue;
      if (isStale(entry.createdAtMs, this.referenceMs(entry))) {
        await this.handleStale(entry).catch((error: unknown) => {
          console.error("WeChat stale message failed.", describe(error));
        });
        continue;
      }
      await this.flushStale();
      await this.handleEntry(id, true).catch((error: unknown) => {
        console.error("WeChat message failed.", describe(error));
      });
    }
    await this.flushStale().catch((error: unknown) => {
      console.error("WeChat stale digest failed.", describe(error));
    });
  }

  private entry(id: string): StoredInbound | undefined {
    return this.deps.store.get().inbox.find((entry) => entry.id === id);
  }

  private referenceMs(entry: StoredInbound): number {
    return this.acceptedNow.has(entry.id)
      ? entry.pollStartedAtMs
      : this.deps.now();
  }

  private async markStarted(id: string): Promise<void> {
    const at = this.deps.now();
    await this.deps.store.update((draft) => {
      const entry = draft.inbox.find((item) => item.id === id);
      if (entry) entry.startedAtMs = at;
    });
  }

  private async remove(ids: readonly string[]): Promise<void> {
    const drop = new Set(ids);
    await this.deps.store.update((draft) => {
      draft.inbox = draft.inbox.filter((entry) => !drop.has(entry.id));
    });
  }

  /** One fresh entry: stage media, classify, dispatch, reply, clean up. */
  private async handleEntry(id: string, worker: boolean): Promise<void> {
    const entry = this.entry(id);
    if (!entry) return;
    if (this.deps.paused()) {
      // Accepted before the pause: after pausing no command is accepted.
      await this.remove([id]);
      return;
    }
    await this.markStarted(id);
    const lang = this.deps.lang();
    const inbound: Inbound = {
      id: entry.id,
      createdAtMs: entry.createdAtMs,
      pollStartedAtMs: entry.pollStartedAtMs,
      ...(entry.quotedText !== undefined
        ? { quotedText: entry.quotedText }
        : {}),
    };
    let result: CommandResult;
    let parsed: Parsed | undefined;
    try {
      const staged = worker ? await this.stageMedia(entry) : { replies: [] };
      parsed = classify(entry);
      if (staged.failure !== undefined) {
        result = { text: staged.failure };
      } else if (parsed) {
        result = await this.dispatch(parsed, inbound);
      } else if (entry.voice) {
        result = this.errorResult("E-VOICE", render("E-VOICE", lang));
      } else if (staged.replies.length > 0) {
        result = { text: joinReplies(...staged.replies) };
      } else if (entry.quotedText !== undefined) {
        result = { text: render("E-QUOTE", lang) };
      } else {
        result = {};
      }
    } catch (error) {
      result = { text: this.errorText(error, parsed) };
    }
    await this.deliver(result, parsed);
    await this.remove([id]);
    await this.deps.sessions.noteAccepted(this.deps.now());
  }

  /** Downloads and stages the entry's media (the worker only; D15). */
  private async stageMedia(
    entry: StoredInbound,
  ): Promise<{ replies: string[]; failure?: string }> {
    const lang = this.deps.lang();
    const replies: string[] = [];
    for (const media of entry.media) {
      try {
        const staged = await this.deps.attachments.stage(
          media,
          (ref, max, signal) =>
            this.deps.download(ref, Math.min(max, FILE_MAX_BYTES), signal),
        );
        replies.push(
          render("R-ATTACH", lang, {
            name: staged.name,
            sizeBytes: staged.sizeBytes,
          }),
        );
      } catch (error) {
        if (error instanceof AttachmentTooLargeError) {
          return {
            replies,
            failure: render("E-SIZE", lang, {
              variant: "file",
              name: error.displayName,
              sizeBytes: error.sizeBytes ?? error.maxBytes,
            }),
          };
        }
        if (
          !(error instanceof AttachmentLimitError) &&
          !(error instanceof AttachmentTimeoutError)
        ) {
          console.error("WeChat media could not be staged.", describe(error));
        }
        return { replies, failure: render("E-FAIL", lang) };
      }
    }
    // Media that rides on typed text is acknowledged by that text's reply.
    return { replies: entry.text === undefined ? replies : [] };
  }

  /** Sends the result (with the digest in front) and marks what it delivered. */
  private async deliver(
    result: CommandResult,
    parsed: Parsed | undefined,
  ): Promise<void> {
    const text = result.text?.trim() ? result.text : undefined;
    if (text === undefined && this.digest === undefined) {
      if (parsed?.kind === "message") this.deps.outbound.setTyping(true);
    } else {
      const sentAt =
        parsed?.kind === "command" && parsed.name === "pause"
          ? await this.deps.openWhilePaused(() => this.sendReply(text))
          : await this.sendReply(text);
      if (sentAt !== undefined && text !== undefined) {
        if (result.numbered) {
          this.deps.handles.noteDelivered(result.numbered.kind, sentAt);
          const snapshot = this.deps.handles.snapshot();
          this.deps.store.updateSoon((draft) => {
            draft.handles = snapshot;
          });
        }
        for (const shown of result.shown ?? []) {
          if (shown.full) this.deps.asks.markShown(shown.ask, sentAt);
          else this.deps.asks.markDelivered(shown.ask, sentAt);
        }
      }
    }
    if (result.after) {
      await result.after().catch((error: unknown) => {
        console.error("WeChat follow-up failed.", describe(error));
      });
    }
  }

  /** One P0 send: the pending digest first, then `text`. */
  private async sendReply(
    text: string | undefined,
  ): Promise<number | undefined> {
    const digest = this.digest;
    this.digest = undefined;
    const message = joinReplies(digest, text);
    if (!message) return undefined;
    const sentAt = await this.deps.outbound.reply(message);
    if (
      sentAt === undefined &&
      digest !== undefined &&
      this.digest === undefined
    ) {
      // Not sent: keep the digest for the next reply.
      this.digest = digest;
    }
    return sentAt;
  }

  private errorResult(key: string, text: string): CommandResult {
    return this.deps.limits.repeatAllowed(key) ? { text } : {};
  }

  private resolved(key: string, text: string): Promise<CommandResult> {
    return Promise.resolve(this.errorResult(key, text));
  }

  /** CMD §10.3: refusals render, known Pine errors map, the rest is E-FAIL. */
  private errorText(error: unknown, parsed: Parsed | undefined): string {
    const lang = this.deps.lang();
    if (error instanceof WeChatRefusal) return error.render(lang);
    const message = error instanceof Error ? error.message : "";
    if (message === "This approval request is no longer pending.") {
      const ask = parsed
        ? askNumberOf(parsed, this.deps.asks.knownNumbers())
        : undefined;
      if (ask !== undefined) return render("E-DONE", lang, { ask });
    }
    if (
      message === "This session is open in another window." ||
      message.includes("does not belong to this window.")
    ) {
      return render("E-OTHERWIN", lang);
    }
    console.error("WeChat command failed.", describe(error));
    return render("E-FAIL", lang);
  }

  // -------------------------------------------------------------------------
  // Stale entries (CMD §5.5)

  private async handleStale(entry: StoredInbound): Promise<void> {
    if (this.deps.paused()) {
      await this.remove([entry.id]);
      return;
    }
    const parsed = classify(entry);
    if (parsed?.kind === "command") {
      const spec = specOf(parsed.name);
      if (spec.stale === "run") {
        await this.flushStale();
        await this.handleEntry(entry.id, true);
        return;
      }
      // `.mode` when tightening and `.auto N off` are guard commands though
      // their other forms are dropped (CMD §5.5).
      if (
        spec.stale === "guard" ||
        parsed.name === "mode" ||
        parsed.name === "auto"
      ) {
        if (await this.guardTargetExisted(parsed, entry)) {
          await this.flushStale();
          await this.handleEntry(entry.id, true);
          return;
        }
      }
    }
    await this.markStarted(entry.id);
    this.staleBatch.push(entry);
  }

  /** Whether the target of a `guard` command existed when the message was written. */
  private async guardTargetExisted(
    command: ParsedCommand,
    entry: StoredInbound,
  ): Promise<boolean> {
    const at = entry.createdAtMs;
    if (!Number.isFinite(at) || at <= 0 || at > this.deps.now()) return false;
    const { asks, handles, store, sessions } = this.deps;
    switch (command.name) {
      case "reject":
      case "guide": {
        const number = askNumberOf(command, asks.knownNumbers());
        const candidates =
          number !== undefined
            ? [asks.get(number)]
            : asks
                .list()
                .filter(
                  (ask) => ask.kind === "approval" || ask.kind === "question",
                );
        if (candidates.length !== 1) return false;
        const ask = candidates[0];
        return ask !== undefined && ask.createdAtMs <= at;
      }
      case "kill":
      case "unqueue": {
        const current = store.get().current;
        if (!current) return false;
        const first = command.args[0];
        if (first !== undefined && /^\d+$/.test(first)) {
          const table = handles.table(
            command.name === "kill" ? "task" : "queue",
          );
          return (
            table !== undefined &&
            table.sessionId === current.sessionId &&
            table.sentAtMs <= at
          );
        }
        return this.runStartedBefore(sessions, current, at);
      }
      case "stop": {
        const current = store.get().current;
        if (!current) return false;
        return this.runStartedBefore(sessions, current, at);
      }
      case "mode": {
        const current = store.get().current;
        const arg = command.args[0];
        const target = arg === undefined ? undefined : parseMode(arg);
        if (!current || !target) return false;
        const existed =
          current.usedAtMs <= at ||
          store
            .get()
            .tracked.some(
              (entry) =>
                entry.sessionId === current.sessionId &&
                entry.trackedAtMs <= at,
            ) ||
          (await this.runStartedBefore(sessions, current, at));
        if (!existed) return false;
        try {
          const now = await sessions.sessionMode(
            current.sessionId,
            current.projectId,
          );
          return (
            APPROVAL_MODE_ORDER.indexOf(target) <
            APPROVAL_MODE_ORDER.indexOf(now)
          );
        } catch {
          return false;
        }
      }
      case "auto": {
        const [ref, word] = command.args;
        if (ref === undefined || autoActionOf(word) !== "off") return false;
        if (!/^\d+$/.test(ref)) return true;
        const table = handles.table("automation");
        return (
          table !== undefined &&
          table.sentAtMs <= at &&
          handles.resolve("automation", Number(ref)) !== undefined
        );
      }
      default:
        return false;
    }
  }

  private async runStartedBefore(
    sessions: SessionDirectory,
    current: { projectId: string; sessionId: string },
    at: number,
  ): Promise<boolean> {
    const state = sessions.runState(current.sessionId);
    if (state !== "running" && state !== "waiting") return false;
    try {
      const view = await sessions.view(current.sessionId, current.projectId);
      return view.runStartedAtMs !== undefined && view.runStartedAtMs <= at;
    } catch {
      return false;
    }
  }

  /** Answers the stale entries collected so far with one T-STALE and at most one held ask. */
  private async flushStale(): Promise<void> {
    const batch = this.staleBatch;
    if (batch.length === 0) return;
    this.staleBatch = [];
    const lang = this.deps.lang();
    const held: StoredInbound[] = [];
    const notRun: string[] = [];
    for (const entry of batch) {
      const parsed = classify(entry);
      if (
        parsed?.kind === "message" ||
        (parsed?.kind === "command" &&
          specOf(parsed.name).stale === "hold" &&
          (parsed.name !== "queue" || Boolean(parsed.tail?.trim())))
      ) {
        held.push(entry);
      } else if (entry.text !== undefined) {
        notRun.push(entry.text);
      } else {
        for (const media of entry.media)
          notRun.push(`[${media.fileName ?? media.kind}]`);
      }
    }
    // Media of held messages is staged now, so it rides along when they run.
    for (const entry of held) {
      if (entry.media.length > 0) await this.stageMedia(entry);
    }
    const reference = this.deps.now();
    const times = batch
      .map((entry) => entry.createdAtMs)
      .filter((at) => Number.isFinite(at) && at > 0 && at <= reference);
    const oldestAgeMs = times.length > 0 ? reference - Math.min(...times) : 0;
    let ask: number | undefined;
    if (held.length > 0) {
      const opened = this.deps.asks.open({
        kind: "held",
        reason: "stale",
        items: held.map((entry) => ({ ...entry, media: [] })),
      });
      ask = opened?.number;
    }
    const text =
      ask === undefined && held.length > 0
        ? render("T-STALE", lang, {
            held: [],
            notRun: [...held.map((entry) => entry.text ?? ""), ...notRun],
            oldestAgeMs,
          })
        : render("T-STALE", lang, {
            held: held.map((entry) => entry.text ?? ""),
            notRun,
            oldestAgeMs,
            ...(ask !== undefined ? { ask } : {}),
          });
    const sentAt = await this.sendReply(text);
    if (sentAt !== undefined && ask !== undefined) {
      this.deps.asks.markDelivered(ask, sentAt);
    }
    await this.remove(batch.map((entry) => entry.id));
    await this.deps.sessions.noteAccepted(this.deps.now());
  }
}
