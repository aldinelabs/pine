import { afterEach, describe, expect, it, vi } from "vitest";
import type { PineSessionEvent, SessionEventListener } from "@/shared/agent";
import { onSessionEvent } from "../sessionEvents";

function installBridge() {
  const bridgeListeners: SessionEventListener[] = [];
  const unsubscribe = vi.fn();
  const subscribe = vi.fn((listener: SessionEventListener) => {
    bridgeListeners.push(listener);
    return () => {
      unsubscribe();
      bridgeListeners.splice(bridgeListeners.indexOf(listener), 1);
    };
  });
  Object.defineProperty(window, "pine", {
    configurable: true,
    value: { onSessionEvent: subscribe },
  });
  return {
    subscribe,
    unsubscribe,
    emit(event: PineSessionEvent): void {
      for (const listener of [...bridgeListeners]) listener(event);
    },
  };
}

const event = (sessionId: string) =>
  ({ type: "run-state", sessionId, state: "running" }) as PineSessionEvent;

const stops: (() => void)[] = [];
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
});

function listen(listener: SessionEventListener): () => void {
  const stop = onSessionEvent(listener);
  stops.push(stop);
  return stop;
}

describe("onSessionEvent", () => {
  it("subscribes to the bridge once and fans out in subscription order", () => {
    const bridge = installBridge();
    const calls: string[] = [];
    listen((e) => calls.push(`a:${e.sessionId}`));
    listen((e) => calls.push(`b:${e.sessionId}`));
    listen((e) => calls.push(`c:${e.sessionId}`));
    expect(bridge.subscribe).toHaveBeenCalledTimes(1);
    bridge.emit(event("s1"));
    bridge.emit(event("s2"));
    expect(calls).toEqual(["a:s1", "b:s1", "c:s1", "a:s2", "b:s2", "c:s2"]);
  });

  it("keeps delivering when a listener throws", () => {
    const bridge = installBridge();
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const after = vi.fn();
    listen(() => {
      throw new Error("boom");
    });
    listen(after);
    bridge.emit(event("s1"));
    expect(after).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalled();
  });

  it("drops the bridge subscription when the last listener leaves", () => {
    const bridge = installBridge();
    const first = vi.fn();
    const second = vi.fn();
    const stopFirst = listen(first);
    const stopSecond = listen(second);
    stopFirst();
    stopFirst();
    expect(bridge.unsubscribe).not.toHaveBeenCalled();
    bridge.emit(event("s1"));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    stopSecond();
    expect(bridge.unsubscribe).toHaveBeenCalledTimes(1);

    listen(first);
    expect(bridge.subscribe).toHaveBeenCalledTimes(2);
  });

  it("binds each listener to the bridge it subscribed through", () => {
    const old = installBridge();
    const stale = vi.fn();
    listen(stale);
    const current = installBridge();
    const fresh = vi.fn();
    listen(fresh);
    expect(current.subscribe).toHaveBeenCalledTimes(1);
    current.emit(event("s1"));
    expect(fresh).toHaveBeenCalledTimes(1);
    expect(stale).not.toHaveBeenCalled();
    old.emit(event("s2"));
    expect(stale).toHaveBeenCalledTimes(1);
    expect(fresh).toHaveBeenCalledTimes(1);
  });

  it("does nothing without a bridge", () => {
    Object.defineProperty(window, "pine", { configurable: true, value: {} });
    const stop = onSessionEvent(vi.fn());
    expect(() => stop()).not.toThrow();
  });

  it("applies subscription changes during delivery to the next event", () => {
    const bridge = installBridge();
    const late = vi.fn();
    let stopSelf: () => void = () => undefined;
    const self = vi.fn(() => {
      stopSelf();
      listen(late);
    });
    stopSelf = listen(self);
    const other = vi.fn();
    listen(other);
    bridge.emit(event("s1"));
    expect(other).toHaveBeenCalledTimes(1);
    expect(late).not.toHaveBeenCalled();
    bridge.emit(event("s2"));
    expect(self).toHaveBeenCalledTimes(1);
    expect(late).toHaveBeenCalledTimes(1);
  });
});
