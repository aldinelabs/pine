import type { IlinkClient } from "./client";
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
  throw new Error("not implemented");
}
