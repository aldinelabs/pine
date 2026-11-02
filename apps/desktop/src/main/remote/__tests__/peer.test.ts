import type { DataChannel } from "node-datachannel";
import { describe, expect, it, vi } from "vitest";
import { wrapChannel } from "../peer";

function fakeChannel(open: boolean, buffered: number) {
  let low: () => void = () => undefined;
  const channel = {
    getLabel: () => "pine-rc",
    isOpen: () => open,
    // libdatachannel answers false when it buffers the message instead.
    sendMessageBinary: vi.fn(() => false),
    bufferedAmount: () => buffered,
    setBufferedAmountLowThreshold: vi.fn(),
    onBufferedAmountLow: (handler: () => void) => {
      low = handler;
    },
    onClosed: vi.fn(),
    onOpen: vi.fn(),
    onMessage: vi.fn(),
    close: vi.fn(),
  };
  return {
    channel,
    handle: wrapChannel(channel as unknown as DataChannel),
    drain: () => low(),
  };
}

describe("data channel", () => {
  it("keeps sending when a message is buffered rather than sent at once", () => {
    const { channel, handle } = fakeChannel(true, 0);
    expect(() => handle.send(new Uint8Array(16))).not.toThrow();
    expect(channel.sendMessageBinary).toHaveBeenCalled();
  });

  it("refuses to send once the channel is closed", () => {
    const { handle } = fakeChannel(false, 0);
    expect(() => handle.send(new Uint8Array(16))).toThrow(/closed/);
  });

  it("waits for a full buffer to drain", async () => {
    const { handle, drain } = fakeChannel(true, 1024 * 1024);
    let drained = false;
    void handle.drained().then(() => {
      drained = true;
    });
    await Promise.resolve();
    expect(drained).toBe(false);
    drain();
    await Promise.resolve();
    expect(drained).toBe(true);
  });
});
