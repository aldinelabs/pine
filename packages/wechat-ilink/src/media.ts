// CDN transfer ported from @tencent-weixin/openclaw-weixin 2.4.10 (MIT),
// Copyright (C) 2026 Tencent. See LICENSE-openclaw-weixin.
// The URL gate, the redirect refusal, the size cap while reading and the
// idle timeout are Pine's own.

import { createHash, randomBytes as nodeRandomBytes } from "node:crypto";
import type { IlinkClient } from "./client";
import {
  CDN_IDLE_TIMEOUT_MS,
  CDN_UPLOAD_ATTEMPTS,
  ILINK_CDN_BASE_URL,
  MEDIA_MAX_BYTES,
} from "./constants";
import {
  decryptAesEcb,
  encryptAesEcb,
  outboundAesKey,
  parseAesKey,
} from "./crypto";
import {
  IlinkHttpError,
  IlinkResponseError,
  IlinkTimeoutError,
  IlinkUrlError,
} from "./errors";
import { type IlinkTransportOptions, guardedFetch } from "./http";
import {
  type CDNMedia,
  type MessageItem,
  MessageItemType,
  UploadMediaType,
} from "./types";

export type OutboundMediaKind = "image" | "video" | "file";

/** A file is larger than the cap of the transfer. */
export class IlinkMediaTooLargeError extends Error {
  readonly maxBytes: number;

  constructor(maxBytes: number) {
    super(`The file is larger than ${maxBytes} bytes.`);
    this.name = "IlinkMediaTooLargeError";
    this.maxBytes = maxBytes;
  }
}

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "webm", "mkv", "avi"]);
const HEX_KEY = /^[0-9a-fA-F]{32}$/;
/** Upload time on top of the idle timeout: 1 ms per KiB, about 1 MB/s. */
const UPLOAD_MS_PER_KIB = 1;

/** How a file is sent, going by its extension. Anything unknown is a file. */
export function mediaKindForFileName(name: string): OutboundMediaKind {
  const base = name.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "file";
  const extension = base.slice(dot + 1).toLowerCase();
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  if (VIDEO_EXTENSIONS.has(extension)) return "video";
  return "file";
}

function baseName(name: string): string {
  return name.split(/[\\/]/).pop() || "file";
}

/** A view of the bytes that `fetch` accepts as a body. */
function bodyBytes(data: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(
    data.buffer as ArrayBuffer,
    data.byteOffset,
    data.byteLength,
  );
}

function cdnBase(transport: IlinkTransportOptions): string {
  return (transport.cdnBaseUrl ?? ILINK_CDN_BASE_URL).replace(/\/+$/, "");
}

/**
 * Encrypts and uploads a file, and resolves with the item to send
 * (PROTO §5.2, §3.5). The CDN POST is tried up to `CDN_UPLOAD_ATTEMPTS`
 * times; a 4xx answer, a redirect or a URL the gate refuses ends it at once.
 * Files over `MEDIA_MAX_BYTES` are refused with `IlinkMediaTooLargeError`
 * before anything is sent.
 */
