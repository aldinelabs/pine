<script setup lang="ts">
import { onScopeDispose, ref, watch } from "vue";
import { useMediaQuery } from "@vueuse/core";
import {
  COMPOSER_GLOW_FADE_OUT_MS,
  composerGlowStyle,
} from "@/lib/composerGlow";

/**
 * A soft glow in the accent colour that orbits the composer's text box while
 * the agent works. It fades in when `active` turns on and fades out, then
 * unmounts, when it turns off, so an idle composer costs nothing. All motion
 * is CSS transform and opacity on the compositor; nothing runs per frame.
 */
const props = defineProps<{
  active: boolean;
}>();

type GlowPhase = "off" | "on" | "leaving";

const phase = ref<GlowPhase>("off");
const vars = ref<Record<string, string>>({});
const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
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
    <div class="composer-glow-ring">
      <span class="composer-glow-base" />
      <template v-if="!reducedMotion">
        <span class="composer-glow-drift">
          <span class="composer-glow-spin composer-glow-spin--a">
            <span class="composer-glow-beam" />
          </span>
        </span>
        <span class="composer-glow-spin composer-glow-spin--b">
          <span class="composer-glow-beam composer-glow-beam--wide" />
        </span>
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

/* Zero-size pivots at the centre; each animates only its transform. */
.composer-glow-drift,
.composer-glow-spin {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 0;
  height: 0;
}

.composer-glow-drift {
  animation: composer-glow-drift var(--composer-glow-drift, 17.9s) ease-in-out
    var(--composer-glow-delay-drift, 0s) infinite alternate;
}

.composer-glow-spin--a {
  animation: composer-glow-spin var(--composer-glow-spin-a, 9.7s) linear
    var(--composer-glow-delay-a, 0s) infinite;
}

.composer-glow-spin--b {
  animation: composer-glow-spin var(--composer-glow-spin-b, 14.3s) linear
    var(--composer-glow-delay-b, 0s) infinite reverse;
}

/*
 * A spoke from the pivot, long enough to cross the ring at any angle and
 * drift offset. The ring mask leaves one moving patch of it visible: it
 * dwells on the long edges and sweeps quickly round the ends. The colour
 * falls off across the spoke only, so the patch is as bright on the long
 * edges (close to the pivot) as at the ends (far from it).
 */
.composer-glow-beam {
  --composer-glow-beam-thickness: clamp(3rem, 70cqh, 9rem);
  position: absolute;
  left: 0;
  top: calc(var(--composer-glow-beam-thickness) / -2);
  width: calc(
    hypot(50cqw, 50cqh) + 6cqw + 15cqh + 2 * var(--composer-glow-spread)
  );
  height: var(--composer-glow-beam-thickness);
  background: linear-gradient(
    to bottom,
    transparent,
    var(--composer-glow-color) 50%,
    transparent
  );
}

.composer-glow-beam--wide {
  --composer-glow-beam-thickness: clamp(4.5rem, 100cqh, 12rem);
  background: linear-gradient(
    to bottom,
    transparent,
    color-mix(in oklab, var(--composer-glow-color) 70%, transparent) 50%,
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

  .composer-glow-drift,
  .composer-glow-spin,
  .composer-glow-beam--wide {
    animation: none;
  }
}

@keyframes composer-glow-spin {
  from {
    transform: rotate(0turn);
  }
  to {
    transform: rotate(1turn);
  }
}

/* Uneven waypoints so the pivot wanders rather than oscillates. */
@keyframes composer-glow-drift {
  0% {
    transform: translate(0, 0);
  }
  23% {
    transform: translate(4cqw, -11cqh);
  }
  41% {
    transform: translate(-2.5cqw, 6cqh);
  }
  68% {
    transform: translate(-6cqw, -4cqh);
  }
  86% {
    transform: translate(3cqw, 15cqh);
  }
  100% {
    transform: translate(5.5cqw, -2cqh);
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
