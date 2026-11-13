import { describe, expect, it, vi } from "vitest";
import {
  type ComposerGlowEvent,
  type ComposerGlowState,
  composerGlowSeed,
} from "@/lib/composerGlow";
import {
  createComposerGlowRenderer,
  type FrameScheduler,
} from "@/lib/composerGlowRenderer";

function fakeGl() {
  const loseContext = vi.fn();
  let handle = 0;
  const next = () => ({ id: (handle += 1) });
  const gl = {
    VERTEX_SHADER: 1,
    FRAGMENT_SHADER: 2,
    COMPILE_STATUS: 3,
    LINK_STATUS: 4,
    ARRAY_BUFFER: 5,
    STATIC_DRAW: 6,
    FLOAT: 7,
    BLEND: 8,
    TRIANGLES: 9,
    createShader: vi.fn(next),
    shaderSource: vi.fn(),
    compileShader: vi.fn(),
    getShaderParameter: vi.fn(() => true),
    deleteShader: vi.fn(),
    createProgram: vi.fn(next),
    attachShader: vi.fn(),
    bindAttribLocation: vi.fn(),
    linkProgram: vi.fn(),
    getProgramParameter: vi.fn(() => true),
    deleteProgram: vi.fn(),
    useProgram: vi.fn(),
    createBuffer: vi.fn(next),
    bindBuffer: vi.fn(),
    bufferData: vi.fn(),
    deleteBuffer: vi.fn(),
    enableVertexAttribArray: vi.fn(),
    vertexAttribPointer: vi.fn(),
    disable: vi.fn(),
    getUniformLocation: vi.fn(next),
    uniform1f: vi.fn(),
    uniform2f: vi.fn(),
    uniform3f: vi.fn(),
    uniform4f: vi.fn(),
    viewport: vi.fn(),
    drawArrays: vi.fn(),
    bindFramebuffer: vi.fn(),
    createTexture: vi.fn(),
    getExtension: vi.fn((name: string) =>
      name === "WEBGL_lose_context" ? { loseContext } : null,
    ),
  };
  return { gl, loseContext };
}

type FakeGl = ReturnType<typeof fakeGl>["gl"];

class FakeCanvas extends EventTarget {
  width = 300;
  height = 150;
  widthWrites = 0;
  constructor(private readonly contexts: Record<string, FakeGl | null>) {
    super();
    let width = 300;
    Object.defineProperty(this, "width", {
      get: () => width,
      set: (value: number) => {
        width = value;
        this.widthWrites += 1;
      },
    });
  }
  getContext = vi.fn((id: string) => this.contexts[id] ?? null);
}

function fakeScheduler() {
  let clock = 0;
  let nextId = 0;
  const pending = new Map<number, (now: number) => void>();
  const scheduler: FrameScheduler = {
    request: vi.fn((callback: (now: number) => void) => {
      nextId += 1;
      pending.set(nextId, callback);
      return nextId;
    }),
    cancel: vi.fn((id: number) => {
      pending.delete(id);
    }),
    now: () => clock,
  };
  /** Runs the pending callbacks at time `at`. */
  const run = (at: number) => {
    clock = at;
    const callbacks = [...pending.values()];
    pending.clear();
    for (const callback of callbacks) callback(at);
  };
  return { scheduler, run, pending };
}

function state(overrides: Partial<ComposerGlowState> = {}): ComposerGlowState {
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
      dark: false,
    },
    activity: { focused: true, visible: true },
    reducedMotion: false,
    seed: composerGlowSeed(() => 0.5),
    ...overrides,
  };
}

function setup(
  options: {
    contexts?: "webgl2" | "webgl" | "none";
    state?: Partial<ComposerGlowState>;
    host?: "worker" | "main";
  } = {},
) {
  const { gl, loseContext } = fakeGl();
  const kind = options.contexts ?? "webgl2";
  const canvas = new FakeCanvas(
    kind === "none" ? {} : kind === "webgl2" ? { webgl2: gl } : { webgl: gl },
  );
  const frames = fakeScheduler();
  const events: ComposerGlowEvent[] = [];
  const renderer = createComposerGlowRenderer(
    canvas as unknown as HTMLCanvasElement,
    state(options.state),
    {
      scheduler: frames.scheduler,
      host: options.host ?? "worker",
      emit: (event) => events.push(event),
    },
  );
  return { gl, loseContext, canvas, frames, events, renderer };
}

