// State machine ported from @tencent-weixin/openclaw-weixin 2.4.10 (MIT),
// Copyright (C) 2026 Tencent. See LICENSE-openclaw-weixin.
// Validation of server-supplied hosts is Pine's own.

import type { IlinkCredentials } from "./client";
import {
  ILINK_BOT_TYPE,
  ILINK_DEFAULT_BASE_URL,
  LONG_POLL_TIMEOUT_MS,
  QR_FETCH_TIMEOUT_MS,
  QR_LOCAL_TTL_MS,
  QR_LOGIN_DEADLINE_MS,
  QR_MAX_REFRESH_COUNT,
  QR_POLL_INTERVAL_MS,
} from "./constants";
import {
  type IlinkTransportOptions,
  defaultAllowUrl,
  getJson,
  postJson,
} from "./http";
import type { QrCodeResp, QrStatusResp } from "./types";

export type QrLoginEvent =
  /** A code to show. `content` is the text to draw as a QR code. */
  | { type: "qr"; content: string; expiresAtMs: number; refresh: number }
  | { type: "scanned" }
  /** The phone shows digits the user has to type here. */
  | { type: "need-verify-code"; retry: boolean }
  | { type: "confirmed"; credentials: IlinkCredentials }
  /** The scanned bot is one of `localTokens`; nothing new was issued. */
  | { type: "already-bound" }
  | {
      type: "failed";
      reason: "expired" | "blocked" | "timeout" | "cancelled" | "protocol";
      message: string;
    };

type LoginEnd = Extract<
  QrLoginEvent,
  { type: "confirmed" | "already-bound" | "failed" }
>;

export interface QrLogin {
  /** Settles with the event that ended the login. Never rejects. */
  readonly done: Promise<LoginEnd>;
  submitVerifyCode(code: string): void;
  cancel(): void;
}

/** Tokens sent as `local_token_list`. */
const LOCAL_TOKEN_LIMIT = 10;

class Cancelled extends Error {}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(done, ms);
    function done(): void {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}

