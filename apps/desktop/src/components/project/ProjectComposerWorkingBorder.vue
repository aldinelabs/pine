<script lang="ts">
/** How long the exit lasts before the layers unmount; must match the CSS. */
export const WORKING_BORDER_EXIT_MS = 900;
</script>

<script setup lang="ts">
import { onScopeDispose, ref, watch } from "vue";

/**
 * A thin light that runs along the composer's text box border while the
 * agent works, with a soft glow copy just around it: VS Code's agent-panel
 * working border, in Pine's accent. It grows out from the bottom-right
 * corner when `active` turns on and shrinks and fades when it turns off,
 * then unmounts, so an idle composer costs nothing. Both layers are direct
 * children of the text box, as VS Code's are of its input container.
 */
const props = defineProps<{
  active: boolean;
}>();

type WorkingBorderPhase = "off" | "on" | "leaving";

const phase = ref<WorkingBorderPhase>("off");
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
      // Returning mid-exit grows the arc in again from the corner.
      clearLeaveTimer();
      phase.value = "on";
      return;
    }
    if (phase.value !== "on") return;
    phase.value = "leaving";
    leaveTimer = setTimeout(() => {
      leaveTimer = undefined;
      phase.value = "off";
    }, WORKING_BORDER_EXIT_MS);
  },
  { immediate: true },
);

onScopeDispose(clearLeaveTimer);
</script>

<template>
  <template v-if="phase !== 'off'">
    <div
      data-slot="session-composer-working-border"
      class="chat-input-working-border"
      :data-state="phase"
      aria-hidden="true"
    />
    <div
      data-slot="session-composer-working-border-glow"
      class="chat-input-working-border chat-input-working-border-glow"
      :data-state="phase"
      aria-hidden="true"
    />
  </template>
</template>

<style scoped>
/*
 * Ported from microsoft/vscode `chat-input-working-border` (workbench chat
 * input), MIT License, Copyright (c) Microsoft Corporation.
 *
 * VS Code's rules 1:1, without the `.chat-input-container >` prefix; the
 * `data-state` on each layer stands in for `.working` on the container.
 * Pine changes only the colour (its accent) and the entrance and exit,
 * each marked "Pine:" below.
 */

/* Pine: how far the arc has grown, from a point (0) to VS Code's arc (1). */
@property --composer-working-border-grow {
  syntax: "<number>";
  inherits: false;
  initial-value: 1;
}

.chat-input-working-border {
  --chat-input-anim-duration: 4s;
  /* Pine: the project accent, Pine Default theme colour, or grey. */
  --chat-input-working-border-color1: var(--composer-working-border-color);
  /* VS Code: var(--vscode-strokeThickness). */
  --chat-input-working-border-width: 1px;
  position: absolute;
  inset: -1px;
  border-radius: inherit;
  padding: var(--chat-input-working-border-width);
  container-type: size;
  overflow: clip;
  -webkit-mask:
    linear-gradient(#000 0 0) content-box,
    linear-gradient(#000 0 0);
  mask:
    linear-gradient(#000 0 0) content-box,
    linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  opacity: 0;
  /* Pine: the old glow's fade-in (VS Code: opacity 0.35s ease). */
  transition: opacity 450ms ease-out;
  pointer-events: none;
  z-index: 2;
}

.chat-input-working-border::before {
  content: "";
  position: absolute;
  top: 50%;
  left: 50%;
  width: hypot(
    calc(100cqw + 2 * var(--chat-input-working-border-width)),
    calc(100cqh + 2 * var(--chat-input-working-border-width))
  );
  aspect-ratio: 1;
  transform: translate(-50%, -50%);
  /*
   * Pine: VS Code starts `from 135deg`. Here the brightest stop (30deg)
   * sits on the ray to the bottom-right corner (90deg + atan2(h, w)) at
   * the spin's start, where the old glow entered, and every stop scales
   * with the grow so the arc grows out of that corner. At grow 1 this is
   * VS Code's arc with only a phase offset.
   */
  background: conic-gradient(
    from
      calc(
        90deg + atan2(100cqh, 100cqw) - 30deg *
          var(--composer-working-border-grow)
      ),
    transparent 0deg,
    color-mix(in srgb, var(--chat-input-working-border-color1) 90%, transparent)
      calc(20deg * var(--composer-working-border-grow)),
    var(--chat-input-working-border-color1)
      calc(30deg * var(--composer-working-border-grow)),
    color-mix(in srgb, var(--chat-input-working-border-color1) 60%, transparent)
      calc(50deg * var(--composer-working-border-grow)),
    transparent calc(90deg * var(--composer-working-border-grow)),
    transparent 360deg
  );
}

.chat-input-working-border-glow {
  --chat-input-working-border-width: 2px;
  filter: blur(1.5px);
  z-index: 1;
}

.chat-input-working-border-glow::before {
  background: conic-gradient(
    from
      calc(
        90deg + atan2(100cqh, 100cqw) - 30deg *
          var(--composer-working-border-grow)
      ),
    transparent 0deg,
    color-mix(in srgb, var(--chat-input-working-border-color1) 60%, transparent)
      calc(25deg * var(--composer-working-border-grow)),
    color-mix(in srgb, var(--chat-input-working-border-color1) 35%, transparent)
      calc(50deg * var(--composer-working-border-grow)),
    transparent calc(90deg * var(--composer-working-border-grow)),
    transparent 360deg
  );
}

.chat-input-working-border[data-state="on"] {
  opacity: 1;
}

/* Pine: a freshly mounted layer fades in rather than appearing at once. */
@starting-style {
  .chat-input-working-border[data-state="on"] {
    opacity: 0;
  }
}

/*
 * Pine: the arc grows in over the old glow's entrance (1100ms) while it
 * starts to spin. Returning mid-exit grows it in again from the corner.
 */
.chat-input-working-border[data-state="on"]::before {
  animation:
    composer-working-border-grow-in 1100ms ease-out both,
    chat-input-working-border-spin var(--chat-input-anim-duration) linear
      infinite;
}

/*
 * Pine: VS Code drops the spin with `.working`, so its arc jumps back as it
 * fades. Here the spin stays in the same list position, so it keeps
 * running, while the arc shrinks back to a point and fades over 900ms
 * (WORKING_BORDER_EXIT_MS).
 */
.chat-input-working-border[data-state="leaving"] {
  opacity: 0;
  transition-duration: 900ms;
  transition-timing-function: ease-out;
}

.chat-input-working-border[data-state="leaving"]::before {
  animation:
    composer-working-border-grow-out 900ms ease-out forwards,
    chat-input-working-border-spin var(--chat-input-anim-duration) linear
      infinite;
}

@keyframes chat-input-working-border-spin {
  0% {
    transform: translate(-50%, -50%) rotate(0);
  }
  to {
    transform: translate(-50%, -50%) rotate(360deg);
  }
}

@keyframes composer-working-border-grow-in {
  from {
    --composer-working-border-grow: 0;
  }
  to {
    --composer-working-border-grow: 1;
  }
}

@keyframes composer-working-border-grow-out {
  from {
    --composer-working-border-grow: 1;
  }
  to {
    --composer-working-border-grow: 0;
  }
}

/*
 * VS Code stops the spin; Pine also skips the grow, so the arc stays still
 * at the bottom-right corner at full length and only fades in and out.
 */
@media (prefers-reduced-motion: reduce) {
  .chat-input-working-border[data-state]::before {
    animation: none;
  }
}
</style>
