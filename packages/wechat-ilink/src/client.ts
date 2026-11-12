import type { IlinkTransportOptions } from "./http";
import type { MessageItem, WeixinMessage } from "./types";

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

/** The bot API of one bound account. */
export class IlinkClient {
  constructor(
    options: IlinkTransportOptions & { botToken: string; baseUrl?: string },
  ) {
    void options;
  }

  getUpdates(
    cursor: string,
    options?: { timeoutMs?: number; signal?: AbortSignal },
  ): Promise<GetUpdatesResult> {
    throw new Error("not implemented");
  }

  sendText(input: {
    toUserId: string;
    contextToken?: string;
    text: string;
    runId?: string;
  }): Promise<SendResult> {
    throw new Error("not implemented");
  }

  sendItem(input: {
    toUserId: string;
    contextToken?: string;
    item: MessageItem;
    runId?: string;
  }): Promise<SendResult> {
    throw new Error("not implemented");
  }

  getConfig(input: {
    userId: string;
    contextToken?: string;
  }): Promise<{ typingTicket?: string }> {
    throw new Error("not implemented");
  }

  sendTyping(input: {
    userId: string;
    typingTicket: string;
    status: "typing" | "cancel";
  }): Promise<void> {
    throw new Error("not implemented");
  }

  notifyStart(): Promise<void> {
    throw new Error("not implemented");
  }

  notifyStop(): Promise<void> {
    throw new Error("not implemented");
  }

  getUploadUrl(input: {
    fileKey: string;
    mediaType: 1 | 2 | 3;
    toUserId: string;
    rawSize: number;
    rawMd5: string;
    fileSize: number;
    aesKeyHex: string;
  }): Promise<{ uploadFullUrl?: string; uploadParam?: string }> {
    throw new Error("not implemented");
  }
}
