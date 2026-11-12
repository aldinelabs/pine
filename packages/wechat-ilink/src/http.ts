// Headers and version rules ported from @tencent-weixin/openclaw-weixin
// 2.4.10 (MIT), Copyright (C) 2026 Tencent. See LICENSE-openclaw-weixin.
// The URL gate and the redirect refusal are Pine's own.

import { randomBytes as nodeRandomBytes } from "node:crypto";
import {
  API_HOST_SUFFIX,
  CDN_HOST_SUFFIXES,
  ILINK_APP_ID,
  ILINK_DEFAULT_BASE_URL,
  PORTED_PLUGIN_VERSION,
} from "./constants";
import {
  IlinkHttpError,
  IlinkResponseError,
  IlinkTimeoutError,
  IlinkUrlError,
} from "./errors";
import { parseIlinkJson } from "./json";
import type { BaseInfo } from "./types";

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** What a URL is used for: the bot API, or a file on the CDN. */
export type UrlPurpose = "api" | "cdn";

/** The program this client runs in, as it is declared to the server. */
export interface IlinkIdentity {
  /** `"pine"`. */
  hostName: string;
  /** `"1.4.2"`. */
  hostVersion: string;
}

export interface IlinkTransportOptions {
  fetch: Fetch;
  identity: IlinkIdentity;
  /**
   * Decides for every URL a request is sent to: the API base, a
   * `redirect_host`, a `full_url`, an `upload_full_url`. Default:
   * `defaultAllowUrl`.
   */
  allowUrl?: (url: URL, purpose: UrlPurpose) => boolean;
  /** Default `ILINK_DEFAULT_BASE_URL`. Tests point it at the mock server. */
  apiBaseUrl?: string;
  /** Default `ILINK_CDN_BASE_URL`. */
  cdnBaseUrl?: string;
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  randomBytes?: (size: number) => Uint8Array;
}

const NAME_LIMIT = 32;

function cleaned(value: string, disallowed: RegExp, fallback: string): string {
  const kept = value.replace(disallowed, "").slice(0, NAME_LIMIT);
  return kept.length > 0 ? kept : fallback;
}

function hostName(identity: IlinkIdentity): string {
  return cleaned(identity.hostName, /[^A-Za-z0-9_.-]/g, "pine");
}

function hostVersion(identity: IlinkIdentity): string {
  return cleaned(identity.hostVersion, /[^A-Za-z0-9_.+-]/g, "0.0.0");
}

/**
 * `channel_version` of a host that is not OpenClaw: the ported plugin version
 * first, because the server reads the first three numbers, then the host.
 * `"2.4.10/pine-1.4.2"`.
 */
export function channelVersion(identity: IlinkIdentity): string {
  return `${PORTED_PLUGIN_VERSION}/${hostName(identity)}-${hostVersion(identity)}`;
}

/**
 * `bot_agent`: one `Name/Version` product, like a User-Agent. `"Pine/1.4.2"`.
 * Characters the server's grammar does not allow are dropped.
 */
export function botAgent(identity: IlinkIdentity): string {
  const name = hostName(identity);
  return `${name.charAt(0).toUpperCase()}${name.slice(1)}/${hostVersion(identity)}`;
}

/**
 * The `iLink-App-ClientVersion` header: major, minor and patch packed into
 * one number, a byte each. `"132106"` for 2.4.10.
 */
export function clientVersionHeader(
  version: string = PORTED_PLUGIN_VERSION,
): string {
  const [major, minor, patch] = version
    .split(".")
    .map((part) => Number.parseInt(part, 10) & 0xff);
  return String(((major ?? 0) << 16) | ((minor ?? 0) << 8) | (patch ?? 0));
}

/** The `base_info` every authenticated request carries. */
export function baseInfo(identity: IlinkIdentity): BaseInfo {
  return {
    channel_version: channelVersion(identity),
    bot_agent: botAgent(identity),
  };
}

const IPV4_LITERAL = /^\d+(\.\d+){3}$/;

