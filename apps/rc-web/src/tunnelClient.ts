import {
  dataFrames,
  decodeFrame,
  encodeFrame,
  type Frame,
  type RequestHead,
} from "@pine/rc-protocol";

/** The sending side of the DataChannel to the desktop. */
export interface LinkChannel {
  send(bytes: Uint8Array): void;
  /** Resolves once the send buffer has room for more. */
  drained(): Promise<void>;
}

export interface TunnelRequest extends RequestHead {
  body?: Uint8Array;
}

export interface TunnelResponse {
  status: number;
  headers: Array<[string, string]>;
  body: ReadableStream<Uint8Array>;
}

interface Pending {
  resolve(response: TunnelResponse): void;
  reject(error: Error): void;
  controller?: ReadableStreamDefaultController<Uint8Array>;
}

export class TunnelClosedError extends Error {
  constructor() {
    super("The connection to the computer was closed.");
  }
}

/**
 * The phone's end of the HTTP-over-DataChannel tunnel. Each request becomes
 * one odd-numbered stream; the desktop answers with a head, body frames and
 * an end. Control frames between the devices go to `onControl`.
 */
export class TunnelClient {
  private nextStream = 1;
  private readonly streams = new Map<number, Pending>();
  private closed = false;

  constructor(
    private readonly channel: LinkChannel,
    private readonly onControl: (
      message: Record<string, unknown>,
    ) => void = () => undefined,
  ) {}

  get isClosed(): boolean {
    return this.closed;
  }

  send(frame: Frame): void {
    if (this.closed) throw new TunnelClosedError();
    this.channel.send(encodeFrame(frame));
  }

  async request(
    request: TunnelRequest,
    signal?: AbortSignal,
  ): Promise<TunnelResponse> {
    if (this.closed) throw new TunnelClosedError();
    const id = this.nextStream;
    this.nextStream += 2;
    const response = new Promise<TunnelResponse>((resolve, reject) =>
      this.streams.set(id, { resolve, reject }),
    );
    const abort = () =>
      this.cancel(id, new DOMException("Aborted", "AbortError"));
    if (signal?.aborted) abort();
    signal?.addEventListener("abort", abort, { once: true });
    try {
      this.send({
        type: "request",
        stream: id,
        head: {
          method: request.method,
          path: request.path,
          headers: request.headers,
        },
      });
      if (request.body)
        for (const frame of dataFrames(id, request.body)) {
          if (!this.streams.has(id)) break;
          this.channel.send(frame);
          await this.channel.drained();
        }
      if (this.streams.has(id)) this.send({ type: "end", stream: id });
    } catch (error) {
      this.fail(id, error instanceof Error ? error : new Error(String(error)));
    }
    return response.finally(() => signal?.removeEventListener("abort", abort));
  }

  /** Feeds one message from the DataChannel. */
  receive(bytes: Uint8Array): void {
    let frame: Frame;
    try {
      frame = decodeFrame(bytes);
    } catch {
      return;
    }
    if (frame.type === "control") {
      this.onControl(frame.message);
      return;
    }
    const stream = this.streams.get(frame.stream);
    if (!stream) return;
    switch (frame.type) {
      case "response": {
        const body = new ReadableStream<Uint8Array>({
          start: (controller) => {
            stream.controller = controller;
          },
          cancel: () => this.cancel(frame.stream),
        });
        stream.resolve({
          status: frame.head.status,
          headers: frame.head.headers,
          body,
        });
        return;
      }
      case "data":
        // The frame's bytes are a view into the message; keep a copy.
        stream.controller?.enqueue(frame.data.slice());
        return;
      case "end":
        this.streams.delete(frame.stream);
        if (stream.controller) stream.controller.close();
        else stream.reject(new Error("The computer sent no response."));
        return;
      case "cancel":
        this.fail(
          frame.stream,
          new Error("The computer cut the response short."),
        );
        return;
      default:
        return;
    }
  }

  /** Ends every stream; the channel has closed. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const id of [...this.streams.keys()])
      this.fail(id, new TunnelClosedError());
  }

  private cancel(id: number, reason?: Error): void {
    if (!this.streams.has(id)) return;
    try {
      if (!this.closed) this.send({ type: "cancel", stream: id });
    } catch {
      // The channel is going away; the stream ends either way.
    }
    this.fail(id, reason ?? new DOMException("Aborted", "AbortError"));
  }

  private fail(id: number, error: Error): void {
    const stream = this.streams.get(id);
    if (!stream) return;
    this.streams.delete(id);
    if (stream.controller) {
      try {
        stream.controller.error(error);
      } catch {
        // Already cancelled by the reader.
      }
    } else stream.reject(error);
  }
}
