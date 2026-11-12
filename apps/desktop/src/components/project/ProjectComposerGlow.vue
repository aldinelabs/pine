<script setup lang="ts">
import { onScopeDispose, ref, watch } from "vue";
import { useMediaQuery } from "@vueuse/core";
import {
  COMPOSER_GLOW_FADE_OUT_MS,
  type ComposerGlowOrbit,
  composerGlowKeyframes,
  composerGlowOrbits,
  composerGlowOutline,
  composerGlowStyle,
} from "@/lib/composerGlow";

/**
 * A soft glow in the accent colour that travels round the composer's text
 * box while the agent works. It fades in when `active` turns on and fades
 * out, then unmounts, when it turns off, so an idle composer costs nothing.
 * The lights move by Web Animations on transform, which the compositor runs;
 * their keyframes are rebuilt only when the text box changes size.
 */
const props = defineProps<{
  active: boolean;
}>();

type GlowPhase = "off" | "on" | "leaving";

const phase = ref<GlowPhase>("off");
const vars = ref<Record<string, string>>({});
const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
const ring = ref<HTMLElement | null>(null);
const orbitA = ref<HTMLElement | null>(null);
const orbitB = ref<HTMLElement | null>(null);
let orbits: ComposerGlowOrbit[] = [];
let leaveTimer: ReturnType<typeof setTimeout> | undefined;

function clearLeaveTimer() {
  if (leaveTimer === undefined) return;
  clearTimeout(leaveTimer);
  leaveTimer = undefined;
}

