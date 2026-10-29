import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkbenchStateRequests } from "../workbenchStateRequests";

const state = {
  open: true,
  visible: false,
  top: "files",
  bottom: "preview",
  split: 65,
};

afterEach(() => vi.useRealTimers());

describe("WorkbenchStateRequests", () => {
  it("accepts only the owning window's validated response, once", async () => {
    const requests = new WorkbenchStateRequests();
    const send = vi.fn();
    const pending = requests.request(7, "session-a", send);
    const event = send.mock.calls[0][0] as { requestId: string };
    const response = { requestId: event.requestId, state };
    expect(send).toHaveBeenCalledWith({
      type: "workbench-state-request",
      sessionId: "session-a",
      requestId: expect.any(String),
    });
    expect(requests.respond(8, response)).toBe(false);
    expect(
      requests.respond(7, { ...response, state: { ...state, split: 999 } }),
    ).toBe(false);
    expect(
      requests.respond(7, { ...response, state: { ...state, top: "unknown" } }),
    ).toBe(false);
    expect(requests.respond(7, response)).toBe(true);
    await expect(pending).resolves.toEqual(state);
    expect(requests.respond(7, response)).toBe(false);
  });

  it("keeps concurrent reads separate even when replies arrive out of order", async () => {
    const requests = new WorkbenchStateRequests();
    const send = vi.fn();
    const first = requests.request(1, "a", send);
    const second = requests.request(1, "b", send);
    const [a, b] = send.mock.calls.map(
      ([event]) => event as { requestId: string },
    );
    requests.respond(1, { requestId: b.requestId, state });
    requests.respond(1, {
      requestId: a.requestId,
      state: { ...state, split: 30 },
    });
    await expect(first).resolves.toMatchObject({ split: 30 });
    await expect(second).resolves.toMatchObject({ split: 65 });
  });

  it("times out missing windows and ignores late replies", async () => {
    vi.useFakeTimers();
    const requests = new WorkbenchStateRequests();
    const send = vi.fn();
    const pending = requests.request(1, "a", send);
    const failed = expect(pending).rejects.toThrow("did not respond");
    await vi.advanceTimersByTimeAsync(5_000);
    await failed;
    const event = send.mock.calls[0][0] as { requestId: string };
    expect(requests.respond(1, { requestId: event.requestId, state })).toBe(
      false,
    );
  });

  it("fails immediately and releases the timer when sending fails", async () => {
    vi.useFakeTimers();
    const requests = new WorkbenchStateRequests();
    await expect(
      requests.request(1, "a", () => {
        throw new Error("window closed");
      }),
    ).rejects.toThrow("window closed");
    expect(vi.getTimerCount()).toBe(0);
  });
});