function failed(
  reason: Extract<LoginEnd, { type: "failed" }>["reason"],
  message: string,
): LoginEnd {
  return { type: "failed", reason, message };
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Shows QR codes and waits until the user has scanned and confirmed one
 * (PROTO §2.3). Poll errors count as `wait`. At most
 * `QR_MAX_REFRESH_COUNT` codes are shown. A `redirect_host` and the
 * account's `baseurl` have to pass `allowUrl` with purpose `"api"`, else the
 * login fails with reason `"protocol"`. A `redirect_host` without a scheme
 * is reached over https.
 */
export function startQrLogin(
  options: IlinkTransportOptions & {
    /** Bot tokens this installation already holds, newest first. */
    localTokens?: readonly string[];
    onEvent(event: QrLoginEvent): void;
    deadlineMs?: number;
  },
): QrLogin {
  const { localTokens, onEvent, deadlineMs, ...transport } = options;
  const now = transport.now ?? Date.now;
  const sleep = transport.sleep ?? defaultSleep;
  const allowUrl = transport.allowUrl ?? defaultAllowUrl;
  const fixedBase = transport.apiBaseUrl ?? ILINK_DEFAULT_BASE_URL;
  const controller = new AbortController();
  const signal = controller.signal;

  let submitted: string | undefined;
  let wakeWaiter: (() => void) | undefined;

  const emit = (event: QrLoginEvent): void => {
    try {
      onEvent(event);
    } catch {
      // A listener's failure must not end the login.
    }
  };

  const checkCancelled = (): void => {
    if (signal.aborted) throw new Cancelled();
  };

  const fetchQr = async (): Promise<{ qrcode: string; content: string }> => {
    const tokens = (localTokens ?? [])
      .map((token) => token.trim())
      .filter((token) => token.length > 0)
      .slice(0, LOCAL_TOKEN_LIMIT);
    const answer = await postJson(transport, {
      endpoint: `ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(ILINK_BOT_TYPE)}`,
      label: "getBotQrCode",
      body: { local_token_list: tokens },
      timeoutMs: QR_FETCH_TIMEOUT_MS,
      baseUrl: fixedBase,
      signal,
    });
    const response = (
      typeof answer === "object" && answer !== null ? answer : {}
    ) as QrCodeResp;
    const qrcode = stringField(response.qrcode);
    const content = stringField(response.qrcode_img_content);
    if (!qrcode || !content) throw new Error("no QR code in the answer");
    return { qrcode, content };
  };

  const pollStatus = async (
    base: string,
    qrcode: string,
    verifyCode: string | undefined,
  ): Promise<QrStatusResp> => {
    let endpoint = `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`;
    if (verifyCode !== undefined) {
      endpoint += `&verify_code=${encodeURIComponent(verifyCode)}`;
    }
    try {
      const answer = await getJson(transport, {
        endpoint,
        label: "getQrCodeStatus",
        timeoutMs: LONG_POLL_TIMEOUT_MS,
        baseUrl: base,
        signal,
      });
      return (
        typeof answer === "object" && answer !== null ? answer : {}
      ) as QrStatusResp;
    } catch {
      checkCancelled();
      // A timeout, a gateway error or a network failure: keep waiting.
      return { status: "wait" };
    }
  };

  /**
   * Resolves with the next submitted code, or `undefined` at the deadline.
   * Waits on a real timer, not on the injected sleep: the code comes from
   * the user, not from the clock.
   */
  const waitForCode = async (deadline: number): Promise<string | undefined> => {
    if (submitted === undefined) {
      checkCancelled();
      const remaining = deadline - now();
      if (remaining <= 0) return undefined;
      await new Promise<void>((resolve) => {
        const finish = (): void => {
          clearTimeout(timer);
          signal.removeEventListener("abort", finish);
          wakeWaiter = undefined;
          resolve();
        };
        const timer = setTimeout(finish, remaining);
        signal.addEventListener("abort", finish, { once: true });
        wakeWaiter = finish;
      });
      checkCancelled();
    }
    const code = submitted;
    submitted = undefined;
    return code;
  };

  const run = async (): Promise<LoginEnd> => {
    const deadline =
      now() + Math.max(deadlineMs ?? QR_LOGIN_DEADLINE_MS, 1_000);
    let refreshCount = 1;
    let pollBase = fixedBase;
    let pendingCode: string | undefined;

    const showQr = async (): Promise<{ qrcode: string; startedAt: number }> => {
      const qr = await fetchQr();
      const startedAt = now();
      emit({
        type: "qr",
        content: qr.content,
        expiresAtMs: startedAt + QR_LOCAL_TTL_MS,
        refresh: refreshCount - 1,
      });
      return { qrcode: qr.qrcode, startedAt };
    };

    let current: { qrcode: string; startedAt: number };
    try {
      current = await showQr();
    } catch {
      checkCancelled();
      return failed("protocol", "The QR code could not be fetched.");
    }

    let scannedShown = false;
    while (now() < deadline) {
      checkCancelled();
      let status: string;
      let response: QrStatusResp = {};
      if (now() - current.startedAt >= QR_LOCAL_TTL_MS) {
        status = "expired";
      } else {
        response = await pollStatus(pollBase, current.qrcode, pendingCode);
        checkCancelled();
        status = stringField(response.status) || "wait";
      }

      let immediate = false;
      if (status.includes("need_verifycode")) {
        const retry = pendingCode !== undefined;
        pendingCode = undefined;
        emit({ type: "need-verify-code", retry });
        const code = await waitForCode(deadline);
        if (code === undefined) break;
        pendingCode = code.trim();
        immediate = true;
      } else if (status === "scaned") {
        pendingCode = undefined;
        if (!scannedShown) {
          scannedShown = true;
          emit({ type: "scanned" });
        }
      } else if (status === "expired" || status === "verify_code_blocked") {
        const blocked = status === "verify_code_blocked";
        pendingCode = undefined;
        refreshCount++;
        if (refreshCount > QR_MAX_REFRESH_COUNT) {
          return blocked
            ? failed("blocked", "Too many wrong verification codes.")
            : failed("expired", "The QR code expired too many times.");
        }
        try {
          current = await showQr();
        } catch {
          checkCancelled();
          return failed("protocol", "The QR code could not be fetched.");
        }
        scannedShown = false;
        immediate = true;
      } else if (status === "scaned_but_redirect") {
        const host = stringField(response.redirect_host);
        if (host) {
          const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(host)
            ? host
            : `https://${host}`;
          let url: URL | undefined;
          try {
            url = new URL(candidate);
          } catch {
            url = undefined;
          }
          if (!url || !allowUrl(url, "api")) {
            return failed(
              "protocol",
              "The server sent the login to a host that is not allowed.",
            );
          }
          pollBase = candidate;
        }
        if (!scannedShown) {
          scannedShown = true;
          emit({ type: "scanned" });
        }
      } else if (status === "binded_redirect") {
        return { type: "already-bound" };
      } else if (status === "confirmed") {
        const botToken = stringField(response.bot_token);
        const botId = stringField(response.ilink_bot_id);
        const userId = stringField(response.ilink_user_id);
        if (!botId) {
          return failed("protocol", "The server did not return ilink_bot_id.");
        }
        if (!botToken || !userId) {
          return failed("protocol", "The server did not return the account.");
        }
        const baseUrl = stringField(response.baseurl) || fixedBase;
        let url: URL | undefined;
        try {
          url = new URL(baseUrl);
        } catch {
          url = undefined;
        }
        if (!url || !allowUrl(url, "api")) {
          return failed(
            "protocol",
            "The server gave the account a host that is not allowed.",
          );
        }
        return {
          type: "confirmed",
          credentials: { botToken, botId, userId, baseUrl },
        };
      }

      if (!immediate) {
        const remaining = deadline - now();
        if (remaining <= 0) break;
        try {
          await sleep(Math.min(QR_POLL_INTERVAL_MS, remaining), signal);
        } catch {
          // An injected sleep may reject on abort.
        }
      }
    }
    checkCancelled();
    return failed("timeout", "The login took too long.");
  };

  const done = run().then(
    (end) => {
      if (signal.aborted && end.type !== "failed") {
        return failed("cancelled", "The login was cancelled.");
      }
      return end;
    },
    (error: unknown) =>
      error instanceof Cancelled || signal.aborted
        ? failed("cancelled", "The login was cancelled.")
        : failed("protocol", "The login failed."),
  );
  const finished = done.then((end) => {
    emit(end);
    controller.abort();
    return end;
  });

  return {
    done: finished,
    submitVerifyCode(code: string) {
      submitted = code;
      wakeWaiter?.();
    },
    cancel() {
      controller.abort(new Cancelled("cancelled"));
    },
  };
}
