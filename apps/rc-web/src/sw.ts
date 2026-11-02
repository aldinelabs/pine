/// <reference lib="webworker" />
import type {
  BridgeCancel,
  BridgeReply,
  BridgeRequest,
  ShellHello,
} from "./bridgeMessages";

/**
 * Serves the computer's own Pine web interface inside /pine/<token>/. Every
 * request from that embedded page, and from workers it starts, goes to the
 * page that holds the DataChannel, which sends it through the tunnel. This
 * site's own files are fetched as usual.
 */
declare const self: ServiceWorkerGlobalScope;

// Kept in step with PINE_PREFIX; the worker imports nothing at runtime.
const PREFIX = "/pine/";
const NO_BODY = new Set([204, 205, 304]);

/**
 * Pine forbids being framed, but here this site's own page embeds it from the
 * same origin; other sites still cannot.
 */
function embeddable(headers: Array<[string, string]>): Array<[string, string]> {
  return headers.map(([name, value]) =>
    name.toLowerCase() === "x-frame-options"
      ? [name, "SAMEORIGIN"]
      : [name, value],
  );
}

/** Which page holds the connection for each embedded Pine. */
const shells = new Map<string, string>();

self.addEventListener("install", () => {
  void self.skipWaiting();
});
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("message", (event) => {
  const data = event.data as ShellHello | undefined;
  const source = event.source;
  if (
    data?.type === "pine-shell" &&
    typeof data.token === "string" &&
    source &&
    "id" in source
  )
    shells.set(data.token, source.id);
});

function tokenOf(pathname: string): string | undefined {
  if (!pathname.startsWith(PREFIX)) return undefined;
  return pathname.slice(PREFIX.length).split("/")[0] || undefined;
}

/**
 * The computer's own path. Pine's page may load files relative to itself,
 * which land inside /pine/<token>/, or from the root, such as /api/rpc.
 */
function computerPath(url: URL): string {
  const token = tokenOf(url.pathname);
  const path = token
    ? url.pathname.slice(PREFIX.length + token.length) || "/"
    : url.pathname;
  return path + url.search;
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (event.request.mode === "navigate") {
    const token = tokenOf(url.pathname);
    if (!token) return;
    event.respondWith(tunnel(event.request, computerPath(url), token));
    return;
  }
  if (!event.clientId) return;
  event.respondWith(
    (async () => {
      const client = await self.clients.get(event.clientId);
      const token = client && tokenOf(new URL(client.url).pathname);
      // Workers the embedded page starts have their own URLs; this site
      // starts none, so they belong to the embedded page too.
      if (client && (token || client.type !== "window"))
        return tunnel(
          event.request,
          computerPath(url),
          token ?? tokenOf(url.pathname),
        );
      return fetch(event.request);
    })(),
  );
});

async function findShell(
  token: string | undefined,
): Promise<Client | undefined> {
  const id = token ? shells.get(token) : undefined;
  if (id) {
    const client = await self.clients.get(id);
    if (client) return client;
  }
  // The worker may have restarted and forgotten; any top page will do.
  const windows = await self.clients.matchAll({ type: "window" });
  return windows.find(
    (client) =>
      !new URL(client.url).pathname.startsWith(PREFIX) &&
      (client as WindowClient).frameType === "top-level",
  );
}

async function tunnel(
  request: Request,
  path: string,
  token: string | undefined,
): Promise<Response> {
  const shell = await findShell(token);
  if (!shell)
    return new Response("Pine is not connected.", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  const body =
    request.method === "GET" || request.method === "HEAD"
      ? undefined
      : await request.arrayBuffer();
  const { port1, port2 } = new MessageChannel();
  const message: BridgeRequest = {
    type: "pine-request",
    method: request.method,
    path,
    headers: [...request.headers],
    ...(body ? { body } : {}),
  };
  shell.postMessage(message, body ? [port2, body] : [port2]);

  return new Promise<Response>((resolve) => {
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    let done = false;
    const finish = () => {
      done = true;
      port1.close();
    };
    const cancel = () => {
      if (done) return;
      port1.postMessage({ type: "cancel" } satisfies BridgeCancel);
      finish();
    };
    request.signal.addEventListener("abort", () => {
      cancel();
      try {
        controller?.error(new DOMException("Aborted", "AbortError"));
      } catch {
        // Already closed.
      }
    });
    port1.onmessage = (event: MessageEvent<BridgeReply>) => {
      const reply = event.data;
      switch (reply.type) {
        case "head": {
          const empty = NO_BODY.has(reply.status) || request.method === "HEAD";
          const stream = empty
            ? null
            : new ReadableStream<Uint8Array>({
                start: (c) => {
                  controller = c;
                },
                cancel,
              });
          resolve(
            new Response(stream, {
              status: reply.status,
              headers: embeddable(reply.headers),
            }),
          );
          if (empty) cancel();
          return;
        }
        case "data":
          controller?.enqueue(new Uint8Array(reply.chunk));
          return;
        case "end":
          controller?.close();
          finish();
          return;
        case "error":
          if (controller) controller.error(new Error(reply.message));
          else
            resolve(
              new Response(reply.message, {
                status: reply.status,
                headers: { "Content-Type": "text/plain; charset=utf-8" },
              }),
            );
          finish();
          return;
      }
    };
  });
}
