import type {
  BridgeCancel,
  BridgeReply,
  BridgeRequest,
} from "./bridgeMessages";
import type { TunnelClient } from "./tunnelClient";

function reply(
  port: MessagePort,
  message: BridgeReply,
  transfer?: Transferable[],
) {
  port.postMessage(message, transfer ?? []);
}

/**
 * Answers the service worker's requests through whichever tunnel is open,
 * streaming each response back on the request's own port.
 */
export async function serveRequest(
  request: BridgeRequest,
  port: MessagePort,
  tunnel: TunnelClient | undefined,
): Promise<void> {
  if (!tunnel || tunnel.isClosed) {
    reply(port, {
      type: "error",
      status: 503,
      message: "Pine is not connected.",
    });
    port.close();
    return;
  }
  const abort = new AbortController();
  port.onmessage = (event: MessageEvent<BridgeCancel>) => {
    if (event.data.type === "cancel") abort.abort();
  };
  try {
    const response = await tunnel.request(
      {
        method: request.method,
        path: request.path,
        headers: request.headers,
        ...(request.body ? { body: new Uint8Array(request.body) } : {}),
      },
      abort.signal,
    );
    reply(port, {
      type: "head",
      status: response.status,
      headers: response.headers,
    });
    const reader = response.body.getReader();
    abort.signal.addEventListener("abort", () => {
      void reader.cancel().catch(() => undefined);
    });
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value.buffer.slice(
        value.byteOffset,
        value.byteOffset + value.byteLength,
      ) as ArrayBuffer;
      reply(port, { type: "data", chunk }, [chunk]);
    }
    reply(port, { type: "end" });
  } catch (error) {
    if (!abort.signal.aborted)
      reply(port, {
        type: "error",
        status: 502,
        message: error instanceof Error ? error.message : String(error),
      });
  } finally {
    port.close();
  }
}