/**
 * The URLs a request may go to when the host application sets no gate of its
 * own: https on the default port, no credentials in the URL, a host name
 * (not an IP address) below `weixin.qq.com` for the API, below `qq.com` for
 * the CDN.
 */
export function defaultAllowUrl(url: URL, purpose: UrlPurpose): boolean {
  if (url.protocol !== "https:") return false;
  if (url.username !== "" || url.password !== "") return false;
  if (url.port !== "" && url.port !== "443") return false;
  const host = url.hostname;
  if (host.startsWith("[") || IPV4_LITERAL.test(host)) return false;
  const suffixes: readonly string[] =
    purpose === "api" ? [API_HOST_SUFFIX] : CDN_HOST_SUFFIXES;
  return suffixes.some((suffix) => host.endsWith(suffix));
}

/** Fetch implementations word a refused redirect differently. */
function isRedirectRejection(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 4 && current instanceof Error; depth++) {
    if (/redirect/i.test(current.message)) return true;
    current = current.cause;
  }
  return false;
}

function isRedirect(response: Response): boolean {
  return (
    response.redirected ||
    response.type === "opaqueredirect" ||
    (response.status >= 300 && response.status < 400)
  );
}

/**
 * Sends one request and lets `read` use the response. The URL gate, the
 * redirect refusal and the timeout cover everything up to the end of `read`.
 */
async function guarded<T>(
  transport: IlinkTransportOptions,
  url: string,
  purpose: UrlPurpose,
  init: RequestInit & { timeoutMs: number },
  read: (response: Response) => Promise<T> | T,
): Promise<T> {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    throw new IlinkUrlError(`The ${purpose} URL is not a valid URL.`);
  }
  // Error messages name the host only: paths and query strings of CDN and
  // QR URLs carry secrets.
  if (!(transport.allowUrl ?? defaultAllowUrl)(target, purpose)) {
    throw new IlinkUrlError(
      `Requests to ${target.host} are not allowed (${purpose}).`,
    );
  }

  const { timeoutMs, signal: outer, ...rest } = init;
  if (outer?.aborted) throw outer.reason;

  const inner = new AbortController();
  const signal = outer ? AbortSignal.any([outer, inner.signal]) : inner.signal;

  const work = (async () => {
    let response: Response;
    try {
      response = await transport.fetch(target.href, {
        ...rest,
        redirect: "error",
        signal,
      });
    } catch (error) {
      if (isRedirectRejection(error)) {
        throw new IlinkUrlError(
          `${target.host} answered with a redirect, which is never followed.`,
        );
      }
      throw error;
    }
    if (isRedirect(response)) {
      inner.abort();
      throw new IlinkUrlError(
        `${target.host} answered with a redirect, which is never followed.`,
      );
    }
    return read(response);
  })();
  // The race below may be decided before `work` fails.
  work.catch(() => undefined);

  // Raced against the request, so that a fetch implementation that ignores
  // the signal cannot hold the caller past the timeout or an abort.
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const stopped = new Promise<never>((_resolve, reject) => {
    if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
      timer = setTimeout(() => {
        const error = new IlinkTimeoutError(
          `${target.host} did not answer within ${timeoutMs} ms.`,
        );
        inner.abort(error);
        reject(error);
      }, timeoutMs);
    }
    if (outer) {
      onAbort = () => reject(outer.reason);
      outer.addEventListener("abort", onAbort, { once: true });
    }
  });

  try {
    return await Promise.race([work, stopped]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (onAbort) outer?.removeEventListener("abort", onAbort);
  }
}

/**
 * The one way a request leaves this package. The URL has to pass `allowUrl`
 * (else `IlinkUrlError`, and nothing is sent), a redirect is refused
 * (`IlinkUrlError`) and never followed, and no answer within `timeoutMs` is
 * an `IlinkTimeoutError`.
 *
 * The timeout covers the wait for the response, not the reading of its body:
 * a caller that streams a body bounds that itself through `init.signal`,
 * which stays connected to the request. A `timeoutMs` of 0 sets no timeout.
 */
