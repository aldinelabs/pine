// Request shapes ported from @tencent-weixin/openclaw-weixin 2.4.10 (MIT),
// Copyright (C) 2026 Tencent. See LICENSE-openclaw-weixin.

import { randomBytes as nodeRandomBytes } from "node:crypto";
import {
  API_TIMEOUT_MS,
  CONFIG_TIMEOUT_MS,
  ILINK_DEFAULT_BASE_URL,
  LONG_POLL_TIMEOUT_MS,
} from "./constants";
import {
  IlinkApiError,
  IlinkResponseError,
  IlinkTimeoutError,
  IlinkUrlError,
} from "./errors";
import { type IlinkTransportOptions, defaultAllowUrl, postJson } from "./http";
import {
  type GetConfigResp,
  type GetUpdatesResp,
  type GetUploadUrlResp,
  type MessageItem,
  MessageItemType,
  MessageState,
  MessageType,
  type SendMessageResp,
  type StatusResp,
  TypingStatus,
  type WeixinMessage,
} from "./types";

/** What a confirmed QR login hands out. */
export interface IlinkCredentials {
  botToken: string;
  botId: string;
  /** The WeChat user who scanned the code: the only sender to accept. */
  userId: string;
  /** The API host of this account. */
  baseUrl: string;
}

export interface GetUpdatesResult {
  messages: WeixinMessage[];
  /** Set only when the server sent a new, non-empty cursor. */
  cursor?: string;
  /** The timeout the server asks for on the next poll. */
  nextTimeoutMs?: number;
}

export interface SendResult {
  messageId?: string;
}

interface ErrorFields {
  ret?: number;
  errcode?: number;
  errmsg?: string;
}

/** The answer as an object, or an `IlinkResponseError`. */
function responseObject<T extends object>(value: unknown, label: string): T {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new IlinkResponseError(`${label}: the answer is not a JSON object.`);
  }
  return value as T;
}

