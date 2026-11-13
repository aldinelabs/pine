// The ClawBot adapter: Tencent's iLink bot protocol behind the bridge's
// message-channel interface. Media references, tokens and context tokens
// pass through here; none of them is ever logged.
import {
  IlinkApiError,
  IlinkClient,
  IlinkMediaTooLargeError,
  type IlinkTransportOptions,
  type MessageItem,
  MessageItemType,
  MessageType,
  type PollerState,
  type QrLoginEvent,
  TYPING_KEEPALIVE_MS,
  defaultAllowUrl,
  downloadMedia,
  startPoller,
  startQrLogin,
  uploadMedia,
  type Fetch,
  type Poller,
  type UrlPurpose,
  type WeixinMessage,
} from "@pine/wechat-ilink";
import type {
  ChannelBindingEvent,
  ChannelFactory,
  ChannelHandlers,
  ChannelInboundMedia,
  ChannelInboundMessage,
  ChannelSendResult,
  ChannelState,
  MessageChannel,
} from "./channel";

export interface ClawBotChannelOptions {
  fetch: Fetch;
  /** Pine's version, declared to the iLink server. */
  version: string;
  /** Tests point these at the mock iLink server. */
  apiBaseUrl?: string;
  cdnBaseUrl?: string;
  /** Default: the package's `defaultAllowUrl`. */
  allowUrl?: (url: URL, purpose: UrlPurpose) => boolean;
  /** Interval of the typing keepalive. Default `TYPING_KEEPALIVE_MS` (tests shorten it). */
  typingKeepaliveMs?: number;
}

/** Typing tickets are refreshed at a random point within this period. */
const TICKET_REFRESH_MS = 24 * 60 * 60_000;
const TICKET_RETRY_FIRST_MS = 2_000;
const TICKET_RETRY_MAX_MS = 60 * 60_000;

type MediaItemKind = "image" | "video" | "file" | "voice";

