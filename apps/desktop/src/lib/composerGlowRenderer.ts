import {
  COMPOSER_GLOW_MAX_BUFFER_PX,
  type ComposerGlowEvent,
  type ComposerGlowMessage,
  type ComposerGlowState,
  composerGlowFrameInterval,
} from "@/lib/composerGlow";
import {
  COMPOSER_GLOW_FRAGMENT,
  COMPOSER_GLOW_VERTEX,
} from "@/lib/composerGlowShader";

/** The clock the renderer draws by: rAF in a worker or the window. */
export interface FrameScheduler {
  request: (callback: (now: number) => void) => number;
  cancel: (id: number) => void;
  now: () => number;
}

export type ComposerGlowRendererMessage = Exclude<
  ComposerGlowMessage,
  { type: "init" }
>;

export interface ComposerGlowRenderer {
  handle(message: ComposerGlowRendererMessage): void;
}

type GL = WebGLRenderingContext | WebGL2RenderingContext;

const CONTEXT_ATTRIBUTES: WebGLContextAttributes = {
  alpha: true,
  premultipliedAlpha: true,
  antialias: false,
  depth: false,
  stencil: false,
  preserveDrawingBuffer: false,
  powerPreference: "low-power",
};

/** A frame may come this much early and still be drawn. */
const FRAME_SLACK_MS = 2;
/** Hot spot widths along the outline in CSS px, before clamping. */
const SPOT_WIDTHS = [70, 110, 160] as const;

const UNIFORMS = [
  "uBuffer",
  "uRatio",
  "uCenter",
  "uHalf",
  "uRadius",
  "uMargins",
  "uTime",
  "uNoise",
  "uSpots",
  "uSpotAmp",
  "uSpotWidth",
  "uLevel",
  "uTint0",
  "uTint1",
  "uTint2",
  "uDark",
] as const;

type UniformName = (typeof UNIFORMS)[number];

interface Resources {
  program: WebGLProgram;
  vertex: WebGLShader;
  fragment: WebGLShader;
  buffer: WebGLBuffer;
  uniforms: Record<UniformName, WebGLUniformLocation | null>;
}

function getContext(
  canvas: OffscreenCanvas | HTMLCanvasElement,
): { gl: GL; api: "webgl2" | "webgl" } | null {
  const target = canvas as unknown as {
    getContext(id: string, attributes: WebGLContextAttributes): GL | null;
  };
  for (const api of ["webgl2", "webgl"] as const) {
    let gl: GL | null = null;
    try {
      gl = target.getContext(api, CONTEXT_ATTRIBUTES);
    } catch {
      gl = null;
    }
    if (gl) return { gl, api };
  }
  return null;
}

function compile(gl: GL, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function createResources(gl: GL): Resources | null {
  const vertex = compile(gl, gl.VERTEX_SHADER, COMPOSER_GLOW_VERTEX);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, COMPOSER_GLOW_FRAGMENT);
  const program = gl.createProgram();
  const buffer = gl.createBuffer();
  const release = () => {
    if (vertex) gl.deleteShader(vertex);
    if (fragment) gl.deleteShader(fragment);
    if (program) gl.deleteProgram(program);
    if (buffer) gl.deleteBuffer(buffer);
  };
  if (!vertex || !fragment || !program || !buffer) {
    release();
    return null;
  }
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.bindAttribLocation(program, 0, "aPosition");
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    release();
    return null;
  }
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  // One triangle that covers the whole viewport.
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 3, -1, -1, 3]),
    gl.STATIC_DRAW,
  );
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.disable(gl.BLEND);
  const uniforms = {} as Resources["uniforms"];
  for (const name of UNIFORMS)
    uniforms[name] = gl.getUniformLocation(program, name);
  return { program, vertex, fragment, buffer, uniforms };
}

function fract(value: number): number {
  return value - Math.floor(value);
}

/**
 * Draws the composer light on `canvas` (an OffscreenCanvas in a worker, or a
 * page canvas as the fallback). It paces itself by `scheduler`, applies
 * size changes lazily at its next draw, survives context loss, and releases
 * its GPU context on dispose. Returns null, after emitting `unsupported`,
 * when the canvas has no WebGL.
 */
