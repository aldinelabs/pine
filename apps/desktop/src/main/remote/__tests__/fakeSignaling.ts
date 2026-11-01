import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";

type Role = "host" | "client";

interface Room {
  streams: Partial<Record<Role, ServerResponse>>;
  queued: Record<Role, string[]>;
}

/**
 * A small in-memory stand-in for apps/rc-signal, with the same paths and
 * behaviour the host relies on: event streams per role, messages held for an
 * absent peer, and an empty relay list.
 */
export async function startFakeSignaling() {
  const rooms = new Map<string, Room>();
  const roomOf = (id: string) => {
    let room = rooms.get(id);
    if (!room) {
      room = { streams: {}, queued: { host: [], client: [] } };
      rooms.set(id, room);
    }
    return room;
  };
  const server: Server = createServer((request: IncomingMessage, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", "http://localhost");
      const match = /^\/rc\/v1\/rooms\/([^/]+)\/(events|messages|turn)$/.exec(
        url.pathname,
      );
      const role = url.searchParams.get("role") as Role | null;
      if (!match || (role !== "host" && role !== "client")) {
        response.writeHead(404).end();
        return;
      }
      const room = roomOf(match[1]);
      if (match[2] === "events") {
        response.writeHead(200, { "Content-Type": "text/event-stream" });
        response.write("retry: 3000\n\n");
        room.streams[role]?.end();
        room.streams[role] = response;
        for (const data of room.queued[role].splice(0))
          response.write(`data: ${data}\n\n`);
        response.on("close", () => {
          if (room.streams[role] === response) delete room.streams[role];
        });
        return;
      }
      let body = "";
      for await (const chunk of request) body += chunk;
      if (match[2] === "turn") {
        response.writeHead(201, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ iceServers: [] }));
        return;
      }
      const peer: Role = role === "host" ? "client" : "host";
      const target = room.streams[peer];
      if (target) target.write(`data: ${JSON.stringify(JSON.parse(body))}\n\n`);
      else room.queued[peer].push(JSON.stringify(JSON.parse(body)));
      response.writeHead(202, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ delivered: Boolean(target) }));
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    async close() {
      for (const room of rooms.values())
        for (const stream of Object.values(room.streams)) stream?.destroy();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
