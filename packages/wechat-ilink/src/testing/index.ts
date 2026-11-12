import type { MessageItem, WeixinMessage } from "../types";

/** A partial in which `null` marks a field to leave out of the wire message. */
export type NullablePartial<T> = { [K in keyof T]?: T[K] | null };

/** One request the mock server received. */
export interface MockRequest {
  method: string;
  /** The path without the query string. */
  path: string;
  /** The query string, decoded. */
  query: Record<string, string>;
  /** Header names in lower case. */
  headers: Record<string, string>;
  /** Parsed JSON for a JSON body, the raw bytes otherwise, `undefined` when empty. */
  body: unknown;
}

/** A local stand-in for the iLink server and its CDN, for tests. */
export interface MockIlink {
  /** `http://127.0.0.1:<port>`. */
  readonly baseUrl: string;
  /** `<baseUrl>/c2c`. */
  readonly cdnBaseUrl: string;
  close(): Promise<void>;
  /** Every request seen, for header and body assertions. */
  readonly requests: MockRequest[];
  qr: {
    /** The phone scanned the code; with a required code, it now asks for it. */
    scan(): void;
    /**
     * The user confirmed. Defaults: token `mock-bot-token`, bot
     * `0123456789abcdef@im.bot`, user `mock-user@im.wechat`, the mock's own
     * base URL. An empty string leaves that field out of the answer.
     */
    confirm(
      overrides?: Partial<{
        botToken: string;
        botId: string;
        userId: string;
        baseUrl: string;
      }>,
    ): void;
    /** The next status poll answers `expired`. */
    expire(): void;
    /** After the scan, status polls answer `need_verifycode` until this code is sent. */
    requireVerifyCode(code: string): void;
    /** The next status poll answers `verify_code_blocked`. */
    blockVerifyCode(): void;
    /** The next status poll answers `scaned_but_redirect` with this `redirect_host`. */
    redirect(host: string): void;
    /** The next status poll answers `binded_redirect`. */
    alreadyBound(): void;
  };
  /** Queue an inbound user message; returns the stored message (with ids, context_token). */
  pushUserText(
    text: string,
    overrides?: NullablePartial<WeixinMessage>,
  ): WeixinMessage;
  /** Fields set to `null` in the partial are omitted from the wire message (missing id, missing create_time_ms). */
  pushUserMessage(message: NullablePartial<WeixinMessage>): WeixinMessage;
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
  /** The next request whose path ends with the suffix gets this status (default 200) and JSON body. */
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

export { startMockIlink } from "./mockServer";
