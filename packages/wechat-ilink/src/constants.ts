// Values ported from @tencent-weixin/openclaw-weixin 2.4.10 (MIT),
// Copyright (C) 2026 Tencent. See LICENSE-openclaw-weixin.

/** The API host of a fresh login; an account may be given another one. */
export const ILINK_DEFAULT_BASE_URL = "https://ilinkai.weixin.qq.com";
export const ILINK_CDN_BASE_URL = "https://novac2c.cdn.weixin.qq.com/c2c";
export const ILINK_BOT_TYPE = "3";
export const ILINK_APP_ID = "bot";

/**
 * The openclaw-weixin release this client speaks like. The server reads the
 * first three numbers of `channel_version` and the client-version header, so
 * both are derived from this one value.
 */
export const PORTED_PLUGIN_VERSION = "2.4.10";

/** The server holds `getupdates` and the QR status poll about this long. */
export const LONG_POLL_TIMEOUT_MS = 35_000;
/** `sendmessage`, `getuploadurl`. */
export const API_TIMEOUT_MS = 15_000;
/** `getconfig`, `sendtyping`, `notifystart`, `notifystop`. */
export const CONFIG_TIMEOUT_MS = 10_000;
export const QR_FETCH_TIMEOUT_MS = 15_000;

/** How long one login may take, QR refreshes included. */
export const QR_LOGIN_DEADLINE_MS = 480_000;
/** A QR code older than this is treated as expired without asking. */
export const QR_LOCAL_TTL_MS = 5 * 60_000;
/** QR codes shown per login, the first one included. */
export const QR_MAX_REFRESH_COUNT = 3;
export const QR_POLL_INTERVAL_MS = 1_000;

/** `ret` or `errcode` of a bot token the server no longer accepts. */
export const STALE_TOKEN_CODE = -14;
export const STALE_TOKEN_PAUSE_MS = 60 * 60_000;

export const RETRY_DELAY_MS = 2_000;
export const RETRY_LONG_DELAY_MS = 30_000;
/** The failure in a row after which the long delay is used. */
export const RETRY_LONG_AFTER = 3;

/** Characters of text in one outbound message. */
export const TEXT_CHUNK_LIMIT = 4_000;
export const MEDIA_MAX_BYTES = 100 * 1024 * 1024;
export const CDN_UPLOAD_ATTEMPTS = 3;
export const CDN_IDLE_TIMEOUT_MS = 30_000;
export const TYPING_KEEPALIVE_MS = 5_000;

// The host names below are taken from the two default URLs. Whether an
// account is ever sent to a host outside them is not known yet.
export const API_HOST_SUFFIX = ".weixin.qq.com";
export const CDN_HOST_SUFFIXES = [".weixin.qq.com", ".qq.com"] as const;