export function createComposerGlowRenderer(
  canvas: OffscreenCanvas | HTMLCanvasElement,
  initial: ComposerGlowState,
  options: {
    scheduler: FrameScheduler;
    host: "worker" | "main";
    emit: (event: ComposerGlowEvent) => void;
  },
): ComposerGlowRenderer | null {
  const { scheduler, host, emit } = options;
  const context = getContext(canvas);
  if (!context) {
    emit({ type: "unsupported" });
    return null;
  }
  const { gl, api } = context;
  let resources = createResources(gl);
  if (!resources) {
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    emit({ type: "unsupported" });
    return null;
  }

  const state: ComposerGlowState = { ...initial };
  const start = scheduler.now();
  let frame: number | null = null;
  let lastDraw = Number.NEGATIVE_INFINITY;
  let sizeDirty = true;
  /** A still frame needs redrawing. */
  let dirty = true;
  let drawn = false;
  let frameSent = false;
  let lost = false;
  let disposed = false;

  function cancelFrame() {
    if (frame === null) return;
    scheduler.cancel(frame);
    frame = null;
  }

  function wake() {
    if (disposed || lost || frame !== null) return;
    if (
      composerGlowFrameInterval(state.activity, state.reducedMotion, host) ===
      null
    )
      return;
    frame = scheduler.request(tick);
  }

  function applySize() {
    const { width, height, ratio } = state.geometry;
    const scale = Math.min(
      ratio,
      COMPOSER_GLOW_MAX_BUFFER_PX / Math.max(width, 1),
      COMPOSER_GLOW_MAX_BUFFER_PX / Math.max(height, 1),
    );
    const bufferWidth = Math.max(1, Math.round(width * scale));
    const bufferHeight = Math.max(1, Math.round(height * scale));
    if (canvas.width !== bufferWidth) canvas.width = bufferWidth;
    if (canvas.height !== bufferHeight) canvas.height = bufferHeight;
    gl.viewport(0, 0, bufferWidth, bufferHeight);
    sizeDirty = false;
    return scale;
  }

  let scale = state.geometry.ratio;

  function draw(now: number, still: boolean) {
    if (!resources) return;
    if (sizeDirty) scale = applySize();
    const { geometry, colors, seed } = state;
    const { uniforms: u } = resources;
    const t = still ? seed.timeOffset : (now - start) / 1000 + seed.timeOffset;
    const { box, margins } = geometry;
    const radius = Math.max(
      0,
      Math.min(box.radius, box.width / 2, box.height / 2),
    );
    const perimeter = Math.max(
      2 * (box.width - 2 * radius) +
        2 * (box.height - 2 * radius) +
        2 * Math.PI * radius,
      1,
    );
    const positions: number[] = [];
    const amps: number[] = [];
    seed.spots.slice(0, 3).forEach((spot, index) => {
      if (still) {
        positions.push(spot.start);
        amps.push(0.8);
        return;
      }
      positions.push(
        fract(
          spot.start +
            (spot.direction * t) / spot.period +
            0.05 * Math.sin(0.37 * t + spot.phase) +
            0.025 * Math.sin(0.91 * t + 2 * spot.phase),
        ),
      );
      const pulse = Math.sin(0.23 * t * (1 + index * 0.31) + spot.phase);
      amps.push(0.6 + 0.4 * pulse * pulse);
    });
    while (positions.length < 3) {
      positions.push(0);
      amps.push(0);
    }
    const level = still
      ? 1
      : 0.88 + 0.12 * Math.sin(0.41 * t + (seed.spots[0]?.phase ?? 0));
    const widths = SPOT_WIDTHS.map((width) => Math.min(width, perimeter / 6));

    gl.uniform2f(u.uBuffer, canvas.width, canvas.height);
    gl.uniform1f(u.uRatio, scale);
    gl.uniform2f(u.uCenter, box.x + box.width / 2, box.y + box.height / 2);
    gl.uniform2f(u.uHalf, box.width / 2, box.height / 2);
    gl.uniform1f(u.uRadius, radius);
    gl.uniform4f(
      u.uMargins,
      margins.top,
      margins.right,
      margins.bottom,
      margins.left,
    );
    gl.uniform1f(u.uTime, t);
    gl.uniform4f(u.uNoise, ...seed.noise);
    gl.uniform3f(u.uSpots, positions[0], positions[1], positions[2]);
    gl.uniform3f(u.uSpotAmp, amps[0], amps[1], amps[2]);
    gl.uniform3f(u.uSpotWidth, widths[0], widths[1], widths[2]);
    gl.uniform1f(u.uLevel, level);
    gl.uniform3f(u.uTint0, ...colors.tints[0]);
    gl.uniform3f(u.uTint1, ...colors.tints[1]);
    gl.uniform3f(u.uTint2, ...colors.tints[2]);
    gl.uniform1f(u.uDark, colors.dark ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    lastDraw = now;
    dirty = false;
    drawn = true;
  }

  function tick(now: number) {
    frame = null;
    if (disposed || lost) return;
    // The frame drawn last time has been presented by now.
    if (drawn && !frameSent) {
      frameSent = true;
      emit({ type: "frame" });
    }
    const interval = composerGlowFrameInterval(
      state.activity,
      state.reducedMotion,
      host,
    );
    if (interval === null) return;
    if (interval === "static") {
      if (dirty) draw(now, true);
      // One more tick reports the still frame as presented.
      if (!frameSent) frame = scheduler.request(tick);
      return;
    }
    if (now - lastDraw >= interval - FRAME_SLACK_MS) draw(now, false);
    frame = scheduler.request(tick);
  }

  function release() {
    if (!resources) return;
    gl.deleteProgram(resources.program);
    gl.deleteShader(resources.vertex);
    gl.deleteShader(resources.fragment);
    gl.deleteBuffer(resources.buffer);
    resources = null;
  }

  const onLost = (event: Event) => {
    event.preventDefault();
    lost = true;
    cancelFrame();
    // The handles belong to the lost context; nothing to delete.
    resources = null;
  };
  const onRestored = () => {
    if (disposed) return;
    resources = createResources(gl);
    if (!resources) return;
    lost = false;
    sizeDirty = true;
    dirty = true;
    drawn = false;
    frameSent = false;
    lastDraw = Number.NEGATIVE_INFINITY;
    wake();
  };
  canvas.addEventListener("webglcontextlost", onLost);
  canvas.addEventListener("webglcontextrestored", onRestored);

  emit({ type: "ready", api });
  wake();

  return {
    handle(message) {
      if (disposed) return;
      switch (message.type) {
        case "resize":
          state.geometry = message.geometry;
          sizeDirty = true;
          dirty = true;
          break;
        case "colors":
          state.colors = message.colors;
          dirty = true;
          break;
        case "activity":
          state.activity = message.activity;
          if (!message.activity.visible) cancelFrame();
          break;
        case "motion":
          state.reducedMotion = message.reducedMotion;
          dirty = true;
          break;
        case "dispose":
          disposed = true;
          cancelFrame();
          canvas.removeEventListener("webglcontextlost", onLost);
          canvas.removeEventListener("webglcontextrestored", onRestored);
          if (!lost) release();
          resources = null;
          gl.getExtension("WEBGL_lose_context")?.loseContext();
          return;
      }
      wake();
    },
  };
}
