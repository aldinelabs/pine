import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LibraryChangeThrottle } from "../libraryChangeThrottle";

describe("LibraryChangeThrottle", () => {
  let sent: number[];
  let throttle: LibraryChangeThrottle<number>;

  beforeEach(() => {
    vi.useFakeTimers();
    sent = [];
    throttle = new LibraryChangeThrottle<number>((key) => sent.push(key), 500);
  });

  afterEach(() => {
    throttle.dispose();
    vi.useRealTimers();
  });

  it("collapses calls within the window into one trailing call", () => {
    throttle.notify(1);
    throttle.notify(1);
    throttle.notify(1);
    vi.advanceTimersByTime(499);
    expect(sent).toEqual([1]);
    vi.advanceTimersByTime(1);
    expect(sent).toEqual([1, 1]);
  });

  it("sends nothing at the end of a quiet window and leads again after it", () => {
    throttle.notify(1);
    vi.advanceTimersByTime(500);
    expect(sent).toEqual([1]);
    throttle.notify(1);
    expect(sent).toEqual([1, 1]);
  });

  it("keeps a steady stream to one call per window", () => {
    for (let elapsed = 0; elapsed < 2000; elapsed += 50) {
      throttle.notify(1);
      vi.advanceTimersByTime(50);
    }
    // Leading call at 0, trailing calls at 500, 1000, 1500 and 2000.
    expect(sent).toEqual([1, 1, 1, 1, 1]);
  });

  it("throttles each key on its own", () => {
    throttle.notify(1);
    throttle.notify(2);
    throttle.notify(1);
    expect(sent).toEqual([1, 2]);
    vi.advanceTimersByTime(500);
    expect(sent).toEqual([1, 2, 1]);
  });

  it("flush sends a pending call now and closes the window", () => {
    throttle.notify(1);
    throttle.notify(1);
    expect(throttle.flush(1)).toBe(true);
    expect(sent).toEqual([1, 1]);
    vi.advanceTimersByTime(1000);
    expect(sent).toEqual([1, 1]);
    throttle.notify(1);
    expect(sent).toEqual([1, 1, 1]);
  });

  it("flush reports when nothing was pending", () => {
    expect(throttle.flush(1)).toBe(false);
    throttle.notify(1);
    expect(throttle.flush(1)).toBe(false);
    expect(sent).toEqual([1]);
    throttle.notify(1);
    expect(sent).toEqual([1, 1]);
  });

  it("dispose cancels pending calls", () => {
    throttle.notify(1);
    throttle.notify(1);
    throttle.dispose();
    vi.advanceTimersByTime(1000);
    expect(sent).toEqual([1]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
