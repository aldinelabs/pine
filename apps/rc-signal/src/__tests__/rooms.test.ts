import { describe, expect, it } from "vitest";
import {
  MAX_QUEUED_MESSAGES,
  QUEUE_TTL_MS,
  RoomHub,
  type Subscriber,
} from "../rooms";

function listener() {
  const received: string[] = [];
  let closed = false;
  const subscriber: Subscriber = {
    send: (event) => received.push(event.data),
    close: () => {
      closed = true;
    },
  };
  return { subscriber, received, isClosed: () => closed };
}

describe("RoomHub", () => {
  it("delivers to the peer that is connected", () => {
    const hub = new RoomHub();
    const host = listener();
    hub.subscribe("r", "host", host.subscriber, 0);
    expect(hub.post("r", "client", "one", 0)).toBe("delivered");
    expect(host.received).toEqual(["one"]);
  });

  it("holds messages for a peer that connects later", () => {
    const hub = new RoomHub();
    expect(hub.post("r", "client", "offer", 0)).toBe("queued");
    const host = listener();
    hub.subscribe("r", "host", host.subscriber, 1000);
    expect(host.received).toEqual(["offer"]);
  });

  it("drops queued messages that are too old, and the oldest past the cap", () => {
    const hub = new RoomHub();
    hub.post("r", "client", "old", 0);
    const late = listener();
    hub.subscribe("r", "host", late.subscriber, QUEUE_TTL_MS + 1);
    expect(late.received).toEqual([]);
    for (let index = 0; index < MAX_QUEUED_MESSAGES + 5; index++)
      hub.post("q", "client", `m${index}`, 0);
    const host = listener();
    hub.subscribe("q", "host", host.subscriber, 1);
    expect(host.received).toHaveLength(MAX_QUEUED_MESSAGES);
    expect(host.received[0]).toBe("m5");
  });

  it("replaces an older connection of the same role", () => {
    const hub = new RoomHub();
    const first = listener();
    const second = listener();
    hub.subscribe("r", "host", first.subscriber, 0);
    hub.subscribe("r", "host", second.subscriber, 0);
    expect(first.isClosed()).toBe(true);
    hub.post("r", "client", "x", 0);
    expect(second.received).toEqual(["x"]);
    expect(first.received).toEqual([]);
  });

  it("keeps a newer connection when the older one leaves late", () => {
    const hub = new RoomHub();
    const first = listener();
    const leaveFirst = hub.subscribe("r", "host", first.subscriber, 0)!;
    hub.subscribe("r", "host", listener().subscriber, 0);
    leaveFirst();
    hub.subscribe("r", "client", listener().subscriber, 0);
    expect(hub.online("r")).toBe(true);
  });

  it("is online only while both roles are connected", () => {
    const hub = new RoomHub();
    const leave = hub.subscribe("r", "host", listener().subscriber, 0)!;
    expect(hub.online("r")).toBe(false);
    hub.subscribe("r", "client", listener().subscriber, 0);
    expect(hub.online("r")).toBe(true);
    leave();
    expect(hub.online("r")).toBe(false);
  });

  it("forgets idle rooms and refuses new ones when full", () => {
    const hub = new RoomHub(2);
    hub.post("a", "client", "x", 0);
    hub.post("b", "client", "x", 0);
    expect(hub.post("c", "client", "x", 0)).toBe("full");
    expect(
      hub.subscribe("c", "host", listener().subscriber, 0),
    ).toBeUndefined();
    hub.sweep(QUEUE_TTL_MS * 3);
    expect(hub.size()).toBe(0);
    expect(hub.post("c", "client", "x", QUEUE_TTL_MS * 3)).toBe("queued");
  });
});