describe("createComposerGlowRenderer", () => {
  it("prefers WebGL2", () => {
    const { events, renderer, canvas } = setup();
    expect(renderer).not.toBeNull();
    expect(canvas.getContext).toHaveBeenCalledTimes(1);
    expect(canvas.getContext.mock.calls[0][0]).toBe("webgl2");
    expect(events).toEqual([{ type: "ready", api: "webgl2" }]);
  });

  it("falls back to WebGL", () => {
    const { events } = setup({ contexts: "webgl" });
    expect(events).toEqual([{ type: "ready", api: "webgl" }]);
  });

  it("reports when there is no WebGL", () => {
    const { events, renderer } = setup({ contexts: "none" });
    expect(renderer).toBeNull();
    expect(events).toEqual([{ type: "unsupported" }]);
  });

  it("draws one triangle per frame with one program and buffer", () => {
    const { gl, frames } = setup();
    frames.run(0);
    frames.run(17);
    expect(gl.createProgram).toHaveBeenCalledTimes(1);
    expect(gl.createBuffer).toHaveBeenCalledTimes(1);
    expect(gl.drawArrays).toHaveBeenCalledTimes(2);
    expect(gl.drawArrays).toHaveBeenCalledWith(gl.TRIANGLES, 0, 3);
    expect(gl.bindFramebuffer).not.toHaveBeenCalled();
    expect(gl.createTexture).not.toHaveBeenCalled();
  });

  it("caps the frame rate and stops while hidden", () => {
    const { gl, frames, renderer } = setup();
    const drawsAt: number[] = [];
    gl.drawArrays.mockImplementation(() =>
      drawsAt.push(frames.scheduler.now()),
    );
    for (const at of [0, 8, 16.7, 25, 33.4]) frames.run(at);
    expect(drawsAt).toEqual([0, 16.7, 33.4]);

    renderer?.handle({
      type: "activity",
      activity: { focused: false, visible: true },
    });
    drawsAt.length = 0;
    for (let at = 41.7; at < 110; at += 8.33) frames.run(at);
    expect(drawsAt.length).toBe(2);
    expect(drawsAt[1] - drawsAt[0]).toBeGreaterThan(30);

    renderer?.handle({
      type: "activity",
      activity: { focused: false, visible: false },
    });
    expect(frames.scheduler.cancel).toHaveBeenCalled();
    expect(frames.pending.size).toBe(0);
    drawsAt.length = 0;
    frames.run(200);
    expect(drawsAt).toEqual([]);

    renderer?.handle({
      type: "activity",
      activity: { focused: true, visible: true },
    });
    frames.run(300);
    expect(drawsAt).toEqual([300]);
  });

  it("reports the first frame once, after it is drawn", () => {
    const { frames, events } = setup();
    frames.run(0);
    expect(events.filter((event) => event.type === "frame")).toHaveLength(0);
    frames.run(17);
    frames.run(34);
    expect(events.filter((event) => event.type === "frame")).toHaveLength(1);
  });

  it("applies a new size at the next draw, once", () => {
    const { gl, frames, renderer, canvas } = setup();
    frames.run(0);
    expect(canvas.width).toBe(780);
    expect(canvas.height).toBe(100);
    const writes = canvas.widthWrites;
    gl.viewport.mockClear();
    const geometry = state().geometry;
    renderer?.handle({
      type: "resize",
      geometry: { ...geometry, width: 900, ratio: 0.75 },
    });
    renderer?.handle({
      type: "resize",
      geometry: { ...geometry, width: 1000, height: 120, ratio: 0.75 },
    });
    expect(canvas.width).toBe(780);
    expect(gl.viewport).not.toHaveBeenCalled();
    frames.run(17);
    expect(canvas.width).toBe(750);
    expect(canvas.height).toBe(90);
    expect(canvas.widthWrites - writes).toBe(1);
    expect(gl.viewport).toHaveBeenCalledTimes(1);
    expect(gl.viewport).toHaveBeenCalledWith(0, 0, 750, 90);
  });

  it("draws one still frame with reduced motion", () => {
    const { gl, frames, renderer, events } = setup({
      state: { reducedMotion: true },
    });
    frames.run(0);
    frames.run(17);
    expect(gl.drawArrays).toHaveBeenCalledTimes(1);
    expect(events.filter((event) => event.type === "frame")).toHaveLength(1);
    expect(frames.pending.size).toBe(0);

    renderer?.handle({ type: "resize", geometry: state().geometry });
    frames.run(30);
    expect(gl.drawArrays).toHaveBeenCalledTimes(2);
    expect(frames.pending.size).toBe(0);
    renderer?.handle({ type: "colors", colors: state().colors });
    frames.run(40);
    expect(gl.drawArrays).toHaveBeenCalledTimes(3);
    expect(frames.pending.size).toBe(0);

    renderer?.handle({ type: "motion", reducedMotion: false });
    frames.run(60);
    frames.run(80);
    expect(gl.drawArrays).toHaveBeenCalledTimes(5);
    expect(frames.pending.size).toBe(1);
  });

  it("recovers from a lost context", () => {
    const { gl, frames, canvas } = setup();
    frames.run(0);
    const lost = new Event("webglcontextlost", { cancelable: true });
    canvas.dispatchEvent(lost);
    expect(lost.defaultPrevented).toBe(true);
    expect(frames.scheduler.cancel).toHaveBeenCalled();
    expect(frames.pending.size).toBe(0);
    frames.run(17);
    expect(gl.drawArrays).toHaveBeenCalledTimes(1);

    canvas.dispatchEvent(new Event("webglcontextrestored"));
    expect(gl.createProgram).toHaveBeenCalledTimes(2);
    frames.run(40);
    expect(gl.drawArrays).toHaveBeenCalledTimes(2);
  });

  it("releases the context on dispose and draws nothing after", () => {
    const { gl, frames, renderer, canvas, loseContext } = setup();
    frames.run(0);
    renderer?.handle({ type: "dispose" });
    expect(frames.scheduler.cancel).toHaveBeenCalled();
    expect(loseContext).toHaveBeenCalledTimes(1);
    expect(gl.deleteProgram).toHaveBeenCalled();
    expect(gl.deleteBuffer).toHaveBeenCalled();

    canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    canvas.dispatchEvent(new Event("webglcontextrestored"));
    renderer?.handle({ type: "colors", colors: state().colors });
    frames.run(17);
    expect(gl.drawArrays).toHaveBeenCalledTimes(1);
    expect(gl.createProgram).toHaveBeenCalledTimes(1);
  });
});
