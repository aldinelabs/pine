// The message channel the bridge talks through. ClawBot (Tencent iLink) is
// the only implementation; another chat service would implement the same
// interfaces.

/** What a confirmed binding yields. The token is secret: never logged or rendered. */
export interface ChannelCredentials {
  token: string;
  botId: string;
  userId: string;
  baseUrl: string;
}

export interface ChannelInboundMedia {
  kind: "image" | "file" | "video" | "voice";
  fileName?: string;
  sizeBytes?: number;
  /** Opaque, secret reference passed back to `downloadMedia`. */
  ref: string;
}

export interface ChannelInboundMessage {
  /** Lossless message id. The adapter drops a message that has none. */
  id: string;
  fromUserId: string;
  toUserId?: string;
  groupId?: string;
  /** 0 when the wire field is missing, zero or not finite: such a message is stale. */
  createdAtMs: number;
  /** Local clock when the poll request that returned this message was sent. */
  pollStartedAtMs: number;
  isUserMessage: boolean;
  contextToken?: string;
  /** The user-typed TEXT item only. The only field ever parsed for commands. */
  text?: string;
  voiceTranscript?: string;
  /** Quoted or forwarded content: never a command, never first in a prompt. */
  quotedText?: string;
  media: ChannelInboundMedia[];
}

export type ChannelSendResult =
  | { ok: true; messageId?: string }
  | {
      ok: false;
      reason: "reauth-required" | "rejected" | "network";
      code?: number;
    };

export type ChannelState =
  "connecting" | "online" | "retrying" | "reauth-required" | "stopped";

export interface ChannelHandlers {
  /** Persist and enqueue only; awaited before the next poll. No handling, no download. */
  onMessages(
    batch: ChannelInboundMessage[],
    cursor: string | undefined,
  ): Promise<void>;
  onState(state: ChannelState): void;
}

export interface MessageChannel {
  start(handlers: ChannelHandlers, cursor: string): void;
  stop(): Promise<void>;
  /** After sleep/resume: poll again now instead of waiting out a timeout. */
  wake(): void;
  sendText(
    toUserId: string,
    contextToken: string | undefined,
    text: string,
  ): Promise<ChannelSendResult>;
  sendFile(
    toUserId: string,
    contextToken: string | undefined,
    file: { name: string; data: Buffer },
  ): Promise<ChannelSendResult>;
  setTyping(
    toUserId: string,
    contextToken: string | undefined,
    on: boolean,
  ): Promise<void>;
  /** Rejects when larger than maxBytes, undecryptable, redirected or aborted. */
  downloadMedia(
    ref: string,
    maxBytes: number,
    signal?: AbortSignal,
  ): Promise<Buffer>;
}

export type ChannelBindingEvent =
  | { type: "qr"; content: string; expiresAtMs: number }
  | { type: "scanned" }
  | { type: "need-verify-code"; retry: boolean }
  | { type: "confirmed"; credentials: ChannelCredentials }
  | { type: "already-bound" }
  | {
      type: "failed";
      reason: "expired" | "blocked" | "timeout" | "cancelled" | "protocol";
      message: string;
    };

export interface ChannelBinding {
  submitVerifyCode(code: string): void;
  cancel(): void;
}

export interface ChannelFactory {
  bind(
    onEvent: (event: ChannelBindingEvent) => void,
    existingToken?: string,
  ): ChannelBinding;
  open(credentials: ChannelCredentials): MessageChannel;
  /** Whether a stored account base URL may still be used (re-checked on every start). */
  allowsBaseUrl(baseUrl: string): boolean;
}
