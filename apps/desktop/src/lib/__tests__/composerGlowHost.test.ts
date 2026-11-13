import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COMPOSER_GLOW_DISPOSE_TIMEOUT_MS,
  type ComposerGlowEvent,
  type ComposerGlowMessage,
  type ComposerGlowState,
  composerGlowSeed,
} from "@/lib/composerGlow";
import { createComposerGlowHost } from "@/lib/composerGlowHost";
import { createComposerGlowRenderer } from "@/lib/composerGlowRenderer";

vi.mock("@/lib/composerGlowRenderer", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/composerGlowRenderer")>();
  return {
    ...actual,
    createComposerGlowRenderer: vi.fn(actual.createComposerGlowRenderer),
  };
});

class FakeWorker extends EventTarget {
  static instances: FakeWorker[] = [];
  readonly url: string | URL;
  readonly options: WorkerOptions | undefined;
  posted: { message: ComposerGlowMessage; transfer: Transferable[] }[] = [];
  terminate = vi.fn();
  constructor(url: string | URL, options?: WorkerOptions) {
    super();
    this.url = url;
    this.options = options;
    FakeWorker.instances.push(this);
  }
  postMessage(message: ComposerGlowMessage, transfer: Transferable[] = []) {
    this.posted.push({ message, transfer });
  }
  reply(event: ComposerGlowEvent) {
    this.dispatchEvent(new MessageEvent("message", { data: event }));
  }
  fail() {
    this.dispatchEvent(new Event("error"));
  }
}

function state(): ComposerGlowState {
  return {
    geometry: {
      width: 780,
      height: 100,
      ratio: 1,
      box: { x: 40, y: 40, width: 700, height: 48, radius: 24 },
      margins: { top: 40, right: 40, bottom: 12, left: 40 },
    },
    colors: {
      tints: [
        [0.5, 0.5, 0],
        [0.4, 0.6, 0.2],
        [0.6, 0.4, 0],
      ],
      haze: [
        [0.8, 0.8, 0.3],
        [0.6, 0.9, 0.4],
        [0.9, 0.7, 0.3],
      ],
      dark: false,
    },
    activity: { focused: true, visible: true },
    reducedMotion: false,
    seed: composerGlowSeed(() => 0.5),
    present: true,
  };
}

function callbacks() {
  return {
    onFirstFrame: vi.fn(),
    onFallback: vi.fn(),
    onUnavailable: vi.fn(),
  };
}

function workerCanvas() {
  const canvas = document.createElement("canvas");
  const offscreen = { offscreen: true } as unknown as OffscreenCanvas;
  Object.defineProperty(canvas, "transferControlToOffscreen", {
    value: vi.fn(() => offscreen),
  });
  return { canvas, offscreen };
}

