import type { MessageItem, WeixinMessage } from "../types";

/** A local stand-in for the iLink server and its CDN, for tests. */
export interface MockIlink {
  /** `http://127.0.0.1:<port>`. */
  readonly baseUrl: string;
  /** `<baseUrl>/c2c`. */
  readonly cdnBaseUrl: string;
  close(): Promise<void>;
  /** Every request seen, for header and body assertions. */
  readonly requests: {
    method: string;
    path: string;
    headers: Record<string, string>;
    body: unknown;
  }[];
  qr: {
    scan(): void;
    confirm(
      overrides?: Partial<{
        botToken: string;
        botId: string;
        userId: string;
        baseUrl: string;
      }>,
    ): void;
    expire(): void;
    requireVerifyCode(code: string): void;
    blockVerifyCode(): void;
    redirect(host: string): void;
    alreadyBound(): void;
  };
  /** Queue an inbound user message; returns the stored message (with ids, context_token). */
  pushUserText(text: string, overrides?: Partial<WeixinMessage>): WeixinMessage;
  /** Fields set to `null` in the partial are omitted from the wire message (missing id, missing create_time_ms). */
  pushUserMessage(message: Partial<WeixinMessage>): WeixinMessage;
  /** Store ciphertext on the mock CDN and return an inbound media item pointing at it. */
  hostMedia(
    kind: "image" | "file" | "video",
    plain: Uint8Array,
    fileName?: string,
  ): MessageItem;
  readonly sent: {
    body: unknown;
    item: MessageItem | undefined;
    text?: string;
    contextToken?: string;
  }[];
  readonly typing: { status: number }[];
  /** `x-encrypted-param` → ciphertext. */
  readonly uploads: Map<string, Buffer>;
  failNext(
    pathSuffix: string,
    response: { status?: number; body?: unknown },
  ): void;
  /** The next request whose path ends with the suffix is answered 302 to `location`. */
  redirectNext(pathSuffix: string, location: string): void;
  /** Delay the next response of that path (slow media download). */
  delayNext(pathSuffix: string, ms: number): void;
  /** Replies allowed per context token; after that `sendmessage` answers `ret` -2. */
  setReplyBudget(perToken: number | undefined): void;
  /** While on, every bot API call answers `errcode` -14. */
  setStaleToken(on: boolean): void;
}

export function startMockIlink(): Promise<MockIlink> {
  throw new Error("not implemented");
}
