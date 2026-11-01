// @vitest-environment node
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { connectParentPort } from "../parentPort";

describe("connectParentPort", () => {
  it("uses Electron's parent port and unwraps its message events", () => {
    const parentPort = Object.assign(new EventEmitter(), {
      postMessage: vi.fn(),
    });
    const port = connectParentPort({
      parentPort,
    } as unknown as NodeJS.Process);
    const listener = vi.fn();
    port.onMessage(listener);

    parentPort.emit("message", { data: { type: "ping" } });
    port.postMessage({ type: "ready" });

    expect(listener).toHaveBeenCalledWith({ type: "ping" });
    expect(parentPort.postMessage).toHaveBeenCalledWith({ type: "ready" });
  });

  it("uses Node's IPC channel when forked, and exits with its parent", () => {
    const host = Object.assign(new EventEmitter(), {
      send: vi.fn(),
      exit: vi.fn(),
    });
    const port = connectParentPort(host as unknown as NodeJS.Process);
    const listener = vi.fn();
    port.onMessage(listener);

    host.emit("message", { type: "ping" });
    port.postMessage({ type: "ready" });
    host.emit("disconnect");

    expect(listener).toHaveBeenCalledWith({ type: "ping" });
    expect(host.send).toHaveBeenCalledWith({ type: "ready" });
    expect(host.exit).toHaveBeenCalledWith(0);
  });

  it("refuses to run without a parent", () => {
    expect(() =>
      connectParentPort(new EventEmitter() as unknown as NodeJS.Process),
    ).toThrow("child process of Pine");
  });
});
