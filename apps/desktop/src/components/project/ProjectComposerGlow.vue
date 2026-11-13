<script setup lang="ts">
import { computed, onScopeDispose, ref, watch } from "vue";
import { useMediaQuery } from "@vueuse/core";
import {
  COMPOSER_GLOW_FADE_OUT_MS,
  type ComposerGlowActivity,
  type ComposerGlowMargins,
  type ComposerGlowSeed,
  type GlowRect,
  composerGlowColorsEqual,
  composerGlowGeometry,
  composerGlowGeometryEqual,
  composerGlowSeed,
  findClipAncestor,
  readComposerGlowColors,
} from "@/lib/composerGlow";
import {
  type ComposerGlowHost,
  createComposerGlowHost,
} from "@/lib/composerGlowHost";

/**
 * A light that circles the composer's text box clockwise while the agent
 * works, drawn by WebGL on a canvas (in a worker when it can, so the page
 * does no work per frame). When `active` turns on, the renderer grows the
 * comet out from the bottom-right corner while the wrapper fades in once
 * the first frame is on screen; when it turns off, the comet shrinks as the
 * wrapper fades out, then everything unmounts with its worker and GPU
 * context, so an idle composer costs nothing.
 */
const props = defineProps<{
  active: boolean;
}>();

type GlowPhase = "off" | "on" | "leaving";

const phase = ref<GlowPhase>("off");
const ready = ref(false);
const canvasKey = ref(0);
const margins = ref<ComposerGlowMargins>({
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
});
/**
 * The text box's border widths. The wrapper's insets resolve against its
 * padding box, while the light is measured from its border box.
 */
const border = ref<ComposerGlowMargins>({
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
});
const root = ref<HTMLElement | null>(null);
const canvas = ref<HTMLCanvasElement | null>(null);
const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");

let seed: ComposerGlowSeed | undefined;
/** The worker could not draw this run: draw on the page instead. */
let forceMain = false;
let host: ComposerGlowHost | undefined;
let teardown: (() => void) | undefined;
let leaveTimer: ReturnType<typeof setTimeout> | undefined;

const insetStyle = computed(() => ({
  top: `${-(margins.value.top + border.value.top)}px`,
  right: `${-(margins.value.right + border.value.right)}px`,
  bottom: `${-(margins.value.bottom + border.value.bottom)}px`,
  left: `${-(margins.value.left + border.value.left)}px`,
}));

function clearLeaveTimer() {
  if (leaveTimer === undefined) return;
  clearTimeout(leaveTimer);
  leaveTimer = undefined;
}

function runTeardown() {
  const current = teardown;
  teardown = undefined;
  current?.();
}

watch(
  () => props.active,
  (active) => {
    if (active) {
      clearLeaveTimer();
      // A fresh run gets new randomness; returning mid fade-out keeps
      // drawing where it was.
      if (phase.value === "off") {
        seed = composerGlowSeed();
        forceMain = false;
        ready.value = false;
      }
      phase.value = "on";
      return;
    }
    if (phase.value !== "on") return;
    phase.value = "leaving";
    leaveTimer = setTimeout(() => {
      leaveTimer = undefined;
      phase.value = "off";
    }, COMPOSER_GLOW_FADE_OUT_MS);
  },
  { immediate: true },
);

function readActivity(): ComposerGlowActivity {
  return {
    focused: document.hasFocus(),
    visible: document.visibilityState === "visible",
  };
}

function clipRect(clip: Element): GlowRect {
  if (clip === document.documentElement)
    return {
      left: 0,
      top: 0,
      right: window.innerWidth,
      bottom: window.innerHeight,
    };
  return clip.getBoundingClientRect();
}

