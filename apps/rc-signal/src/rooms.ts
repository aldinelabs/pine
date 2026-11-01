export type Role = "host" | "client";

export function peerOf(role: Role): Role {
  return role === "host" ? "client" : "host";
}

export interface Subscriber {
  send(event: { id: number; data: string }): void;
  close(): void;
}

interface Room {
  subscribers: Partial<Record<Role, Subscriber>>;
  queued: Record<Role, Array<{ id: number; data: string; at: number }>>;
  sequence: number;
  touched: number;
}

export const MAX_QUEUED_MESSAGES = 16;
export const QUEUE_TTL_MS = 60_000;
export const MAX_ROOMS = 5_000;

/**
 * Rooms are mailboxes between the two roles. The service never reads a
 * message: it keeps only the last few for a peer that is not connected yet,
 * and forgets a room soon after both sides leave.
 */
export class RoomHub {
  private readonly rooms = new Map<string, Room>();

  constructor(
    private readonly maxRooms = MAX_ROOMS,
    private readonly clock: () => number = Date.now,
  ) {}

  size(): number {
    return this.rooms.size;
  }

  private room(id: string, now: number): Room | undefined {
    let room = this.rooms.get(id);
    if (!room) {
      if (this.rooms.size >= this.maxRooms) return undefined;
      room = {
        subscribers: {},
        queued: { host: [], client: [] },
        sequence: 0,
        touched: now,
      };
      this.rooms.set(id, room);
    }
    room.touched = now;
    return room;
  }

  /**
   * Connects a role, replacing an older connection of the same role, and
   * hands over what was queued for it. Undefined when the service is full.
   */
  subscribe(
    id: string,
    role: Role,
    subscriber: Subscriber,
    now: number,
  ): (() => void) | undefined {
    const room = this.room(id, now);
    if (!room) return undefined;
    room.subscribers[role]?.close();
    room.subscribers[role] = subscriber;
    const waiting = room.queued[role].filter(
      (message) => now - message.at <= QUEUE_TTL_MS,
    );
    room.queued[role] = [];
    for (const message of waiting) subscriber.send(message);
    return () => {
      if (room.subscribers[role] === subscriber) delete room.subscribers[role];
      room.touched = this.clock();
    };
  }

  /** Delivers to the peer now if it is connected, else holds it briefly. */
  post(
    id: string,
    from: Role,
    data: string,
    now: number,
  ): "delivered" | "queued" | "full" {
    const room = this.room(id, now);
    if (!room) return "full";
    const message = { id: ++room.sequence, data, at: now };
    const peer = room.subscribers[peerOf(from)];
    if (peer) {
      peer.send(message);
      return "delivered";
    }
    const queue = room.queued[peerOf(from)];
    queue.push(message);
    while (queue.length > MAX_QUEUED_MESSAGES) queue.shift();
    return "queued";
  }

  /** Both sides are connected, so a relay might actually be needed. */
  online(id: string): boolean {
    const room = this.rooms.get(id);
    return Boolean(room?.subscribers.host && room.subscribers.client);
  }

  sweep(now: number): void {
    for (const [id, room] of this.rooms) {
      const connected = room.subscribers.host || room.subscribers.client;
      const holding = [...room.queued.host, ...room.queued.client].some(
        (message) => now - message.at <= QUEUE_TTL_MS,
      );
      if (!connected && !holding && now - room.touched > QUEUE_TTL_MS)
        this.rooms.delete(id);
    }
  }

  closeAll(): void {
    for (const room of this.rooms.values())
      for (const subscriber of Object.values(room.subscribers))
        subscriber.close();
    this.rooms.clear();
  }
}
