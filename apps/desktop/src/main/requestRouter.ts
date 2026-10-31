/** Application requests do not depend on an Electron IPC event. */
export interface PineRequestContext {
  clientId: number;
  source: "desktop" | "web";
}

export type PineRequestHandler = (
  context: PineRequestContext,
  request?: unknown,
) => unknown;

export class PineRequestRouter {
  private readonly handlers = new Map<string, PineRequestHandler>();

  register(channel: string, handler: PineRequestHandler): void {
    if (this.handlers.has(channel))
      throw new Error(`Duplicate request: ${channel}`);
    this.handlers.set(channel, handler);
  }

  invoke(
    channel: string,
    context: PineRequestContext,
    request?: unknown,
  ): unknown {
    const handler = this.handlers.get(channel);
    if (!handler)
      throw new Error("This operation is unavailable in the browser.");
    return handler(context, request);
  }
}
