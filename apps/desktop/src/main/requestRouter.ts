/** Application requests do not depend on an Electron IPC event. */
export interface PineRequestContext {
  clientId: number;
  source: "desktop" | "web";
}

export type PineRequestHandler = (
  context: PineRequestContext,
  request?: unknown,
) => unknown;

/** Wraps every handled request, whichever transport it arrived on. */
export type PineRequestTracer = (
  channel: string,
  clientId: number,
  run: () => unknown,
) => unknown;

export class PineRequestRouter {
  private readonly handlers = new Map<string, PineRequestHandler>();

  constructor(private readonly trace?: PineRequestTracer) {}

  register(channel: string, handler: PineRequestHandler): void {
    if (this.handlers.has(channel))
      throw new Error(`Duplicate request: ${channel}`);
    this.handlers.set(channel, handler);
  }

  /** Every registered channel, so a transport can expose them all. */
  channels(): string[] {
    return [...this.handlers.keys()];
  }

  invoke(
    channel: string,
    context: PineRequestContext,
    request?: unknown,
  ): unknown {
    const handler = this.handlers.get(channel);
    if (!handler)
      throw new Error("This operation is unavailable in the browser.");
    const run = () => handler(context, request);
    return this.trace ? this.trace(channel, context.clientId, run) : run();
  }
}