function numberField(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

/** Throws an `IlinkApiError` for a non-zero `ret` or `errcode`. */
function checkCodes(label: string, response: ErrorFields): void {
  const ret = numberField(response.ret);
  const errcode = numberField(response.errcode);
  if (
    (ret !== undefined && ret !== 0) ||
    (errcode !== undefined && errcode !== 0)
  ) {
    throw new IlinkApiError(label, {
      ret,
      errcode,
      errmsg: typeof response.errmsg === "string" ? response.errmsg : undefined,
    });
  }
}

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

/**
 * The bot API of one bound account. Every call goes to the account's API
 * host through the transport's URL gate. Calls throw `IlinkApiError` when the
 * answer carries a non-zero `ret` or `errcode` (`staleToken` for -14),
 * `IlinkHttpError`, `IlinkTimeoutError`, `IlinkUrlError` or
 * `IlinkResponseError` otherwise.
 */
export class IlinkClient {
  private readonly transport: IlinkTransportOptions;
  private readonly botToken: string;
  private readonly baseUrl: string;

  /** Throws `IlinkUrlError` when the account's API host is not allowed. */
  constructor(
    options: IlinkTransportOptions & { botToken: string; baseUrl?: string },
  ) {
    const { botToken, baseUrl, ...transport } = options;
    this.transport = transport;
    this.botToken = botToken;
    const base =
      baseUrl?.trim() || transport.apiBaseUrl?.trim() || ILINK_DEFAULT_BASE_URL;
    let url: URL;
    try {
      url = new URL(base);
    } catch {
      throw new IlinkUrlError("The api URL is not a valid URL.");
    }
    if (!(transport.allowUrl ?? defaultAllowUrl)(url, "api")) {
      throw new IlinkUrlError(`Requests to ${url.host} are not allowed (api).`);
    }
    this.baseUrl = base;
  }

  private post(
    endpoint: string,
    label: string,
    body: Record<string, unknown>,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<unknown> {
    return postJson(this.transport, {
      endpoint,
      label,
      body,
      timeoutMs,
      signal,
      token: this.botToken,
      baseUrl: this.baseUrl,
    });
  }

  /**
   * One long poll. The client-side timeout and an abort through `signal` are
   * not errors: they resolve with no messages and no cursor.
   */
  async getUpdates(
    cursor: string,
    options?: { timeoutMs?: number; signal?: AbortSignal },
  ): Promise<GetUpdatesResult> {
    const signal = options?.signal;
    let answer: unknown;
    try {
      answer = await this.post(
        "ilink/bot/getupdates",
        "getUpdates",
        { get_updates_buf: cursor },
        options?.timeoutMs ?? LONG_POLL_TIMEOUT_MS,
        signal,
      );
    } catch (error) {
      if (error instanceof IlinkTimeoutError || signal?.aborted) {
        return { messages: [] };
      }
      throw error;
    }
    const response = responseObject<GetUpdatesResp>(answer, "getUpdates");
    checkCodes("getUpdates", response);
    const messages = Array.isArray(response.msgs)
      ? response.msgs.filter(
          (message): message is WeixinMessage =>
            typeof message === "object" && message !== null,
        )
      : [];
    const result: GetUpdatesResult = { messages };
    if (
      typeof response.get_updates_buf === "string" &&
      response.get_updates_buf.length > 0
    ) {
      result.cursor = response.get_updates_buf;
    }
    const next = numberField(response.longpolling_timeout_ms);
    if (next !== undefined && next > 0) result.nextTimeoutMs = next;
    return result;
  }

  /** Sends one text message. Splitting long text is the caller's job. */
  sendText(input: {
    toUserId: string;
    contextToken?: string;
    text: string;
    runId?: string;
  }): Promise<SendResult> {
    if (input.text.length === 0) {
      return Promise.reject(new Error("sendText: the text is empty."));
    }
    return this.sendItem({
      toUserId: input.toUserId,
      contextToken: input.contextToken,
      runId: input.runId,
      item: { type: MessageItemType.TEXT, text_item: { text: input.text } },
    });
  }

  /** Sends one item: the protocol takes exactly one per request. */
  async sendItem(input: {
    toUserId: string;
    contextToken?: string;
    item: MessageItem;
    runId?: string;
  }): Promise<SendResult> {
    const msg: Record<string, unknown> = {
      from_user_id: "",
      to_user_id: input.toUserId,
      client_id: this.clientId(),
      message_type: MessageType.BOT,
      message_state: MessageState.FINISH,
      item_list: [input.item],
    };
    if (input.contextToken) msg.context_token = input.contextToken;
    if (input.runId) msg.run_id = input.runId;
    const answer = await this.post(
      "ilink/bot/sendmessage",
      "sendMessage",
      { msg },
      API_TIMEOUT_MS,
    );
    const response = responseObject<SendMessageResp & ErrorFields>(
      answer,
      "sendMessage",
    );
    checkCodes("sendMessage", response);
    return typeof response.message_id === "string"
      ? { messageId: response.message_id }
      : {};
  }

  async getConfig(input: {
    userId: string;
    contextToken?: string;
  }): Promise<{ typingTicket?: string }> {
    const body: Record<string, unknown> = { ilink_user_id: input.userId };
    if (input.contextToken) body.context_token = input.contextToken;
    const answer = await this.post(
      "ilink/bot/getconfig",
      "getConfig",
      body,
      CONFIG_TIMEOUT_MS,
    );
    const response = responseObject<GetConfigResp & ErrorFields>(
      answer,
      "getConfig",
    );
    checkCodes("getConfig", response);
    return typeof response.typing_ticket === "string" &&
      response.typing_ticket.length > 0
      ? { typingTicket: response.typing_ticket }
      : {};
  }

  async sendTyping(input: {
    userId: string;
    typingTicket: string;
    status: "typing" | "cancel";
  }): Promise<void> {
    const answer = await this.post(
      "ilink/bot/sendtyping",
      "sendTyping",
      {
        ilink_user_id: input.userId,
        typing_ticket: input.typingTicket,
        status:
          input.status === "typing" ? TypingStatus.TYPING : TypingStatus.CANCEL,
      },
      CONFIG_TIMEOUT_MS,
    );
    checkCodes("sendTyping", responseObject<StatusResp>(answer, "sendTyping"));
  }

  async notifyStart(): Promise<void> {
    const answer = await this.post(
      "ilink/bot/msg/notifystart",
      "notifyStart",
      {},
      CONFIG_TIMEOUT_MS,
    );
    checkCodes(
      "notifyStart",
      responseObject<StatusResp>(answer, "notifyStart"),
    );
  }

  async notifyStop(): Promise<void> {
    const answer = await this.post(
      "ilink/bot/msg/notifystop",
      "notifyStop",
      {},
      CONFIG_TIMEOUT_MS,
    );
    checkCodes("notifyStop", responseObject<StatusResp>(answer, "notifyStop"));
  }

  /** Resolves with at least one of the two fields, else `IlinkResponseError`. */
  async getUploadUrl(input: {
    fileKey: string;
    mediaType: 1 | 2 | 3;
    toUserId: string;
    rawSize: number;
    rawMd5: string;
    fileSize: number;
    aesKeyHex: string;
  }): Promise<{ uploadFullUrl?: string; uploadParam?: string }> {
    const answer = await this.post(
      "ilink/bot/getuploadurl",
      "getUploadUrl",
      {
        filekey: input.fileKey,
        media_type: input.mediaType,
        to_user_id: input.toUserId,
        rawsize: input.rawSize,
        rawfilemd5: input.rawMd5,
        filesize: input.fileSize,
        no_need_thumb: true,
        aeskey: input.aesKeyHex,
      },
      API_TIMEOUT_MS,
    );
    const response = responseObject<GetUploadUrlResp & ErrorFields>(
      answer,
      "getUploadUrl",
    );
    checkCodes("getUploadUrl", response);
    const result: { uploadFullUrl?: string; uploadParam?: string } = {};
    const full =
      typeof response.upload_full_url === "string"
        ? response.upload_full_url.trim()
        : "";
    if (full) result.uploadFullUrl = full;
    if (
      typeof response.upload_param === "string" &&
      response.upload_param.length > 0
    ) {
      result.uploadParam = response.upload_param;
    }
    if (!result.uploadFullUrl && !result.uploadParam) {
      throw new IlinkResponseError(
        "getUploadUrl: the answer has no upload URL.",
      );
    }
    return result;
  }

  /** `pine:<ms>-<8 hex>`, new for every message. */
  private clientId(): string {
    const now = (this.transport.now ?? Date.now)();
    const random = (this.transport.randomBytes ?? nodeRandomBytes)(4);
    return `pine:${now}-${hex(random)}`;
  }
}