export async function uploadMedia(options: {
  client: Pick<IlinkClient, "getUploadUrl">;
  transport: IlinkTransportOptions;
  toUserId: string;
  fileName: string;
  data: Uint8Array;
  kind?: OutboundMediaKind;
}): Promise<MessageItem> {
  const { client, transport, data } = options;
  if (data.byteLength > MEDIA_MAX_BYTES) {
    throw new IlinkMediaTooLargeError(MEDIA_MAX_BYTES);
  }
  const kind = options.kind ?? mediaKindForFileName(options.fileName);
  const random = transport.randomBytes ?? nodeRandomBytes;
  const key = Buffer.from(random(16));
  const fileKey = Buffer.from(random(16)).toString("hex");
  const rawMd5 = createHash("md5").update(data).digest("hex");
  const cipher = encryptAesEcb(data, key);

  const target = await client.getUploadUrl({
    fileKey,
    mediaType:
      kind === "image"
        ? UploadMediaType.IMAGE
        : kind === "video"
          ? UploadMediaType.VIDEO
          : UploadMediaType.FILE,
    toUserId: options.toUserId,
    rawSize: data.byteLength,
    rawMd5,
    fileSize: cipher.byteLength,
    aesKeyHex: key.toString("hex"),
  });
  const url =
    target.uploadFullUrl ??
    `${cdnBase(transport)}/upload?encrypted_query_param=${encodeURIComponent(
      target.uploadParam ?? "",
    )}&filekey=${encodeURIComponent(fileKey)}`;

  const timeoutMs =
    CDN_IDLE_TIMEOUT_MS +
    Math.ceil(cipher.byteLength / 1024) * UPLOAD_MS_PER_KIB;
  let lastError: unknown;
  let downloadParam: string | undefined;
  for (let attempt = 1; attempt <= CDN_UPLOAD_ATTEMPTS; attempt++) {
    let response: Response;
    try {
      response = await guardedFetch(transport, url, "cdn", {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: bodyBytes(cipher),
        timeoutMs,
      });
    } catch (error) {
      if (error instanceof IlinkUrlError) throw error;
      lastError = error;
      continue;
    }
    await response.body?.cancel().catch(() => undefined);
    if (response.status >= 400 && response.status < 500) {
      throw new IlinkHttpError("cdnUpload", response.status);
    }
    const param = response.headers.get("x-encrypted-param")?.trim();
    if (response.status === 200 && param) {
      downloadParam = param;
      break;
    }
    lastError =
      response.status === 200
        ? new IlinkResponseError("cdnUpload: the answer has no file reference.")
        : new IlinkHttpError("cdnUpload", response.status);
  }
  if (downloadParam === undefined) {
    throw lastError instanceof Error
      ? lastError
      : new Error("cdnUpload failed.");
  }

  const media: CDNMedia = {
    encrypt_query_param: downloadParam,
    aes_key: outboundAesKey(key),
    encrypt_type: 1,
  };
  if (kind === "image") {
    return {
      type: MessageItemType.IMAGE,
      image_item: { media, mid_size: cipher.byteLength },
    };
  }
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
      file_name: baseName(options.fileName),
      len: String(data.byteLength),
    },
  };
}

interface DownloadPlan {
  media: CDNMedia;
  /** `undefined`: the bytes are used as they come (a key-less image). */
  key: Buffer | undefined;
  kind: "image" | "video" | "file" | "voice";
  fileName?: string;
}

function itemKind(item: MessageItem): number | undefined {
  if (item.type !== undefined) return item.type;
  if (item.image_item) return MessageItemType.IMAGE;
  if (item.video_item) return MessageItemType.VIDEO;
  if (item.file_item) return MessageItemType.FILE;
  if (item.voice_item) return MessageItemType.VOICE;
  return undefined;
}

function hasLocation(media: CDNMedia | undefined): media is CDNMedia {
  return Boolean(media && (media.full_url || media.encrypt_query_param));
}

function keyOf(media: CDNMedia): Buffer | undefined {
  return media.aes_key ? parseAesKey(media.aes_key) : undefined;
}

/** PROTO §5.3. `undefined` when the item has nothing to fetch or no key. */
function downloadPlan(item: MessageItem): DownloadPlan | undefined {
  switch (itemKind(item)) {
    case MessageItemType.IMAGE: {
      const image = item.image_item;
      if (!hasLocation(image?.media)) return undefined;
      const key =
        image.aeskey && HEX_KEY.test(image.aeskey)
          ? Buffer.from(image.aeskey, "hex")
          : keyOf(image.media);
      return { media: image.media, key, kind: "image" };
    }
    case MessageItemType.VIDEO: {
      const media = item.video_item?.media;
      if (!hasLocation(media) || !media.aes_key) return undefined;
      return { media, key: keyOf(media), kind: "video" };
    }
    case MessageItemType.FILE: {
      const file = item.file_item;
      if (!hasLocation(file?.media) || !file.media.aes_key) return undefined;
      return {
        media: file.media,
        key: keyOf(file.media),
        kind: "file",
        fileName: file.file_name || undefined,
      };
    }
    case MessageItemType.VOICE: {
      const media = item.voice_item?.media;
      if (!hasLocation(media) || !media.aes_key) return undefined;
      return { media, key: keyOf(media), kind: "voice" };
    }
    default:
      return undefined;
  }
}

