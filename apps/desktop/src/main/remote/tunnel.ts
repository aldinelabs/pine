import {
  request as httpRequest,
  type ClientRequest,
  type IncomingMessage,
} from "node:http";
import {
  FrameError,
  dataFrames,
  encodeFrame,
  type Frame,
  type RequestHead,
} from "@pine/rc-protocol";

/** The sending side of one paired device's DataChannel. */
export interface TunnelChannel {
  send(bytes: Uint8Array): void;
  /** Resolves once the send buffer has emptied enough to send more. */
  drained(): Promise<void>;
}

export interface TunnelOptions {
  /** The local web server, such as http://127.0.0.1:9415. */
  origin: string;
  /** The signed-in cookie to attach to every request, as "name=value". */
  cookie: () => string | undefined;
  maxStreams?: number;
  maxRequestBytes?: number;
}

export const MAX_TUNNEL_STREAMS = 32;
/** The same ceiling the local web server puts on an upload. */
export const MAX_TUNNEL_REQUEST_BYTES = 36 * 1024 * 1024;

/**
 * The device decides none of these: Host and Origin must be the local server's
 * own to pass its checks, and the cookie is the pairing's, not the device's.
 */
const STRIPPED_REQUEST_HEADERS = new Set([
  "host",
  "cookie",
  "origin",
  "referer",
  "connection",
  "keep-alive",
  "content-length",
  "transfer-encoding",
  "upgrade",
  "expect",
  "te",
  "trailer",
  "proxy-authorization",
  "proxy-connection",
  "forwarded",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
]);

/** A cookie is only valid at the local server, and framing is ours to do. */
const STRIPPED_RESPONSE_HEADERS = new Set([
  "set-cookie",
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "proxy-authenticate",
  "proxy-connection",
]);

interface TunnelStream {
  upstream: ClientRequest;
  response?: IncomingMessage;
  received: number;
  /** The device's end frame arrived, so the request body is complete. */
  requestEnded: boolean;
  /** A response has been started, so an error can only cut the stream short. */
  responded: boolean;
}

/**
 * The desktop's end of the HTTP-over-DataChannel tunnel. Each stream the
 * device opens becomes one request to the local web server, so the server's
 * own checks, request cache and event replay apply unchanged. Everything the
 * device may do is therefore what a signed-in browser may do.
 */
export class Tunnel {
  private readonly streams = new Map<number, TunnelStream>();
  private closed = false;

  constructor(
    private readonly channel: TunnelChannel,
    private readonly options: TunnelOptions,
  ) {}

  handle(frame: Frame): void {
    if (this.closed) return;
    switch (frame.type) {
      case "request":
        this.open(frame.stream, frame.head);
        return;
      case "data":
        this.body(frame.stream, frame.data);
        return;
      case "end": {
        const stream = this.streams.get(frame.stream);
        if (stream) {
          stream.requestEnded = true;
          stream.upstream.end();
        }
        return;
      }
      case "cancel":
        this.abort(frame.stream);
        return;
      case "ping":
        this.write({ type: "pong", stream: frame.stream });
        return;
      default:
        return;
    }
  }

  close(): void {
    this.closed = true;
    for (const id of [...this.streams.keys()]) this.abort(id);
  }

  private write(frame: Frame): boolean {
    try {
      this.channel.send(encodeFrame(frame));
      return true;
    } catch (error) {
      if (error instanceof FrameError) return false;
      this.close();
      return false;
    }
  }

  /** Answers a stream that never reached the server, or never got a head. */
  private reply(id: number, status: number): void {
    this.write({ type: "response", stream: id, head: { status, headers: [] } });
    this.write({ type: "end", stream: id });
  }

  private open(id: number, head: RequestHead): void {
    // The device opens odd streams; anything else is not from our protocol.
    if (id % 2 === 0 || this.streams.has(id)) return;
    if (this.streams.size >= (this.options.maxStreams ?? MAX_TUNNEL_STREAMS)) {
      this.reply(id, 429);
      return;
    }
    const target = new URL(this.options.origin);
    const headers: Record<string, string> = {};
    for (const [name, value] of head.headers) {
      const lower = name.toLowerCase();
      if (STRIPPED_REQUEST_HEADERS.has(lower)) continue;
      headers[lower] = lower in headers ? `${headers[lower]}, ${value}` : value;
    }
    headers.host = target.host;
    if (head.method !== "GET" && head.method !== "HEAD")
      headers.origin = target.origin;
    const cookie = this.options.cookie();
    if (cookie) headers.cookie = cookie;

    const upstream = httpRequest({
      hostname: target.hostname,
      port: target.port,
      method: head.method,
      path: head.path,
      headers,
    });
    const stream: TunnelStream = {
      upstream,
      received: 0,
      requestEnded: false,
      responded: false,
    };
    this.streams.set(id, stream);

    upstream.on("response", (response) => {
      stream.response = response;
      const responseHeaders: Array<[string, string]> = [];
      for (const [name, value] of Object.entries(response.headers)) {
        if (STRIPPED_RESPONSE_HEADERS.has(name) || value === undefined)
          continue;
        for (const item of Array.isArray(value) ? value : [value])
          responseHeaders.push([name, item]);
      }
      stream.responded = this.write({
        type: "response",
        stream: id,
        head: { status: response.statusCode ?? 502, headers: responseHeaders },
      });
      if (!stream.responded) {
        // The head did not fit one frame, so the device has nothing to read.
        response.destroy();
        this.streams.delete(id);
        this.reply(id, 502);
        return;
      }
      response.on("data", (chunk: Buffer) => {
        response.pause();
        for (const frame of dataFrames(id, chunk)) {
          try {
            this.channel.send(frame);
          } catch {
            this.close();
            return;
          }
        }
        void this.channel.drained().then(
          () => response.resume(),
          () => this.close(),
        );
      });
      response.on("end", () => {
        if (this.streams.delete(id)) this.write({ type: "end", stream: id });
      });
      response.on("error", () => {
        if (this.streams.delete(id)) this.write({ type: "cancel", stream: id });
      });
    });
    upstream.on("error", () => {
      if (!this.streams.delete(id)) return;
      if (stream.responded) this.write({ type: "cancel", stream: id });
      else this.reply(id, 502);
    });
  }

  private body(id: number, data: Uint8Array): void {
    const stream = this.streams.get(id);
    if (!stream || stream.requestEnded) return;
    stream.received += data.length;
    if (
      stream.received >
      (this.options.maxRequestBytes ?? MAX_TUNNEL_REQUEST_BYTES)
    ) {
      this.abort(id);
      if (stream.responded) this.write({ type: "cancel", stream: id });
      else this.reply(id, 413);
      return;
    }
    stream.upstream.write(data);
  }

  private abort(id: number): void {
    const stream = this.streams.get(id);
    if (!stream) return;
    this.streams.delete(id);
    stream.response?.destroy();
    stream.upstream.destroy();
  }
}