export function guardedFetch(
  transport: IlinkTransportOptions,
  url: string,
  purpose: UrlPurpose,
  init: RequestInit & { timeoutMs: number },
): Promise<Response> {
  return guarded(transport, url, purpose, init, (response) => response);
}

/** One call of the bot API. */
export interface IlinkRequest {
  /** The path below the base URL, with its query string: `"ilink/bot/getupdates"`. */
  endpoint: string;
  /** Names the operation in error messages: `"getUpdates"`. */
  label: string;
  timeoutMs: number;
  /** The API host of the account. Default: the transport's `apiBaseUrl`. */
  baseUrl?: string;
  signal?: AbortSignal;
}

export interface IlinkPostRequest extends IlinkRequest {
  body: Record<string, unknown>;
  /**
   * The bot token. With it the request is authenticated and its body gets
   * `base_info`; without it (`get_bot_qrcode`) neither is sent.
   */
  token?: string;
  /** For calls whose answer says nothing: resolve with `undefined`, unparsed. */
  ignoreBody?: boolean;
}

function endpointUrl(
  transport: IlinkTransportOptions,
  request: IlinkRequest,
): string {
  const base = (
    request.baseUrl ??
    transport.apiBaseUrl ??
    ILINK_DEFAULT_BASE_URL
  ).trim();
  try {
    return new URL(
      request.endpoint,
      base.endsWith("/") ? base : `${base}/`,
    ).toString();
  } catch {
    throw new IlinkUrlError("The api URL is not a valid URL.");
  }
}

function commonHeaders(): Record<string, string> {
  return {
    "iLink-App-Id": ILINK_APP_ID,
    "iLink-App-ClientVersion": clientVersionHeader(),
  };
}

/** `X-WECHAT-UIN`: a new random 32-bit number per request, as base64 text. */
function wechatUin(transport: IlinkTransportOptions): string {
  const bytes = (transport.randomBytes ?? nodeRandomBytes)(4);
  const value = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ).getUint32(0);
  return Buffer.from(String(value), "utf8").toString("base64");
}

async function readJson(
  response: Response,
  request: IlinkRequest,
  ignoreBody: boolean,
): Promise<unknown> {
  if (!response.ok) {
    // The body of an error page is of no use and of unknown size.
    await response.body?.cancel().catch(() => undefined);
    throw new IlinkHttpError(request.label, response.status);
  }
  const text = await response.text();
  if (ignoreBody) return undefined;
  try {
    return parseIlinkJson(text);
  } catch {
    throw new IlinkResponseError(
      `${request.label}: the answer is not valid JSON.`,
    );
  }
}

/**
 * POSTs a JSON body to a bot API endpoint and resolves with the parsed
 * answer. `ret` and `errcode` are left to the caller, which knows what they
 * mean for its call. Message ids in the answer are strings.
 */
export async function postJson(
  transport: IlinkTransportOptions,
  request: IlinkPostRequest,
): Promise<unknown> {
  const token = request.token?.trim();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    AuthorizationType: "ilink_bot_token",
    "X-WECHAT-UIN": wechatUin(transport),
    ...commonHeaders(),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const body = token
    ? { ...request.body, base_info: baseInfo(transport.identity) }
    : request.body;
  // No Content-Length: the fetch implementation sets it and rejects a second one.
  return await guarded(
    transport,
    endpointUrl(transport, request),
    "api",
    {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      timeoutMs: request.timeoutMs,
      signal: request.signal,
    },
    (response) => readJson(response, request, request.ignoreBody === true),
  );
}

/**
 * GETs a bot API endpoint (the QR status poll) and resolves with the parsed
 * answer. A GET never carries the token.
 */
export async function getJson(
  transport: IlinkTransportOptions,
  request: IlinkRequest,
): Promise<unknown> {
  return await guarded(
    transport,
    endpointUrl(transport, request),
    "api",
    {
      method: "GET",
      headers: commonHeaders(),
      timeoutMs: request.timeoutMs,
      signal: request.signal,
    },
    (response) => readJson(response, request, false),
  );
}