/** Reads the body, at most `limit` bytes, with no gap longer than the idle timeout. */
async function readCapped(
  response: Response,
  limit: number,
  maxBytes: number,
  controller: AbortController,
  outer: AbortSignal | undefined,
): Promise<Buffer> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) {
    controller.abort();
    throw new IlinkMediaTooLargeError(maxBytes);
  }
  const body = response.body;
  if (!body) return Buffer.alloc(0);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let onAbort: (() => void) | undefined;
      const stopped = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(
            new IlinkTimeoutError(
              `The download stalled for ${CDN_IDLE_TIMEOUT_MS} ms.`,
            ),
          );
        }, CDN_IDLE_TIMEOUT_MS);
        if (outer) {
          if (outer.aborted) reject(outer.reason);
          onAbort = () => reject(outer.reason);
          outer.addEventListener("abort", onAbort, { once: true });
        }
      });
      let next: ReadableStreamReadResult<Uint8Array>;
      try {
        next = await Promise.race([reader.read(), stopped]);
      } finally {
        clearTimeout(timer);
        if (onAbort) outer?.removeEventListener("abort", onAbort);
      }
      if (next.done) break;
      total += next.value.byteLength;
      if (total > limit) throw new IlinkMediaTooLargeError(maxBytes);
      chunks.push(next.value);
    }
  } catch (error) {
    controller.abort();
    reader.cancel().catch(() => undefined);
    throw error;
  }
  return Buffer.concat(chunks);
}

/**
 * Downloads and decrypts the file of an inbound item. Resolves with
 * `undefined` for an item that has no file to fetch. `full_url` is preferred
 * and has to pass the gate with purpose `"cdn"`; a redirect is an
 * `IlinkUrlError`. More than `maxBytes` (default `MEDIA_MAX_BYTES`) is an
 * `IlinkMediaTooLargeError`, raised while reading. A stall longer than
 * `CDN_IDLE_TIMEOUT_MS` is an `IlinkTimeoutError`.
 */
export async function downloadMedia(options: {
  transport: IlinkTransportOptions;
  item: MessageItem;
  maxBytes?: number;
  signal?: AbortSignal;
}): Promise<
  | {
      data: Buffer;
      kind: "image" | "video" | "file" | "voice";
      fileName?: string;
    }
  | undefined
> {
  const { transport, signal } = options;
  const plan = downloadPlan(options.item);
  if (!plan) return undefined;
  const maxBytes = options.maxBytes ?? MEDIA_MAX_BYTES;
  const url = plan.media.full_url
    ? plan.media.full_url
    : `${cdnBase(transport)}/download?encrypted_query_param=${encodeURIComponent(
        plan.media.encrypt_query_param ?? "",
      )}`;

  const controller = new AbortController();
  const requestSignal = signal
    ? AbortSignal.any([signal, controller.signal])
    : controller.signal;
  const response = await guardedFetch(transport, url, "cdn", {
    method: "GET",
    timeoutMs: CDN_IDLE_TIMEOUT_MS,
    signal: requestSignal,
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new IlinkHttpError("cdnDownload", response.status);
  }
  // Padding adds at most one block to the plain size.
  const limit = plan.key ? maxBytes + 16 : maxBytes;
  const raw = await readCapped(response, limit, maxBytes, controller, signal);

  let data: Buffer;
  if (plan.key) {
    try {
      data = decryptAesEcb(raw, plan.key);
    } catch {
      throw new IlinkResponseError(
        "cdnDownload: the file could not be decrypted.",
      );
    }
  } else {
    data = raw;
  }
  if (data.byteLength > maxBytes) throw new IlinkMediaTooLargeError(maxBytes);
  return plan.fileName
    ? { data, kind: plan.kind, fileName: plan.fileName }
    : { data, kind: plan.kind };
}
