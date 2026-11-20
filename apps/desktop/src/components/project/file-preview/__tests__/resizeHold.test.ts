import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createResizeHold,
  holdViewerDuringResize,
  RESIZE_SETTLE_MS,
  type HeldLayout,
} from "../resizeHold";

describe("createResizeHold", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function setup(width = 400, height = 600) {
    const apply = vi.fn<(layout: HeldLayout | null) => void>();
    const hold = createResizeHold({ width, height }, { apply });
    return { apply, hold };
  }

  it("ignores reports of the size it settled at", () => {
    const { apply, hold } = setup();
    hold.resize({ width: 400.2, height: 600.3 });
    vi.advanceTimersByTime(RESIZE_SETTLE_MS * 2);
    expect(apply).not.toHaveBeenCalled();
  });

  it("scales the settled width while the width changes", () => {
    const { apply, hold } = setup();
    hold.resize({ width: 600, height: 600 });
    // 600px tall at 1.5x needs 400px, which the settled 600px covers.
    expect(apply).toHaveBeenLastCalledWith({
      width: 400,
      height: 600,
      scale: 1.5,
    });
    hold.resize({ width: 200, height: 500 });
    // 500px at 0.5x needs 1000px; it grows with headroom.
    expect(apply).toHaveBeenLastCalledWith({
      width: 400,
      height: 1500,
      scale: 0.5,
    });
  });

  it("holds height-only changes, growing the height in steps", () => {
    const { apply, hold } = setup();
    hold.resize({ width: 400, height: 300 });
    expect(apply).toHaveBeenLastCalledWith({
      width: 400,
      height: 600,
      scale: 1,
    });
    hold.resize({ width: 400, height: 700 });
    expect(apply).toHaveBeenLastCalledWith({
      width: 400,
      height: 1050,
      scale: 1,
    });
    // Within the headroom the held height stays put.
    hold.resize({ width: 400, height: 1000 });
    expect(apply).toHaveBeenLastCalledWith({
      width: 400,
      height: 1050,
      scale: 1,
    });
  });

  it("releases once, after the size stops changing", () => {
    const { apply, hold } = setup();
    for (let width = 410; width <= 500; width += 10) {
      hold.resize({ width, height: 600 });
      vi.advanceTimersByTime(RESIZE_SETTLE_MS - 1);
    }
    expect(apply).not.toHaveBeenCalledWith(null);
    vi.advanceTimersByTime(1);
    expect(apply).toHaveBeenCalledTimes(11);
    expect(apply).toHaveBeenLastCalledWith(null);
  });

  it("scales from the newly settled size on the next resize", () => {
    const { apply, hold } = setup();
    hold.resize({ width: 800, height: 500 });
    vi.advanceTimersByTime(RESIZE_SETTLE_MS);
    hold.resize({ width: 400, height: 200 });
    expect(apply).toHaveBeenLastCalledWith({
      width: 800,
      height: 500,
      scale: 0.5,
    });
  });

  it("does not hold a hidden frame or scale from a zero size", () => {
    const { apply, hold } = setup(0, 0);
    hold.resize({ width: 500, height: 600 });
    expect(apply).not.toHaveBeenCalled();
    hold.resize({ width: 600, height: 600 });
    expect(apply).toHaveBeenLastCalledWith({
      width: 500,
      height: 600,
      scale: 1.2,
    });
    hold.resize({ width: 0, height: 0 });
    expect(apply).toHaveBeenLastCalledWith(null);
  });

  it("releases at once on request and forgets the pending timer", () => {
    const { apply, hold } = setup();
    hold.resize({ width: 500, height: 600 });
    hold.release();
    expect(apply).toHaveBeenLastCalledWith(null);
    vi.advanceTimersByTime(RESIZE_SETTLE_MS);
    expect(apply).toHaveBeenCalledTimes(2);
  });
});

describe("holdViewerDuringResize", () => {
  let callback: ResizeObserverCallback | undefined;
  const disconnect = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(cb: ResizeObserverCallback) {
          callback = cb;
        }
        observe(): void {}
        disconnect = disconnect;
      },
    );
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    callback = undefined;
  });

  function report(width: number, height: number): void {
    callback?.(
      [{ contentRect: { width, height } } as ResizeObserverEntry],
      {} as ResizeObserver,
    );
  }

  it("pins and scales the viewer, then hands it back the frame", () => {
    const frame = document.createElement("div");
    Object.defineProperty(frame, "clientWidth", { value: 400 });
    Object.defineProperty(frame, "clientHeight", { value: 600 });
    const viewer = document.createElement("div");
    const stop = holdViewerDuringResize(frame, viewer);

    report(500, 600);
    expect(viewer.style.width).toBe("400px");
    expect(viewer.style.height).toBe("600px");
    expect(viewer.style.transform).toBe("scale(1.25)");

    vi.advanceTimersByTime(RESIZE_SETTLE_MS);
    expect(viewer.getAttribute("style") ?? "").toBe("");

    report(300, 600);
    stop();
    expect(disconnect).toHaveBeenCalled();
    expect(viewer.style.transform).toBe("");
  });
});