// Starts drawing whenever a canvas mounts (each run, and again on a fresh
// canvas when the worker falls back to the page), and stops when it goes.
// Nothing here runs per frame: only resizes, theme changes and window
// focus or visibility changes send a message.
watch(
  canvas,
  (element, _previous, onCleanup) => {
    runTeardown();
    const control = root.value?.parentElement;
    if (!element || !control || !seed) return;
    const clip = findClipAncestor(control);
    const style = getComputedStyle(control);
    const radius = Number.parseFloat(style.borderTopLeftRadius) || 0;
    const width = (value: string) => Number.parseFloat(value) || 0;
    border.value = {
      top: width(style.borderTopWidth),
      right: width(style.borderRightWidth),
      bottom: width(style.borderBottomWidth),
      left: width(style.borderLeftWidth),
    };
    const measure = () =>
      composerGlowGeometry(
        control.getBoundingClientRect(),
        clipRect(clip),
        radius,
        window.devicePixelRatio,
      );
    let geometry = measure();
    let colors = readComposerGlowColors(control);
    let activity = readActivity();
    margins.value = geometry.margins;

    const glowHost = createComposerGlowHost(
      element,
      {
        geometry,
        colors,
        activity,
        reducedMotion: reducedMotion.value,
        seed,
        present: phase.value === "on",
      },
      {
        forceMain,
        onFirstFrame: () => {
          if (host === glowHost) ready.value = true;
        },
        onFallback: () => {
          if (host !== glowHost) return;
          // The old canvas now belongs to the worker; draw on a new one.
          forceMain = true;
          canvasKey.value += 1;
        },
        // Nothing to draw with: the light stays transparent.
        onUnavailable: () => {},
      },
    );
    host = glowHost;

    const remeasure = () => {
      const next = measure();
      if (composerGlowGeometryEqual(geometry, next)) return;
      const marginsChanged =
        next.margins.top !== geometry.margins.top ||
        next.margins.right !== geometry.margins.right ||
        next.margins.bottom !== geometry.margins.bottom ||
        next.margins.left !== geometry.margins.left;
      geometry = next;
      if (marginsChanged) margins.value = next.margins;
      glowHost.update({ geometry: next });
    };
    const resizeObserver =
      typeof ResizeObserver === "function"
        ? new ResizeObserver(remeasure)
        : undefined;
    resizeObserver?.observe(control);
    if (clip !== document.documentElement) resizeObserver?.observe(clip);

    const themeObserver =
      typeof MutationObserver === "function"
        ? new MutationObserver(() => {
            const next = readComposerGlowColors(control);
            if (composerGlowColorsEqual(colors, next)) return;
            colors = next;
            glowHost.update({ colors: next });
          })
        : undefined;
    themeObserver?.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-project-color-theme"],
    });

    const onActivity = () => {
      const next = readActivity();
      if (
        next.focused === activity.focused &&
        next.visible === activity.visible
      )
        return;
      activity = next;
      glowHost.update({ activity: next });
    };
    // Moving the window to a display with another pixel density changes
    // the drawing-buffer ratio but not the text box's size.
    let densityQuery: MediaQueryList | undefined;
    const unwatchDensity = () =>
      densityQuery?.removeEventListener("change", onDensityChange);
    const watchDensity = () => {
      unwatchDensity();
      densityQuery =
        typeof window.matchMedia === "function"
          ? window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
          : undefined;
      densityQuery?.addEventListener("change", onDensityChange);
    };
    const onDensityChange = () => {
      watchDensity();
      remeasure();
    };
    watchDensity();

    window.addEventListener("focus", onActivity);
    window.addEventListener("blur", onActivity);
    document.addEventListener("visibilitychange", onActivity);

    const stop = () => {
      resizeObserver?.disconnect();
      themeObserver?.disconnect();
      unwatchDensity();
      window.removeEventListener("focus", onActivity);
      window.removeEventListener("blur", onActivity);
      document.removeEventListener("visibilitychange", onActivity);
      glowHost.dispose();
      if (host === glowHost) host = undefined;
    };
    teardown = stop;
    onCleanup(() => {
      if (teardown === stop) runTeardown();
    });
  },
  { flush: "post" },
);

watch(reducedMotion, (reduce) => host?.update({ reducedMotion: reduce }));
// Leaving shrinks the comet away; coming back mid fade-out grows it again
// from where it is, on the same renderer.
watch(phase, (next) => {
  if (next !== "off") host?.update({ present: next === "on" });
});

onScopeDispose(() => {
  clearLeaveTimer();
  runTeardown();
});
</script>

<template>
  <div
    v-if="phase !== 'off'"
    ref="root"
    data-slot="session-composer-glow"
    class="composer-glow"
    aria-hidden="true"
    :data-state="phase"
    :data-ready="ready ? 'true' : 'false'"
    :style="insetStyle"
  >
    <canvas :key="canvasKey" ref="canvas" class="composer-glow-canvas" />
  </div>
</template>

<style scoped>
/*
 * Behind the text box (z-index -1 in the composer's isolated root), so it
 * paints over the transcript but under the text box, whose border and
 * focus ring stay crisp above it. The wrapper takes the insets, measured to
 * the room around the text box, because a positioned canvas would keep its
 * intrinsic size. It shows only once the first frame is drawn (at the
 * start of the shader's growth, so a short linear fade lets that growth
 * read); the fade-out matches COMPOSER_GLOW_FADE_OUT_MS.
 */
.composer-glow {
  position: absolute;
  z-index: -1;
  pointer-events: none;
  opacity: 0;
  transition: opacity 450ms ease-out;
}

.composer-glow[data-ready="true"][data-state="on"] {
  opacity: 1;
}

.composer-glow[data-state="leaving"] {
  opacity: 0;
  transition-duration: 900ms;
  transition-timing-function: ease-out;
}

.composer-glow-canvas {
  display: block;
  width: 100%;
  height: 100%;
}
</style>
