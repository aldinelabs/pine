<script setup lang="ts">
import { EASE_OUT_EXPO } from "@/lib/motion";

/**
 * A session's status in the sidebar's left column, under the project icon:
 * a spinning arc while it runs, a dot while it has output the user has not
 * seen, and an amber dot inside a ring, with a soft ping, while it waits on
 * the user (an approval or an answer). The same circles draw every state, so
 * one morphs into the next: finishing contracts the arc into the dot,
 * stopping for the user closes the arc into the dot while the ring opens
 * around it. Purely visual: the row carries the words.
 */
defineProps<{
  status: "approval" | "answer" | "running" | "unread" | "idle";
}>();

const MORPH_DURATION = "350ms";
</script>

<template>
  <span
    data-slot="session-status"
    :data-status="status"
    aria-hidden="true"
    class="session-status pointer-events-none absolute -start-2.5 top-1/2 flex size-3 -translate-y-1/2 text-sidebar-primary"
  >
    <svg
      viewBox="0 0 12 12"
      class="session-status-spin size-3 overflow-visible"
    >
      <circle
        class="session-status-halo"
        cx="6"
        cy="6"
        r="4.75"
        fill="none"
        stroke="currentColor"
      />
      <circle
        class="session-status-track"
        cx="6"
        cy="6"
        fill="none"
        stroke="currentColor"
      />
      <circle
        class="session-status-mark"
        cx="6"
        cy="6"
        fill="none"
        stroke="currentColor"
        stroke-linecap="round"
        pathLength="100"
      />
    </svg>
  </span>
</template>

<style scoped>
.session-status {
  transition-duration: v-bind(MORPH_DURATION);
  transition-property: color, opacity, scale;
  transition-timing-function: v-bind(EASE_OUT_EXPO);
}

.session-status[data-status="idle"] {
  opacity: 0;
  scale: 0.5;
}

/* Status colours keep Pine's defaults under every accent theme. */
.session-status:is([data-status="approval"], [data-status="answer"]) {
  color: var(--color-warning);
}

/* Paused, not removed, so a stopping arc keeps its angle as it closes. */
.session-status-spin {
  animation: session-status-spin 800ms linear infinite paused;
}

.session-status[data-status="running"] .session-status-spin {
  animation-play-state: running;
}

/* The dot of unread and waiting (and the idle state it fades from): a 6px
   disc drawn as a circle of radius 1.5 under a 3px stroke, so the arc can
   morph into it. */
.session-status-mark {
  r: 1.5px;
  stroke-width: 3px;
  stroke-dasharray: 100 0;
  transition-duration: v-bind(MORPH_DURATION);
  transition-property: r, stroke-width, stroke-dasharray;
  transition-timing-function: v-bind(EASE_OUT_EXPO);
}

.session-status[data-status="running"] .session-status-mark {
  r: 4.25px;
  stroke-width: 1.5px;
  stroke-dasharray: 30 70;
}

/* A faint ring under the running arc, and the solid ring around a waiting
   dot: the shape, not only the colour, tells waiting from unread. */
.session-status-track {
  opacity: 0;
  r: 1.5px;
  stroke-width: 1.5px;
  transition-duration: v-bind(MORPH_DURATION);
  transition-property: r, opacity, stroke-width;
  transition-timing-function: v-bind(EASE_OUT_EXPO);
}

.session-status[data-status="running"] .session-status-track {
  opacity: 0.2;
  r: 4.25px;
}

.session-status:is([data-status="approval"], [data-status="answer"])
  .session-status-track {
  opacity: 1;
  r: 5px;
  stroke-width: 1px;
}

/* A soft ping out of the ring while the session waits on the user. */
.session-status-halo {
  opacity: 0;
  stroke-width: 1px;
  transform-origin: center;
  transform-box: fill-box;
}

.session-status:is([data-status="approval"], [data-status="answer"])
  .session-status-halo {
  animation: session-status-ping 1800ms ease-out infinite;
}

@keyframes session-status-spin {
  to {
    rotate: 360deg;
  }
}

@keyframes session-status-ping {
  0% {
    opacity: 0.5;
    scale: 1;
  }
  60%,
  100% {
    opacity: 0;
    scale: 1.6;
  }
}

@media (prefers-reduced-motion: reduce) {
  .session-status,
  .session-status-mark,
  .session-status-track {
    transition: none;
  }

  .session-status-spin,
  .session-status:is([data-status="approval"], [data-status="answer"])
    .session-status-halo {
    animation: none;
  }

  /* Without the spin an arc reads as broken; a still ring says "working". */
  .session-status[data-status="running"] .session-status-mark {
    stroke-dasharray: 100 0;
  }
}
</style>
