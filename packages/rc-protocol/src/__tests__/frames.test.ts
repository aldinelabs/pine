import { describe, expect, it } from "vitest";
import {
  FrameError,
  MAX_DATA_BYTES,
  MAX_FRAME_BYTES,
  type Frame,
  dataFrames,
  decodeFrame,
  encodeFrame,
} from "../frames";

function roundTrip(frame: Frame): Frame {
  return decodeFrame(encodeFrame(frame));
}

describe("frames", () => {
  it("round-trips requests, responses and control frames", () => {
    const request: Frame = {
      type: "request",
      stream: 1,
      head: {
        method: "POST",
        path: "/api/rpc",
        headers: [["content-type", "application/json"]],
      },
    };
    const response: Frame = {
      type: "response",
      stream: 1,
      head: { status: 200, headers: [["content-type", "text/event-stream"]] },
    };
    expect(roundTrip(request)).toEqual(request);
    expect(roundTrip(response)).toEqual(response);
    for (const type of ["end", "cancel", "ping", "pong"] as const)
      expect(roundTrip({ type, stream: 7 })).toEqual({ type, stream: 7 });
  });

  it("splits a large body into frames that fit one message", () => {
    const body = crypto.getRandomValues(
      new Uint8Array(MAX_DATA_BYTES * 3 + 10),
    );
    const frames = [...dataFrames(3, body)];
    expect(frames).toHaveLength(4);
    for (const frame of frames)
      expect(frame.length).toBeLessThanOrEqual(MAX_FRAME_BYTES);
    const received = frames.map((bytes) => decodeFrame(bytes));
    const joined = new Uint8Array(body.length);
    let offset = 0;
    for (const frame of received) {
      expect(frame.type).toBe("data");
      if (frame.type === "data") {
        joined.set(frame.data, offset);
        offset += frame.data.length;
      }
    }
    expect(Array.from(joined)).toEqual(Array.from(body));
  });

  it("refuses a frame that is too large to send", () => {
    expect(() =>
      encodeFrame({
        type: "data",
        stream: 1,
        data: new Uint8Array(MAX_DATA_BYTES + 1),
      }),
    ).toThrow(FrameError);
  });

  it("rejects malformed input from the other side", () => {
    expect(() => decodeFrame(new Uint8Array(2))).toThrow(FrameError);
    expect(() => decodeFrame(new Uint8Array([99, 0, 0, 0, 1]))).toThrow(
      FrameError,
    );
    expect(() => decodeFrame(new Uint8Array([4, 0, 0, 0, 1, 9]))).toThrow(
      FrameError,
    );
    expect(() => decodeFrame(new Uint8Array(MAX_FRAME_BYTES + 1))).toThrow(
      FrameError,
    );
  });

  it("rejects request heads that could smuggle or redirect", () => {
    const bad = (head: unknown) =>
      decodeFrame(
        encodeFrame({ type: "request", stream: 1, head: head as never }),
      );
    const ok = { method: "GET", path: "/api/session", headers: [] };
    expect(() => bad({ ...ok, method: "CONNECT" })).toThrow(FrameError);
    expect(() => bad({ ...ok, path: "//evil.example/x" })).toThrow(FrameError);
    expect(() => bad({ ...ok, path: "http://evil.example/" })).toThrow(
      FrameError,
    );
    expect(() => bad({ ...ok, path: "/a\r\nHost: x" })).toThrow(FrameError);
    expect(() => bad({ ...ok, headers: [["bad name", "v"]] })).toThrow(
      FrameError,
    );
    expect(() => bad({ ...ok, headers: [["x", "a\r\nb"]] })).toThrow(
      FrameError,
    );
    expect(() =>
      decodeFrame(
        encodeFrame({
          type: "response",
          stream: 1,
          head: { status: 99, headers: [] },
        }),
      ),
    ).toThrow(FrameError);
  });
});
