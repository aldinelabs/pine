import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initializeWebClient } from "../webClient";

class FakeEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static instances: FakeEventSource[] = [];
  readyState = FakeEventSource.CONNECTING;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((message: MessageEvent<string>) => void) | null = null;

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  close(): void {
    this.readyState = FakeEventSource.CLOSED;
  }

  /** What a browser does when a retry gets an error response. */
  fail(): void {
    this.readyState = FakeEventSource.CLOSED;
    this.onerror?.();
  }

  emit(id: string, data: string): void {
    this.onmessage?.(new MessageEvent("message", { data, lastEventId: id }));
  }
}

function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("initializeWebClient event stream", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(new Response(JSON.stringify({ result: "1.0.0" }))),
      ),
    );
    delete (window as { pine?: unknown }).pine;
    setVisibility("visible");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete (window as { pine?: unknown }).pine;
  });

  it("reconnects after the browser gives up, resuming from the last event", async () => {
    const client = await initializeWebClient();
    client!.connect();
    const first = FakeEventSource.instances[0];
    first.emit("7", JSON.stringify({ channel: "other", value: null }));

    first.fail();
    expect(FakeEventSource.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(FakeEventSource.instances).toHaveLength(2);
    const url = new URL(FakeEventSource.instances[1].url, location.href);
    expect(url.searchParams.get("after")).toBe("7");
    client!.dispose();
  });

  it("waits until the page is visible again to reconnect", async () => {
    const client = await initializeWebClient();
    client!.connect();
    setVisibility("hidden");
    FakeEventSource.instances[0].fail();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeEventSource.instances).toHaveLength(1);

    setVisibility("visible");
    expect(FakeEventSource.instances).toHaveLength(2);
    client!.dispose();
  });

  it("leaves a stream the browser is still retrying alone", async () => {
    const client = await initializeWebClient();
    client!.connect();
    FakeEventSource.instances[0].onerror?.();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeEventSource.instances).toHaveLength(1);
    client!.dispose();
  });
});