watch(
  () => props.active,
  (active) => {
    if (active) {
      clearLeaveTimer();
      // A fresh run starts at a new phase; returning mid fade-out keeps
      // moving where it was.
      if (phase.value === "off") {
        orbits = composerGlowOrbits();
        vars.value = {
          ...composerGlowStyle(),
          "--composer-glow-fade-out": `${COMPOSER_GLOW_FADE_OUT_MS}ms`,
        };
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

function measure(element: HTMLElement) {
  const style = getComputedStyle(element);
  return composerGlowOutline({
    clientWidth: element.clientWidth,
    clientHeight: element.clientHeight,
    spread: Number.parseFloat(style.borderTopWidth) || 0,
    outerRadius: Number.parseFloat(style.borderTopLeftRadius) || 0,
  });
}

// One lap per light, laid out for the current size. A resize keeps each
// animation's time and swaps only its keyframes, coalesced to one frame.
watch(
  [ring, orbitA, orbitB],
  ([ringElement, ...lights], _previous, onCleanup) => {
    if (!ringElement || lights.some((light) => !light)) return;
    if (
      typeof ResizeObserver === "undefined" ||
      typeof ringElement.animate !== "function"
    )
      return;
    const animations: (Animation | undefined)[] = [];
    let frame = 0;
    const layout = () => {
      frame = 0;
      const outline = measure(ringElement);
      if (!outline) return;
      lights.forEach((light, index) => {
        const orbit = orbits[index];
        if (!light || !orbit) return;
        const keyframes = composerGlowKeyframes(outline, orbit);
        const animation = animations[index];
        if (animation) {
          (animation.effect as KeyframeEffect | null)?.setKeyframes(keyframes);
          return;
        }
        animations[index] = light.animate(keyframes, {
          duration: orbit.durationMs,
          delay: orbit.delayMs,
          iterations: Infinity,
          easing: "linear",
          direction: index === 0 ? "normal" : "reverse",
        });
      });
    };
    const observer = new ResizeObserver(() => {
      if (!frame) frame = requestAnimationFrame(layout);
    });
    observer.observe(ringElement);
    onCleanup(() => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
      for (const animation of animations) animation?.cancel();
    });
  },
  { flush: "post" },
);

onScopeDispose(clearLeaveTimer);
</script>

<template>
  <div
    v-if="phase !== 'off'"
    data-slot="session-composer-glow"
    class="composer-glow"
    aria-hidden="true"
    :data-state="phase"
    :data-motion="reducedMotion ? 'reduced' : 'full'"
    :style="vars"
  >
    <div ref="ring" class="composer-glow-ring">
      <span class="composer-glow-base" />
      <template v-if="!reducedMotion">
        <span ref="orbitA" class="composer-glow-orbit" />
        <span
          ref="orbitB"
          class="composer-glow-orbit composer-glow-orbit--wide"
        />
      </template>
    </div>
  </div>
</template>

<style scoped>
/*
 * Sits behind the text box (z-index -1 in the composer's stacking context)
 * and shows only in a thin ring just outside its rounded outline, so the
 * translucent fill is not tinted. Visual reach ≈ spread + 2 × blur ≈ 10px,
 * which the composer's bottom padding and gutter leave room for.
 */
.composer-glow {
  --composer-glow-spread: 4px;
  position: absolute;
  inset: calc(-1 * var(--composer-glow-spread));
  z-index: -1;
  pointer-events: none;
  border-radius: calc(
    var(--session-composer-control-radius) + var(--composer-glow-spread)
  );
  /* Static; the compositor applies it without repainting. */
  filter: blur(3px);
  opacity: var(--composer-glow-strength);
  transition: opacity 700ms var(--ease-out-expo);
}

@starting-style {
  .composer-glow {
    opacity: 0;
  }
}

.composer-glow[data-state="leaving"] {
  opacity: 0;
  transition-duration: var(--composer-glow-fade-out, 900ms);
  transition-timing-function: ease-out;
}

/* A fixed ring mask whose inner edge is the text box's border box. */
.composer-glow-ring {
  position: absolute;
  inset: 0;
  border: var(--composer-glow-spread) solid transparent;
  border-radius: inherit;
  container-type: size;
  -webkit-mask:
    linear-gradient(#000 0 0) padding-box,
    linear-gradient(#000 0 0) border-box;
  -webkit-mask-composite: xor;
  mask:
    linear-gradient(#000 0 0) padding-box,
    linear-gradient(#000 0 0) border-box;
  mask-composite: exclude;
}

.composer-glow-base {
  position: absolute;
  inset: calc(-1 * var(--composer-glow-spread));
  background: var(--composer-glow-color);
  opacity: 0.3;
  animation: composer-glow-breathe var(--composer-glow-breathe, 6.1s)
    ease-in-out var(--composer-glow-delay-breathe, 0s) infinite alternate;
}

/*
 * A soft light at the ring, carried round it by Web Animations (see the
 * script) and turned to lie along the outline. It is thinner than the text
 * box is tall, so it never lights both long edges at once.
 */
.composer-glow-orbit {
  position: absolute;
  left: 0;
  top: 0;
  width: 6rem;
  height: min(3rem, 80cqh);
  translate: -50% -50%;
  background: radial-gradient(
    closest-side,
    var(--composer-glow-color),
    transparent
  );
  will-change: transform;
}

.composer-glow-orbit--wide {
  width: 9rem;
  height: min(4rem, 90cqh);
  background: radial-gradient(
    closest-side,
    color-mix(in oklab, var(--composer-glow-color) 70%, transparent),
    transparent
  );
  animation: composer-glow-pulse var(--composer-glow-pulse, 4.3s) ease-in-out
    var(--composer-glow-delay-pulse, 0s) infinite alternate;
}

.composer-glow[data-motion="reduced"] .composer-glow-base {
  animation: none;
  opacity: 0.4;
}

@media (prefers-reduced-motion: reduce) {
  .composer-glow-base {
    animation: none;
    opacity: 0.4;
  }

  .composer-glow-orbit--wide {
    animation: none;
  }
}

@keyframes composer-glow-breathe {
  0% {
    opacity: 0.2;
  }
  37% {
    opacity: 0.38;
  }
  58% {
    opacity: 0.27;
  }
  100% {
    opacity: 0.45;
  }
}

@keyframes composer-glow-pulse {
  0% {
    opacity: 0.5;
  }
  45% {
    opacity: 0.85;
  }
  70% {
    opacity: 0.7;
  }
  100% {
    opacity: 1;
  }
}
</style>