describe("createComposerGlowHost in a worker", () => {
  beforeEach(() => {
    FakeWorker.instances = [];
    vi.stubGlobal("Worker", FakeWorker);
    if (typeof OffscreenCanvas !== "function")
      vi.stubGlobal("OffscreenCanvas", class {});
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function start() {
    const { canvas, offscreen } = workerCanvas();
    const options = callbacks();
    const host = createComposerGlowHost(canvas, state(), options);
    const worker = FakeWorker.instances[0];
    return { host, worker, options, offscreen };
  }

  it("hands the canvas to one module worker", () => {
    const { host, worker, offscreen } = start();
    expect(host.mode).toBe("worker");
    expect(FakeWorker.instances).toHaveLength(1);
    expect(worker.options).toEqual({ type: "module" });
    expect(String(worker.url)).toContain("composerGlow.worker");
    const [first] = worker.posted;
    expect(first.message.type).toBe("init");
    expect(first.transfer).toEqual([offscreen]);
    expect(first.message).toMatchObject({ canvas: offscreen });
  });

  it("posts only what changed", () => {
    const { host, worker } = start();
    const base = state();
    host.update({
      geometry: {
        ...base.geometry,
        width: base.geometry.width + 0.3,
      },
      colors: base.colors,
      activity: base.activity,
      reducedMotion: false,
    });
    expect(worker.posted).toHaveLength(1);
    host.update({
      geometry: { ...base.geometry, width: 800 },
      activity: { focused: false, visible: true },
    });
    expect(worker.posted.map((post) => post.message.type)).toEqual([
      "init",
      "resize",
      "activity",
    ]);
    host.update({ reducedMotion: true });
    expect(worker.posted.at(-1)?.message).toEqual({
      type: "motion",
      reducedMotion: true,
    });
  });

  it("posts a presence change once", () => {
    const { host, worker } = start();
    host.update({ present: false });
    host.update({ present: false });
    expect(worker.posted.map((post) => post.message)).toEqual([
      expect.objectContaining({ type: "init" }),
      { type: "presence", present: false },
    ]);
    host.update({ present: true });
    expect(worker.posted.at(-1)?.message).toEqual({
      type: "presence",
      present: true,
    });
    expect(worker.posted).toHaveLength(3);
  });

  it("reports the first frame once", () => {
    const { worker, options } = start();
    worker.reply({ type: "ready", api: "webgl2" });
    worker.reply({ type: "frame" });
    worker.reply({ type: "frame" });
    expect(options.onFirstFrame).toHaveBeenCalledTimes(1);
    expect(options.onFallback).not.toHaveBeenCalled();
  });

  it("falls back when the worker cannot draw", () => {
    const { worker, options } = start();
    worker.reply({ type: "unsupported" });
    expect(options.onFallback).toHaveBeenCalledTimes(1);
    expect(worker.terminate).toHaveBeenCalled();
  });

  it("falls back when the worker fails before it is ready", () => {
    const { worker, options } = start();
    worker.fail();
    expect(options.onFallback).toHaveBeenCalledTimes(1);
    expect(worker.terminate).toHaveBeenCalled();
  });

  it("keeps going when the worker fails after it is ready", () => {
    const { worker, options } = start();
    worker.reply({ type: "ready", api: "webgl" });
    worker.fail();
    expect(options.onFallback).not.toHaveBeenCalled();
    expect(worker.terminate).not.toHaveBeenCalled();
  });

  it("terminates the worker once it confirms dispose", () => {
    const { host, worker } = start();
    host.dispose();
    expect(worker.posted.at(-1)?.message).toEqual({ type: "dispose" });
    expect(worker.terminate).not.toHaveBeenCalled();
    worker.reply({ type: "disposed" });
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("terminates the worker if it never confirms", () => {
    const { host, worker, options } = start();
    host.dispose();
    vi.advanceTimersByTime(COMPOSER_GLOW_DISPOSE_TIMEOUT_MS - 1);
    expect(worker.terminate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    const posted = worker.posted.length;
    host.update({ reducedMotion: true });
    host.dispose();
    expect(worker.posted).toHaveLength(posted);
    worker.reply({ type: "frame" });
    expect(options.onFirstFrame).not.toHaveBeenCalled();
  });
});

describe("createComposerGlowHost on the page", () => {
  it("draws on the main thread when there is no Worker", () => {
    expect(typeof Worker).toBe("undefined");
    const canvas = document.createElement("canvas");
    const options = callbacks();
    const host = createComposerGlowHost(canvas, state(), options);
    expect(host.mode).toBe("main");
    // happy-dom has no WebGL.
    expect(options.onUnavailable).toHaveBeenCalledTimes(1);
    expect(() => {
      host.update({ reducedMotion: true });
      host.dispose();
    }).not.toThrow();
  });

  it("hands a presence change to the page renderer once", () => {
    const handle = vi.fn();
    vi.mocked(createComposerGlowRenderer).mockImplementationOnce(() => ({
      handle,
    }));
    const canvas = document.createElement("canvas");
    const host = createComposerGlowHost(canvas, state(), callbacks());
    expect(host.mode).toBe("main");
    host.update({ present: false });
    host.update({ present: false });
    expect(handle.mock.calls).toEqual([[{ type: "presence", present: false }]]);
    host.dispose();
  });

  it("draws on the main thread when asked to", () => {
    vi.stubGlobal("Worker", FakeWorker);
    FakeWorker.instances = [];
    const { canvas } = workerCanvas();
    const host = createComposerGlowHost(canvas, state(), {
      ...callbacks(),
      forceMain: true,
    });
    expect(host.mode).toBe("main");
    expect(FakeWorker.instances).toHaveLength(0);
    host.dispose();
    vi.unstubAllGlobals();
  });
});
