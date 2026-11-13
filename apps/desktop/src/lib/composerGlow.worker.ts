import type {
  ComposerGlowEvent,
  ComposerGlowMessage,
} from "@/lib/composerGlow";
import {
  type ComposerGlowRenderer,
  createComposerGlowRenderer,
  type FrameScheduler,
} from "@/lib/composerGlowRenderer";

/**
 * Draws the composer light off the main thread on the OffscreenCanvas the
 * page hands over. Only static imports: Vite bundles this file as a classic
 * worker in builds.
 */
interface GlowWorkerScope {
  onmessage: ((event: MessageEvent<ComposerGlowMessage>) => void) | null;
  postMessage(event: ComposerGlowEvent): void;
  requestAnimationFrame?(callback: (now: number) => void): number;
  cancelAnimationFrame?(id: number): void;
  close(): void;
}

const scope = self as unknown as GlowWorkerScope;

const requestFrame = scope.requestAnimationFrame?.bind(scope);
const cancelFrame = scope.cancelAnimationFrame?.bind(scope);

const scheduler: FrameScheduler =
  requestFrame && cancelFrame
    ? {
        request: (callback) => requestFrame(callback),
        cancel: (id) => cancelFrame(id),
        now: () => performance.now(),
      }
    : {
        request: (callback) =>
          setTimeout(
            () => callback(performance.now()),
            1000 / 60,
          ) as unknown as number,
        cancel: (id) => clearTimeout(id),
        now: () => performance.now(),
      };

let renderer: ComposerGlowRenderer | null = null;
let closed = false;

scope.onmessage = (event) => {
  if (closed) return;
  const message = event.data;
  switch (message.type) {
    case "init":
      if (renderer) return;
      renderer = createComposerGlowRenderer(message.canvas, message.state, {
        scheduler,
        host: "worker",
        emit: (glowEvent) => scope.postMessage(glowEvent),
      });
      return;
    case "dispose":
      closed = true;
      renderer?.handle(message);
      renderer = null;
      scope.postMessage({ type: "disposed" });
      scope.close();
      return;
    default:
      renderer?.handle(message);
  }
};