function itemKind(item: MessageItem): number | undefined {
  if (typeof item.type === "number" && item.type !== MessageItemType.NONE) {
    return item.type;
  }
  if (item.text_item) return MessageItemType.TEXT;
  if (item.image_item) return MessageItemType.IMAGE;
  if (item.video_item) return MessageItemType.VIDEO;
  if (item.file_item) return MessageItemType.FILE;
  if (item.voice_item) return MessageItemType.VOICE;
  return undefined;
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** `message_id`, else the first item's `msg_id`. */
function messageId(message: WeixinMessage): string | undefined {
  const direct = nonEmpty(message.message_id);
  if (direct) return direct;
  for (const item of message.item_list ?? []) {
    const id = nonEmpty(item?.msg_id);
    if (id) return id;
  }
  return undefined;
}

/** Text of an item for a quote: the typed text or the voice transcript. */
function quotedBody(item: MessageItem | undefined): string | undefined {
  if (!item) return undefined;
  return (
    nonEmpty(item.text_item?.text?.trim()) ??
    nonEmpty(item.voice_item?.text?.trim())
  );
}

function quoteOf(items: readonly MessageItem[]): string | undefined {
  const ref = items.find((item) => item.ref_msg)?.ref_msg;
  if (!ref) return undefined;
  const parts = [nonEmpty(ref.title?.trim()), quotedBody(ref.message_item)];
  const text = parts.filter((part) => part !== undefined).join(" | ");
  return text.length > 0 ? text : undefined;
}

/** Only the media part of an item: the reference handed back to `downloadMedia`. */
function mediaRef(item: MessageItem, kind: MediaItemKind): string {
  switch (kind) {
    case "image":
      return JSON.stringify({
        type: MessageItemType.IMAGE,
        image_item: item.image_item,
      });
    case "video":
      return JSON.stringify({
        type: MessageItemType.VIDEO,
        video_item: item.video_item,
      });
    case "file":
      return JSON.stringify({
        type: MessageItemType.FILE,
        file_item: item.file_item,
      });
    case "voice":
      return JSON.stringify({
        type: MessageItemType.VOICE,
        voice_item: item.voice_item,
      });
  }
}

function hasLocation(
  media: { encrypt_query_param?: string; full_url?: string } | undefined,
): boolean {
  return Boolean(media && (media.encrypt_query_param || media.full_url));
}

function mediaOf(item: MessageItem): ChannelInboundMedia | undefined {
  switch (itemKind(item)) {
    case MessageItemType.IMAGE:
      if (!hasLocation(item.image_item?.media)) return undefined;
      return { kind: "image", ref: mediaRef(item, "image") };
    case MessageItemType.VIDEO:
      if (!hasLocation(item.video_item?.media)) return undefined;
      return { kind: "video", ref: mediaRef(item, "video") };
    case MessageItemType.FILE: {
      const file = item.file_item;
      if (!hasLocation(file?.media)) return undefined;
      const media: ChannelInboundMedia = {
        kind: "file",
        ref: mediaRef(item, "file"),
      };
      const fileName = nonEmpty(file?.file_name);
      if (fileName) media.fileName = fileName;
      const size = Number(file?.len);
      if (file?.len !== undefined && Number.isSafeInteger(size) && size >= 0) {
        media.sizeBytes = size;
      }
      return media;
    }
    case MessageItemType.VOICE:
      // A voice message with a transcript is text; without one it is
      // reported so the user can be told it was not understood.
      if (nonEmpty(item.voice_item?.text?.trim())) return undefined;
      return { kind: "voice", ref: mediaRef(item, "voice") };
    default:
      return undefined;
  }
}

/**
 * One wire message as the bridge sees it, or `undefined` when it has no id.
 * Only the first TEXT item becomes `text`; transcripts and quotes stay
 * separate so they are never parsed as commands.
 */
export function normaliseMessage(
  message: WeixinMessage,
  pollStartedAtMs: number,
): ChannelInboundMessage | undefined {
  const id = messageId(message);
  if (!id) return undefined;
  const items = (message.item_list ?? []).filter(
    (item): item is MessageItem => typeof item === "object" && item !== null,
  );
  const created = message.create_time_ms;
  const normalised: ChannelInboundMessage = {
    id,
    fromUserId:
      typeof message.from_user_id === "string" ? message.from_user_id : "",
    createdAtMs:
      typeof created === "number" && Number.isFinite(created) && created > 0
        ? created
        : 0,
    pollStartedAtMs,
    isUserMessage: message.message_type === MessageType.USER,
    media: [],
  };
  if (typeof message.to_user_id === "string") {
    normalised.toUserId = message.to_user_id;
  }
  if (typeof message.group_id === "string") {
    normalised.groupId = message.group_id;
  }
  const contextToken = nonEmpty(message.context_token);
  if (contextToken) normalised.contextToken = contextToken;

  const textItem = items.find(
    (item) =>
      itemKind(item) === MessageItemType.TEXT &&
      typeof item.text_item?.text === "string",
  );
  if (textItem?.text_item?.text !== undefined) {
    normalised.text = textItem.text_item.text;
  }
  const transcript = items
    .filter((item) => itemKind(item) === MessageItemType.VOICE)
    .map((item) => nonEmpty(item.voice_item?.text?.trim()))
    .find((text) => text !== undefined);
  if (transcript) normalised.voiceTranscript = transcript;
  const quote = quoteOf(items);
  if (quote) normalised.quotedText = quote;
  for (const item of items) {
    const media = mediaOf(item);
    if (media) normalised.media.push(media);
  }
  return normalised;
}

/** How a failed send is reported to the bridge. */
export function sendFailure(error: unknown): ChannelSendResult {
  if (error instanceof IlinkApiError) {
    if (error.staleToken) {
      return {
        ok: false,
        reason: "reauth-required",
        code: error.errcode ?? error.ret,
      };
    }
    const code =
      error.ret !== undefined && error.ret !== 0 ? error.ret : error.errcode;
    return code === undefined
      ? { ok: false, reason: "rejected" }
      : { ok: false, reason: "rejected", code };
  }
  if (error instanceof IlinkMediaTooLargeError) {
    return { ok: false, reason: "rejected" };
  }
  return { ok: false, reason: "network" };
}

function bindingEvent(event: QrLoginEvent): ChannelBindingEvent {
  switch (event.type) {
    case "qr":
      return {
        type: "qr",
        content: event.content,
        expiresAtMs: event.expiresAtMs,
      };
    case "confirmed":
      return {
        type: "confirmed",
        credentials: {
          token: event.credentials.botToken,
          botId: event.credentials.botId,
          userId: event.credentials.userId,
          baseUrl: event.credentials.baseUrl,
        },
      };
    default:
      return event;
  }
}

function parseRef(ref: string): MessageItem {
  let value: unknown;
  try {
    value = JSON.parse(ref);
  } catch {
    throw new Error("The media reference is not valid.");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("The media reference is not valid.");
  }
  return value;
}

interface TypingTicket {
  ticket?: string;
  refreshAtMs: number;
  retryMs: number;
}

class ClawBotChannel implements MessageChannel {
  private readonly client: IlinkClient | undefined;
  private poller: Poller | undefined;
  private handlers: ChannelHandlers | undefined;
  private state: ChannelState | undefined;
  private started = false;
  private stopped = false;
  private readonly tickets = new Map<string, TypingTicket>();
  private readonly keepalives = new Map<
    string,
    ReturnType<typeof setInterval>
  >();
  private readonly typingCalls = new Map<string, number>();

  constructor(
    private readonly transport: IlinkTransportOptions,
    token: string,
    baseUrl: string,
    private readonly keepaliveMs: number,
  ) {
    try {
      this.client = new IlinkClient({ ...transport, botToken: token, baseUrl });
    } catch {
      // The account's host is not allowed (any more): only a new scan helps.
      this.client = undefined;
    }
  }

  start(handlers: ChannelHandlers, cursor: string): void {
    if (this.started || this.stopped) return;
    this.started = true;
    this.handlers = handlers;
    this.emit("connecting");
    const client = this.client;
    if (!client) {
      this.emit("reauth-required");
      return;
    }
    this.poller = startPoller({
      client: {
        getUpdates: async (pollCursor, options) => {
          const result = await client.getUpdates(pollCursor, options);
          this.emit("online");
          return result;
        },
        notifyStart: async () => {
          await client.notifyStart();
          this.emit("online");
        },
        notifyStop: () => client.notifyStop(),
      },
      cursor,
      onBatch: (batch) => {
        const messages: ChannelInboundMessage[] = [];
        for (const message of batch.messages) {
          const normalised = normaliseMessage(message, batch.pollStartedAtMs);
          if (normalised) messages.push(normalised);
        }
        return handlers.onMessages(messages, batch.cursor);
      },
      onState: (state) => this.pollerState(state),
    });
  }

  async stop(): Promise<void> {
    this.stopped = true;
    for (const timer of this.keepalives.values()) clearInterval(timer);
    this.keepalives.clear();
    const poller = this.poller;
    this.poller = undefined;
    if (poller) await poller.stop();
    if (this.started) this.emit("stopped", true);
  }

  wake(): void {
    this.poller?.wake();
  }

  async sendText(
    toUserId: string,
    contextToken: string | undefined,
    text: string,
  ): Promise<ChannelSendResult> {
    if (!this.client) return { ok: false, reason: "network" };
    try {
      const result = await this.client.sendText({
        toUserId,
        contextToken,
        text,
      });
      return result.messageId === undefined
        ? { ok: true }
        : { ok: true, messageId: result.messageId };
    } catch (error) {
      return sendFailure(error);
    }
  }

  async sendFile(
    toUserId: string,
    contextToken: string | undefined,
    file: { name: string; data: Buffer },
  ): Promise<ChannelSendResult> {
    const client = this.client;
    if (!client) return { ok: false, reason: "network" };
    try {
      const item = await uploadMedia({
        client,
        transport: this.transport,
        toUserId,
        fileName: file.name,
        data: file.data,
      });
      const result = await client.sendItem({ toUserId, contextToken, item });
      return result.messageId === undefined
        ? { ok: true }
        : { ok: true, messageId: result.messageId };
    } catch (error) {
      return sendFailure(error);
    }
  }

  async setTyping(
    toUserId: string,
    contextToken: string | undefined,
    on: boolean,
  ): Promise<void> {
    const client = this.client;
    if (!client || this.stopped) return;
    this.clearKeepalive(toUserId);
    // A later call for the same user supersedes this one.
    const generation = (this.typingCalls.get(toUserId) ?? 0) + 1;
    this.typingCalls.set(toUserId, generation);
    const current = () =>
      !this.stopped && this.typingCalls.get(toUserId) === generation;
    try {
      const ticket = await this.typingTicket(client, toUserId, contextToken);
      if (!ticket || !current()) return;
      await client.sendTyping({
        userId: toUserId,
        typingTicket: ticket,
        status: on ? "typing" : "cancel",
      });
      if (!on || !current()) return;
      const timer = setInterval(() => {
        client
          .sendTyping({
            userId: toUserId,
            typingTicket: ticket,
            status: "typing",
          })
          .catch(() => undefined);
      }, this.keepaliveMs);
      timer.unref?.();
      this.keepalives.set(toUserId, timer);
    } catch {
      // Typing is a courtesy; failures never matter.
    }
  }

  async downloadMedia(
    ref: string,
    maxBytes: number,
    signal?: AbortSignal,
  ): Promise<Buffer> {
    const item = parseRef(ref);
    const result = await downloadMedia({
      transport: this.transport,
      item,
      maxBytes,
      signal,
    });
    if (!result) throw new Error("The message has no file to download.");
    return result.data;
  }

  /** The cached ticket, refreshed when due. Never throws. */
  private async typingTicket(
    client: IlinkClient,
    userId: string,
    contextToken: string | undefined,
  ): Promise<string | undefined> {
    const now = Date.now();
    const cached = this.tickets.get(userId);
    if (cached && now < cached.refreshAtMs) return cached.ticket;
    try {
      const { typingTicket } = await client.getConfig({ userId, contextToken });
      this.tickets.set(userId, {
        ticket: typingTicket ?? cached?.ticket,
        refreshAtMs: now + Math.random() * TICKET_REFRESH_MS,
        retryMs: TICKET_RETRY_FIRST_MS,
      });
      return typingTicket ?? cached?.ticket;
    } catch {
      const retryMs = cached?.retryMs ?? TICKET_RETRY_FIRST_MS;
      this.tickets.set(userId, {
        ticket: cached?.ticket,
        refreshAtMs: now + retryMs,
        retryMs: Math.min(retryMs * 2, TICKET_RETRY_MAX_MS),
      });
      return cached?.ticket;
    }
  }

  private clearKeepalive(userId: string): void {
    const timer = this.keepalives.get(userId);
    if (timer === undefined) return;
    clearInterval(timer);
    this.keepalives.delete(userId);
  }

  private pollerState(state: PollerState): void {
    if (state.kind === "backoff") this.emit("retrying");
    else if (state.kind === "stale-token") this.emit("reauth-required");
  }

  private emit(state: ChannelState, final = false): void {
    if ((this.stopped && !final) || this.state === state) return;
    this.state = state;
    try {
      this.handlers?.onState(state);
    } catch {
      // A listener's failure must not stop the channel.
    }
  }
}

/** WeChat through Tencent's ClawBot (iLink). */
export function createClawBotChannels(
  options: ClawBotChannelOptions,
): ChannelFactory {
  const allowUrl = options.allowUrl ?? defaultAllowUrl;
  const transport: IlinkTransportOptions = {
    fetch: options.fetch,
    identity: { hostName: "pine", hostVersion: options.version },
    allowUrl,
    ...(options.apiBaseUrl === undefined
      ? {}
      : { apiBaseUrl: options.apiBaseUrl }),
    ...(options.cdnBaseUrl === undefined
      ? {}
      : { cdnBaseUrl: options.cdnBaseUrl }),
  };
  const keepaliveMs = options.typingKeepaliveMs ?? TYPING_KEEPALIVE_MS;
  return {
    bind(onEvent, existingToken) {
      const login = startQrLogin({
        ...transport,
        localTokens: existingToken ? [existingToken] : [],
        onEvent: (event) => onEvent(bindingEvent(event)),
      });
      return {
        submitVerifyCode: (code) => login.submitVerifyCode(code),
        cancel: () => login.cancel(),
      };
    },
    open(credentials) {
      return new ClawBotChannel(
        transport,
        credentials.token,
        credentials.baseUrl,
        keepaliveMs,
      );
    },
    allowsBaseUrl(baseUrl) {
      try {
        return allowUrl(new URL(baseUrl), "api");
      } catch {
        return false;
      }
    },
  };
}
