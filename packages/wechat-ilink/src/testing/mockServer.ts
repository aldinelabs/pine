import { randomBytes } from "node:crypto";
import {
  type IncomingMessage,
  type ServerResponse,
  createServer,
} from "node:http";
import type { AddressInfo } from "node:net";
import { encryptAesEcb } from "../crypto";
import {
  type MessageItem,
  MessageItemType,
  MessageState,
  MessageType,
  type WeixinMessage,
} from "../types";
import type { MockIlink, MockRequest, NullablePartial } from "./index";

/** The longest a poll with nothing to deliver is held. */
const HOLD_MS = 150;
/** Message ids start above 2^53, so a lossy parse shows. */
const FIRST_MESSAGE_ID = 9_007_199_254_740_993n;
const STALE_ANSWER = { ret: -14, errcode: -14, errmsg: "session timeout" };
const ID_FIELDS = /(?<!\\)"(message_id|msg_id|svr_id)":"(\d+)"/g;

const DEFAULT_ACCOUNT = {
  botToken: "mock-bot-token",
  botId: "0123456789abcdef@im.bot",
  userId: "mock-user@im.wechat",
};

/** JSON with the id fields as raw integers, as the real server sends them. */
function wireJson(value: unknown): string {
  return JSON.stringify(value).replace(ID_FIELDS, '"$1":$2');
}

function readBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function lowerHeaders(request: IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    headers[name.toLowerCase()] = Array.isArray(value)
      ? value.join(", ")
      : value;
  }
  return headers;
}

/** Drops the fields a partial sets to `null`. */
function withoutNulls<T extends object>(
  value: T,
): { [K in keyof T]: Exclude<T[K], null> } {
  const result: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(value)) {
    if (field !== null) result[key] = field;
  }
  return result as { [K in keyof T]: Exclude<T[K], null> };
}

interface QrState {
  counter: number;
  qrcode: string | undefined;
  /** What a status poll answers when nothing one-shot is queued. */
  phase: "wait" | "scaned" | "need_verifycode" | "confirmed";
  requiredCode: string | undefined;
  oneShot: Record<string, unknown>[];
  confirmed: Record<string, unknown> | undefined;
}

/**
 * Starts a local stand-in for the iLink API and its CDN on 127.0.0.1. Every
 * endpoint answers as PROTO describes; the controls of `MockIlink` steer it.
 */
