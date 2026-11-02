import {
  MAX_DATA_BYTES,
  decodeFrame,
  encodeFrame,
  type Frame,
} from "@pine/rc-protocol";
import { describe, expect, it, vi } from "vitest";
import { TunnelClient, TunnelClosedError } from "../tunnelClient";

function setup() {
  const sent: Frame[] = [];
  const onControl = vi.fn();
  const client = new TunnelClient(
    {
      send: (bytes) => sent.push(decodeFrame(bytes)),
      drained: () => Promise.resolve(),
    },
    onControl,
  );
  const reply = (frame: Frame) => client.receive(encodeFrame(frame));
  return { client, sent, reply, onControl };
}

async function text(stream: ReadableStream<Uint8Array>) {
  return new Response(stream).text();
}

describe("tunnel client", () => {
  it("sends a request on an odd stream and reads the streamed response", async () => {
    const { client, sent, reply } = setup();
    const pending = client.request({
      method: "GET",
      path: "/api/session",
      headers: [["accept", "application/json"]],
    });
    await Promise.resolve();
    expect(sent).toEqual([
      {
        type: "request",
        stream: 1,
        head: {
          method: "GET",
          path: "/api/session",
          headers: [["accept", "application/json"]],
        },
      },
      { type: "end", stream: 1 },
    ]);
    reply({
      type: "response",
      stream: 1,
      head: { status: 200, headers: [["content-type", "text/plain"]] },
    });
    const response = await pending;
    expect(response.status).toBe(200);
    const body = text(response.body);
    const bytes = new TextEncoder().encode("hello");
    reply({ type: "data", stream: 1, data: bytes.subarray(0, 2) });
    reply({ type: "data", stream: 1, data: bytes.subarray(2) });
    reply({ type: "end", stream: 1 });
    expect(await body).toBe("hello");

    void client.request({ method: "GET", path: "/b", headers: [] });
    expect(sent.at(-2)).toMatchObject({ type: "request", stream: 3 });
  });

  it("splits a large body into frames that fit a message", async () => {
    const { client, sent } = setup();
    const body = new Uint8Array(MAX_DATA_BYTES * 2 + 1).fill(7);
    void client.request({
      method: "POST",
      path: "/api/upload",
      headers: [],
      body,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const data = sent.filter((frame) => frame.type === "data");
    expect(data).toHaveLength(3);
    expect(
      data.reduce(
        (sum, frame) => sum + (frame.type === "data" ? frame.data.length : 0),
        0,
      ),
    ).toBe(body.length);
    expect(sent.at(-1)).toEqual({ type: "end", stream: 1 });
  });

  it("cancels the stream when the reader goes away or the caller aborts", async () => {
    const { client, sent, reply } = setup();
    const events = client.request({
      method: "GET",
      path: "/api/events",
      headers: [],
    });
    reply({ type: "response", stream: 1, head: { status: 200, headers: [] } });
    await (await events).body.cancel();
    expect(sent.at(-1)).toEqual({ type: "cancel", stream: 1 });

    const abort = new AbortController();
    const aborted = client.request(
      { method: "GET", path: "/slow", headers: [] },
      abort.signal,
    );
    abort.abort();
    await expect(aborted).rejects.toThrow(/Aborted/);
    expect(sent.at(-1)).toEqual({ type: "cancel", stream: 3 });
  });

  it("fails what is open when the computer cuts a stream or the channel closes", async () => {
    const { client, reply } = setup();
    const cut = client.request({ method: "GET", path: "/a", headers: [] });
    reply({ type: "cancel", stream: 1 });
    await expect(cut).rejects.toThrow(/cut the response short/);

    const midway = client.request({ method: "GET", path: "/b", headers: [] });
    reply({ type: "response", stream: 3, head: { status: 200, headers: [] } });
    const body = text((await midway).body);
    client.close();
    await expect(body).rejects.toBeInstanceOf(TunnelClosedError);
    await expect(
      client.request({ method: "GET", path: "/c", headers: [] }),
    ).rejects.toBeInstanceOf(TunnelClosedError);
  });

  it("passes control messages on and ignores frames for unknown streams", () => {
    const { client, reply, onControl } = setup();
    reply({
      type: "control",
      stream: 0,
      message: { type: "paired", roomSecret: "x" },
    });
    expect(onControl).toHaveBeenCalledWith({ type: "paired", roomSecret: "x" });
    expect(() => reply({ type: "end", stream: 99 })).not.toThrow();
    expect(() => client.receive(new Uint8Array([1, 2]))).not.toThrow();
  });
});
