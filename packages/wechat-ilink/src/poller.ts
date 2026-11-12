// Loop ported from @tencent-weixin/openclaw-weixin 2.4.10 (MIT),
// Copyright (C) 2026 Tencent. See LICENSE-openclaw-weixin.
// Unlike the original, a batch is only handed over, never handled, before
// the next poll.

import type { IlinkClient } from "./client";
import {
  RETRY_DELAY_MS,
  RETRY_LONG_AFTER,
  RETRY_LONG_DELAY_MS,
  STALE_TOKEN_PAUSE_MS,
} from "./constants";
import { IlinkApiError } from "./errors";
import type { WeixinMessage } from "./types";

export type PollerState =
  | { kind: "polling" }
  | { kind: "backoff"; untilMs: number; error: string }
  /** The bot token is no longer accepted. Polling is retried at `untilMs`. */
  | { kind: "stale-token"; untilMs: number };

export interface Poller {
  /** Ends the running poll and tells the server the client is gone. */
  stop(): Promise<void>;
  /** Ends a backoff or a stale-token wait now. */
  wake(): void;
}

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

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "The poll failed.";
}

/**
 * Polls `getupdates` until `stop()` (PROTO §4). `notifyStart` is sent before
 * the first poll and `notifyStop` after the last one; their failures are
 * ignored. A batch is handed to `onBatch` with the cursor that came with it,
 * and the cursor is used for the next poll only once `onBatch` resolved; a
 * rejected `onBatch` counts as a failed poll and the old cursor is polled
 * again. Failures back off 2 s, 2 s, 30 s, repeating; a stale token (-14)
 * waits `STALE_TOKEN_PAUSE_MS`, or until `wake()`.
 */
export function startPoller(options: {
  client: Pick<IlinkClient, "getUpdates" | "notifyStart" | "notifyStop">;
  cursor: string;
  /**
   * Persist and enqueue only. Awaited before the next poll; must never wait
   * for message handling or a download.
   */
  onBatch(batch: {
    cursor?: string;
    messages: WeixinMessage[];
    pollStartedAtMs: number;
  }): Promise<void>;
  onState?(state: PollerState): void;
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}): Poller {
  const { client, onBatch } = options;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const stopController = new AbortController();
  let waitController: AbortController | undefined;
  let lastState: PollerState["kind"] | undefined;

  const report = (state: PollerState): void => {
    if (state.kind === "polling" && lastState === "polling") return;
    lastState = state.kind;
    try {
      options.onState?.(state);
    } catch {
      // A listener's failure must not stop polling.
    }
  };

  const wait = async (ms: number): Promise<void> => {
    if (stopController.signal.aborted) return;
    const controller = new AbortController();
    waitController = controller;
    try {
      await sleep(
        ms,
        AbortSignal.any([stopController.signal, controller.signal]),
      );
    } catch {
      // An injected sleep may reject on abort.
    } finally {
      if (waitController === controller) waitController = undefined;
    }
  };

  const loop = async (): Promise<void> => {
    const signal = stopController.signal;
    let cursor = options.cursor;
    let timeoutMs: number | undefined;
    let failures = 0;

    try {
      await client.notifyStart();
    } catch {
      // Ignored, as by the official client.
    }

    while (!signal.aborted) {
      const pollStartedAtMs = now();
      try {
        report({ kind: "polling" });
        const result = await client.getUpdates(cursor, { timeoutMs, signal });
        if (signal.aborted) break;
        if (result.nextTimeoutMs !== undefined)
          timeoutMs = result.nextTimeoutMs;
        if (result.messages.length > 0 || result.cursor !== undefined) {
          await onBatch({
            cursor: result.cursor,
            messages: result.messages,
            pollStartedAtMs,
          });
        }
        if (result.cursor !== undefined) cursor = result.cursor;
        failures = 0;
      } catch (error) {
        if (signal.aborted) break;
        if (error instanceof IlinkApiError && error.staleToken) {
          failures = 0;
          report({
            kind: "stale-token",
            untilMs: now() + STALE_TOKEN_PAUSE_MS,
          });
          await wait(STALE_TOKEN_PAUSE_MS);
          continue;
        }
        failures++;
        let delay = RETRY_DELAY_MS;
        if (failures >= RETRY_LONG_AFTER) {
          failures = 0;
          delay = RETRY_LONG_DELAY_MS;
        }
        report({
          kind: "backoff",
          untilMs: now() + delay,
          error: errorText(error),
        });
        await wait(delay);
      }
    }

    try {
      await client.notifyStop();
    } catch {
      // Ignored, as by the official client.
    }
  };

  const running = loop();

  return {
    stop() {
      stopController.abort();
      return running;
    },
    wake() {
      waitController?.abort();
    },
  };
}