export async function startMockIlink(): Promise<MockIlink> {
  const requests: MockRequest[] = [];
  const sent: MockIlink["sent"] = [];
  const typing: MockIlink["typing"] = [];
  const uploads = new Map<string, Buffer>();
  const cdn = new Map<string, Buffer>();
  const queue: WeixinMessage[] = [];
  const failures: { suffix: string; status: number; body: unknown }[] = [];
  const redirects: { suffix: string; location: string }[] = [];
  const delays: { suffix: string; ms: number }[] = [];
  const replies = new Map<string, number>();
  const waiters = new Set<() => void>();
  let replyBudget: number | undefined;
  let staleToken = false;
  let nextMessageId = FIRST_MESSAGE_ID;
  let cursorCount = 0;
  let mediaCount = 0;
  let baseUrl = "";

  const qr: QrState = {
    counter: 0,
    qrcode: undefined,
    phase: "wait",
    requiredCode: undefined,
    oneShot: [],
    confirmed: undefined,
  };

  const notify = (): void => {
    for (const wake of waiters) wake();
    waiters.clear();
  };

  /** Resolves when a control changes something, or after `ms`. */
  const hold = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      const done = (): void => {
        clearTimeout(timer);
        waiters.delete(done);
        resolve();
      };
      const timer = setTimeout(done, ms);
      waiters.add(done);
    });

  const take = <T extends { suffix: string }>(
    list: T[],
    path: string,
  ): T | undefined => {
    const index = list.findIndex((entry) => path.endsWith(entry.suffix));
    if (index < 0) return undefined;
    return list.splice(index, 1)[0];
  };

  const json = (
    response: ServerResponse,
    value: unknown,
    status = 200,
  ): void => {
    const text = wireJson(value);
    response.writeHead(status, {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(text),
    });
    response.end(text);
  };

  const nextId = (): string => {
    const id = nextMessageId;
    nextMessageId += 1n;
    return id.toString();
  };

  const qrStatus = async (
    query: URLSearchParams,
  ): Promise<Record<string, unknown>> => {
    if (query.get("qrcode") !== qr.qrcode) return { status: "expired" };
    const code = query.get("verify_code");
    if (code !== null && qr.phase === "need_verifycode") {
      if (code === qr.requiredCode) {
        qr.requiredCode = undefined;
        qr.phase = "scaned";
      } else {
        return { status: "need_verifycode" };
      }
    }
    if (
      qr.oneShot.length === 0 &&
      (qr.phase === "wait" || qr.phase === "scaned")
    ) {
      await hold(HOLD_MS);
    }
    const shot = qr.oneShot.shift();
    if (shot) return shot;
    if (qr.phase === "confirmed") return qr.confirmed ?? { status: "wait" };
    return { status: qr.phase };
  };

  const getUpdates = async (
    body: Record<string, unknown>,
  ): Promise<unknown> => {
    if (staleToken) return STALE_ANSWER;
    if (queue.length === 0) await hold(HOLD_MS);
    if (staleToken) return STALE_ANSWER;
    const msgs = queue.splice(0, queue.length);
    if (msgs.length > 0) cursorCount++;
    const previous =
      typeof body.get_updates_buf === "string" ? body.get_updates_buf : "";
    return {
      ret: 0,
      msgs,
      get_updates_buf: msgs.length > 0 ? `cursor-${cursorCount}` : previous,
      longpolling_timeout_ms: 35_000,
    };
  };

  const sendMessage = (body: Record<string, unknown>): unknown => {
    const msg = (body.msg ?? {}) as WeixinMessage;
    const item = msg.item_list?.[0];
    const contextToken = msg.context_token;
    if (replyBudget !== undefined) {
      const used = replies.get(contextToken ?? "") ?? 0;
      if (used >= replyBudget) return { ret: -2, errmsg: "reply limit" };
      replies.set(contextToken ?? "", used + 1);
    }
    sent.push({
      body,
      item,
      text: item?.text_item?.text,
      contextToken,
    });
    return { ret: 0, message_id: nextId() };
  };

  const handle = async (
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const path = url.pathname;
    const raw = await readBody(request);
    const headers = lowerHeaders(request);
    const isJson = (headers["content-type"] ?? "").includes("json");
    let body: unknown = raw.byteLength > 0 ? raw : undefined;
    if (isJson && raw.byteLength > 0) {
      try {
        body = JSON.parse(raw.toString("utf8")) as unknown;
      } catch {
        body = raw.toString("utf8");
      }
    }
    requests.push({
      method: request.method ?? "GET",
      path,
      query: Object.fromEntries(url.searchParams),
      headers,
      body,
    });

    const delay = take(delays, path);
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay.ms));

    const redirect = take(redirects, path);
    if (redirect) {
      response.writeHead(302, { Location: redirect.location });
      response.end();
      return;
    }
    const failure = take(failures, path);
    if (failure) {
      json(response, failure.body ?? {}, failure.status);
      return;
    }

    const record = (body ?? {}) as Record<string, unknown>;
    const isBotApi =
      path.startsWith("/ilink/bot/") &&
      !path.endsWith("/get_bot_qrcode") &&
      !path.endsWith("/get_qrcode_status");
    if (isBotApi && staleToken && !path.endsWith("/getupdates")) {
      json(response, STALE_ANSWER);
      return;
    }

    switch (path) {
      case "/ilink/bot/get_bot_qrcode": {
        qr.counter++;
        qr.qrcode = `mock-qr-${qr.counter}`;
        qr.phase = "wait";
        qr.oneShot = [];
        qr.confirmed = undefined;
        json(response, {
          qrcode: qr.qrcode,
          qrcode_img_content: `https://liteapp.weixin.qq.com/q/mock-${qr.counter}`,
        });
        return;
      }
      case "/ilink/bot/get_qrcode_status":
        json(response, await qrStatus(url.searchParams));
        return;
      case "/ilink/bot/getupdates":
        json(response, await getUpdates(record));
        return;
      case "/ilink/bot/sendmessage":
        json(response, sendMessage(record));
        return;
      case "/ilink/bot/getconfig":
        json(response, { ret: 0, typing_ticket: "bW9jay10eXBpbmc=" });
        return;
      case "/ilink/bot/sendtyping":
        typing.push({ status: Number(record.status) });
        json(response, { ret: 0 });
        return;
      case "/ilink/bot/msg/notifystart":
      case "/ilink/bot/msg/notifystop":
        json(response, { ret: 0 });
        return;
      case "/ilink/bot/getuploadurl": {
        mediaCount++;
        const param = `upload-${mediaCount}`;
        const fileKey =
          typeof record.filekey === "string" ? record.filekey : "";
        json(response, {
          upload_param: param,
          upload_full_url: `${baseUrl}/c2c/upload?encrypted_query_param=${param}&filekey=${encodeURIComponent(fileKey)}`,
        });
        return;
      }
      case "/c2c/upload": {
        mediaCount++;
        const param = `media-${mediaCount}`;
        uploads.set(param, raw);
        cdn.set(param, raw);
        response.writeHead(200, { "x-encrypted-param": param });
        response.end();
        return;
      }
      case "/c2c/download": {
        const data = cdn.get(
          url.searchParams.get("encrypted_query_param") ?? "",
        );
        if (!data) {
          response.writeHead(404);
          response.end();
          return;
        }
        response.writeHead(200, {
          "Content-Type": "application/octet-stream",
          "Content-Length": data.byteLength,
        });
        response.end(data);
        return;
      }
      default:
        response.writeHead(404);
        response.end();
    }
  };

  const server = createServer((request, response) => {
    handle(request, response).catch(() => {
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;

  const pushUserMessage = (
    message: NullablePartial<WeixinMessage>,
  ): WeixinMessage => {
    const stored = withoutNulls({
      seq: queue.length + 1,
      message_id: nextId(),
      from_user_id: DEFAULT_ACCOUNT.userId,
      to_user_id: DEFAULT_ACCOUNT.botId,
      create_time_ms: Date.now(),
      message_type: MessageType.USER,
      message_state: MessageState.FINISH,
      context_token: `ctx-${randomBytes(6).toString("hex")}`,
      ...message,
    });
    queue.push(stored);
    notify();
    return stored;
  };

  return {
    baseUrl,
    cdnBaseUrl: `${baseUrl}/c2c`,
    requests,
    sent,
    typing,
    uploads,
    close() {
      notify();
      return new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      });
    },
    qr: {
      scan() {
        qr.phase = qr.requiredCode !== undefined ? "need_verifycode" : "scaned";
        notify();
      },
      confirm(overrides = {}) {
        const account = { ...DEFAULT_ACCOUNT, baseUrl, ...overrides };
        qr.phase = "confirmed";
        qr.confirmed = withoutNulls({
          status: "confirmed",
          bot_token: account.botToken || null,
          ilink_bot_id: account.botId || null,
          ilink_user_id: account.userId || null,
          baseurl: account.baseUrl,
        });
        notify();
      },
      expire() {
        qr.oneShot.push({ status: "expired" });
        notify();
      },
      requireVerifyCode(code: string) {
        qr.requiredCode = code;
        if (qr.phase === "scaned") qr.phase = "need_verifycode";
        notify();
      },
      blockVerifyCode() {
        qr.requiredCode = undefined;
        qr.phase = "wait";
        qr.oneShot.push({ status: "verify_code_blocked" });
        notify();
      },
      redirect(host: string) {
        qr.oneShot.push({ status: "scaned_but_redirect", redirect_host: host });
        notify();
      },
      alreadyBound() {
        qr.oneShot.push({ status: "binded_redirect" });
        notify();
      },
    },
    pushUserText(text, overrides = {}) {
      return pushUserMessage({
        item_list: [{ type: MessageItemType.TEXT, text_item: { text } }],
        ...overrides,
      });
    },
    pushUserMessage,
    hostMedia(kind, plain, fileName) {
      const key = randomBytes(16);
      mediaCount++;
      const param = `hosted-${mediaCount}`;
      const cipher = encryptAesEcb(plain, key);
      cdn.set(param, cipher);
      if (kind === "image") {
        // Images carry the key as base64 of the 16 bytes.
        const item: MessageItem = {
          type: MessageItemType.IMAGE,
          image_item: {
            media: {
              encrypt_query_param: param,
              aes_key: key.toString("base64"),
              encrypt_type: 1,
            },
          },
        };
        return item;
      }
      // Files and videos carry it as base64 of the 32 hex characters.
      const media = {
        encrypt_query_param: param,
        aes_key: Buffer.from(key.toString("hex"), "utf8").toString("base64"),
        encrypt_type: 1,
      };
      if (kind === "video") {
        return {
          type: MessageItemType.VIDEO,
          video_item: { media, video_size: cipher.byteLength },
        };
      }
      return {
        type: MessageItemType.FILE,
        file_item: {
          media,
          file_name: fileName ?? "file.bin",
          len: String(plain.byteLength),
        },
      };
    },
    failNext(pathSuffix, response) {
      failures.push({
        suffix: pathSuffix,
        status: response.status ?? 200,
        body: response.body,
      });
    },
    redirectNext(pathSuffix, location) {
      redirects.push({ suffix: pathSuffix, location });
    },
    delayNext(pathSuffix, ms) {
      delays.push({ suffix: pathSuffix, ms });
    },
    setReplyBudget(perToken) {
      replyBudget = perToken;
      replies.clear();
    },
    setStaleToken(on) {
      staleToken = on;
      notify();
    },
  };
}
