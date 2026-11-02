/** The shape WebRTC takes for STUN and TURN servers. */
export interface IceServer {
  urls: string[];
  username?: string;
  credential?: string;
}

/** A `fetch`; the desktop passes its own so its proxy settings apply. */
export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

const API_PREFIX = "/rc/v1";
const HEARTBEAT_TIMEOUT_MS = 45_000;

export type SignalingState = "connecting" | "open" | "closed";

export interface SignalingRoomOptions {
  /** Origin of the signaling service, such as https://api.aldine.cn. */
  origin: string;
  room: string;
  role: "host" | "client";
  fetch: Fetch;
  onMessage(message: Record<string, unknown>): void;
  onState?(state: SignalingState): void;
  /** Waits before reconnect number `attempt`, starting at 1. */
  backoff?(attempt: number): number;
  heartbeatTimeoutMs?: number;
}

export function defaultBackoff(attempt: number): number {
  return (
    Math.min(30_000, 1000 * 2 ** Math.min(attempt - 1, 5)) *
    (0.75 + Math.random() * 0.5)
  );
}

/**
 * One side of a signaling room. It keeps an event stream open for what the
 * peer sends, reconnecting when the stream drops or goes quiet, and posts what
 * this side sends. The service only relays; nothing here is trusted until the
 * handshake has been verified.
 */
export class SignalingRoom {
  private controller: AbortController | null = null;
  private stopped = true;
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly options: SignalingRoomOptions) {}

  private url(path: string): string {
    return `${this.options.origin}${API_PREFIX}/rooms/${this.options.room}/${path}?role=${this.options.role}`;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.attempt = 0;
    void this.run();
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.timer);
    this.controller?.abort();
    this.controller = null;
    this.options.onState?.("closed");
  }

  async send(
    message: Record<string, unknown>,
  ): Promise<{ delivered: boolean }> {
    const response = await this.options.fetch(this.url("messages"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status !== 202)
      throw new Error(`Signaling answered ${response.status}.`);
    return (await response.json()) as { delivered: boolean };
  }

  /** Relay servers for this connection, or none when the service has none. */
  async turn(): Promise<IceServer[] | undefined> {
    try {
      const response = await this.options.fetch(this.url("turn"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        signal: AbortSignal.timeout(10_000),
      });
      if (response.status !== 201) return undefined;
      const body = (await response.json()) as { iceServers?: IceServer[] };
      return Array.isArray(body.iceServers) ? body.iceServers : undefined;
    } catch {
      return undefined;
    }
  }

  private async run(): Promise<void> {
    while (!this.stopped) {
      const controller = new AbortController();
      this.controller = controller;
      this.options.onState?.("connecting");
      try {
        await this.read(controller);
      } catch {
        // A dropped stream is the normal reason to come back here.
      }
      if (this.stopped) return;
      this.options.onState?.("connecting");
      this.attempt += 1;
      const wait = (this.options.backoff ?? defaultBackoff)(this.attempt);
      await new Promise<void>((resolve) => {
        this.timer = setTimeout(resolve, wait);
      });
    }
  }

  private async read(controller: AbortController): Promise<void> {
    const response = await this.options.fetch(this.url("events"), {
      signal: controller.signal,
      headers: { Accept: "text/event-stream" },
    });
    if (response.status !== 200 || !response.body)
      throw new Error(`Signaling answered ${response.status}.`);
    this.attempt = 0;
    this.options.onState?.("open");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const quiet = this.options.heartbeatTimeoutMs ?? HEARTBEAT_TIMEOUT_MS;
    let buffer = "";
    let timer: ReturnType<typeof setTimeout> | undefined;
    let fail: (error: Error) => void = () => undefined;
    const silence = new Promise<never>((_, reject) => {
      fail = reject;
    });
    silence.catch(() => undefined);
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => fail(new Error("quiet")), quiet);
    };
    arm();
    try {
      for (;;) {
        const chunk = await Promise.race([reader.read(), silence]);
        arm();
        if (chunk.done) return;
        buffer += decoder.decode(chunk.value, { stream: true });
        let end: number;
        while ((end = buffer.indexOf("\n\n")) >= 0) {
          const block = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const data = block
            .split("\n")
            .filter((line) => line.startsWith("data: "))
            .map((line) => line.slice(6))
            .join("\n");
          if (!data) continue;
          try {
            const message = JSON.parse(data) as unknown;
            if (
              message &&
              typeof message === "object" &&
              !Array.isArray(message)
            )
              this.options.onMessage(message as Record<string, unknown>);
          } catch {
            // The service relays JSON objects; anything else is ignored.
          }
        }
      }
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }
}
