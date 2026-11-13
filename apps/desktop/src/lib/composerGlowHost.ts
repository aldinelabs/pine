import {
  COMPOSER_GLOW_DISPOSE_TIMEOUT_MS,
  type ComposerGlowActivity,
  type ComposerGlowColors,
  type ComposerGlowEvent,
  type ComposerGlowGeometry,
  type ComposerGlowMessage,
  type ComposerGlowState,
  composerGlowColorsEqual,
  composerGlowGeometryEqual,
} from "@/lib/composerGlow";
import {
  type ComposerGlowRendererMessage,
  createComposerGlowRenderer,
  type FrameScheduler,
} from "@/lib/composerGlowRenderer";

export interface ComposerGlowHostOptions {
  /** The first frame is on screen: the light may fade in. */
  onFirstFrame(): void;
  /**
   * The worker could not draw. The canvas now belongs to it, so the caller
   * mounts a fresh canvas and creates a host with `forceMain`.
   */
  onFallback(): void;
  /** No WebGL at all: nothing will be drawn. */
  onUnavailable(): void;
  /** Draw on the main thread even when a worker could. */
  forceMain?: boolean;
}

export type ComposerGlowUpdate = Partial<{
  geometry: ComposerGlowGeometry;
  colors: ComposerGlowColors;
  activity: ComposerGlowActivity;
  reducedMotion: boolean;
}>;

export interface ComposerGlowHost {
  readonly mode: "worker" | "main";
  /** Sends only what changed. */
  update(changes: ComposerGlowUpdate): void;
  /** Stops drawing and releases the GPU context and the worker. */
  dispose(): void;
}

/** Whether the light can be drawn in a worker on this canvas. */
export function composerGlowWorkerSupported(
  canvas: HTMLCanvasElement,
): boolean {
  return (
    typeof Worker === "function" &&
    typeof OffscreenCanvas === "function" &&
    "transferControlToOffscreen" in canvas
  );
}

/** The messages that bring `current` up to date with `changes`. */
function diff(
  current: ComposerGlowState,
  changes: ComposerGlowUpdate,
): ComposerGlowRendererMessage[] {
  const messages: ComposerGlowRendererMessage[] = [];
  if (
    changes.geometry &&
    !composerGlowGeometryEqual(current.geometry, changes.geometry)
  ) {
    current.geometry = changes.geometry;
    messages.push({ type: "resize", geometry: changes.geometry });
  }
  if (
    changes.colors &&
    !composerGlowColorsEqual(current.colors, changes.colors)
  ) {
    current.colors = changes.colors;
    messages.push({ type: "colors", colors: changes.colors });
  }
  if (
    changes.activity &&
    (changes.activity.focused !== current.activity.focused ||
      changes.activity.visible !== current.activity.visible)
  ) {
    current.activity = changes.activity;
    messages.push({ type: "activity", activity: changes.activity });
  }
  if (
    changes.reducedMotion !== undefined &&
    changes.reducedMotion !== current.reducedMotion
  ) {
    current.reducedMotion = changes.reducedMotion;
    messages.push({ type: "motion", reducedMotion: changes.reducedMotion });
  }
  return messages;
}

const windowScheduler: FrameScheduler = {
  request: (callback) => requestAnimationFrame(callback),
  cancel: (id) => cancelAnimationFrame(id),
  now: () => performance.now(),
};

function createMainHost(
  canvas: HTMLCanvasElement,
  state: ComposerGlowState,
  options: ComposerGlowHostOptions,
): ComposerGlowHost {
  const current = { ...state };
  let disposed = false;
  let firstFrame = false;
  const renderer = createComposerGlowRenderer(canvas, state, {
    scheduler: windowScheduler,
    host: "main",
    emit: (event) => {
      if (disposed || event.type !== "frame" || firstFrame) return;
      firstFrame = true;
      options.onFirstFrame();
    },
  });
  if (!renderer) options.onUnavailable();
  return {
    mode: "main",
    update(changes) {
      if (disposed || !renderer) return;
      for (const message of diff(current, changes)) renderer.handle(message);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      renderer?.handle({ type: "dispose" });
    },
  };
}

function createWorkerHost(
  canvas: HTMLCanvasElement,
  state: ComposerGlowState,
  options: ComposerGlowHostOptions,
): ComposerGlowHost | null {
  let worker: Worker;
  try {
    worker = new Worker(new URL("./composerGlow.worker.ts", import.meta.url), {
      type: "module",
    });
  } catch {
    return null;
  }
  let offscreen: OffscreenCanvas;
  try {
    offscreen = canvas.transferControlToOffscreen();
  } catch {
    worker.terminate();
    return null;
  }

  const current = { ...state };
  let ready = false;
  let firstFrame = false;
  /** No more messages go out and no more callbacks come in. */
  let finished = false;
  let terminated = false;
  let disposeTimer: ReturnType<typeof setTimeout> | undefined;

  const terminate = () => {
    if (disposeTimer !== undefined) {
      clearTimeout(disposeTimer);
      disposeTimer = undefined;
    }
    if (terminated) return;
    terminated = true;
    worker.removeEventListener("message", onMessage);
    worker.removeEventListener("error", onError);
    worker.removeEventListener("messageerror", onError);
    worker.terminate();
  };

  const fallBack = () => {
    if (finished) return;
    finished = true;
    terminate();
    options.onFallback();
  };

  function onMessage(event: MessageEvent<ComposerGlowEvent>) {
    const message = event.data;
    if (message.type === "disposed") {
      terminate();
      return;
    }
    if (finished) return;
    switch (message.type) {
      case "ready":
        ready = true;
        return;
      case "unsupported":
        if (!ready) fallBack();
        return;
      case "frame":
        if (firstFrame) return;
        firstFrame = true;
        options.onFirstFrame();
        return;
    }
  }

  function onError() {
    // Once drawing works, a later error leaves the light as it is.
    if (!ready) fallBack();
  }

  worker.addEventListener("message", onMessage);
  worker.addEventListener("error", onError);
  worker.addEventListener("messageerror", onError);

  const post = (
    message: ComposerGlowMessage,
    transfer: Transferable[] = [],
  ) => {
    try {
      worker.postMessage(message, transfer);
      return true;
    } catch {
      return false;
    }
  };

  if (!post({ type: "init", canvas: offscreen, state }, [offscreen])) {
    // The canvas may already be gone with the message.
    queueMicrotask(fallBack);
  }

  return {
    mode: "worker",
    update(changes) {
      if (finished) return;
      for (const message of diff(current, changes)) post(message);
    },
    dispose() {
      if (finished) {
        terminate();
        return;
      }
      finished = true;
      if (terminated) return;
      if (!post({ type: "dispose" })) {
        terminate();
        return;
      }
      disposeTimer = setTimeout(terminate, COMPOSER_GLOW_DISPOSE_TIMEOUT_MS);
    },
  };
}

/**
 * Starts drawing the composer light on `canvas`: in a worker on an
 * OffscreenCanvas when possible, otherwise on the main thread. The host
 * forwards changes as messages and tears everything down on dispose.
 */
export function createComposerGlowHost(
  canvas: HTMLCanvasElement,
  state: ComposerGlowState,
  options: ComposerGlowHostOptions,
): ComposerGlowHost {
  if (!options.forceMain && composerGlowWorkerSupported(canvas)) {
    const host = createWorkerHost(canvas, state, options);
    if (host) return host;
  }
  return createMainHost(canvas, state, options);
}
