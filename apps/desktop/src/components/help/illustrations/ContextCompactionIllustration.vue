<script setup lang="ts">
import { ArrowRightIcon, ScrollTextIcon } from "@lucide/vue";

/** Line widths of the earlier conversation, in percent. */
const earlier = [92, 70, 84, 60, 88, 74, 66, 80];
const recent = [86, 64];
</script>

<!-- A full conversation (left) becomes a short summary plus the latest
     turns (right), leaving free room. -->
<template>
  <div class="flex items-center justify-center gap-3 sm:gap-5">
    <div
      class="bg-background ring-foreground/10 flex h-36 w-28 flex-col gap-1.5 rounded-2xl p-2.5 shadow-sm ring-1"
    >
      <span
        v-for="(width, index) in earlier"
        :key="`e${index}`"
        class="help-squeeze bg-foreground/20 h-1.5 shrink-0 rounded-full"
        :style="{ width: `${width}%` }"
      />
      <span
        v-for="(width, index) in recent"
        :key="`r${index}`"
        class="bg-primary/50 h-1.5 shrink-0 rounded-full"
        :style="{ width: `${width}%` }"
      />
    </div>

    <ArrowRightIcon class="text-muted-foreground size-5 shrink-0" />

    <div
      class="bg-background ring-foreground/10 flex h-36 w-28 flex-col gap-1.5 rounded-2xl p-2.5 shadow-sm ring-1"
    >
      <div
        class="help-summary bg-warning/20 text-warning flex shrink-0 items-center gap-1 rounded-[calc(var(--radius-2xl)-0.625rem)] px-1.5 py-1"
      >
        <ScrollTextIcon class="size-3.5 shrink-0" />
        <span class="bg-warning/50 h-1.5 flex-1 rounded-full" />
      </div>
      <span
        v-for="(width, index) in recent"
        :key="`n${index}`"
        class="bg-primary/50 h-1.5 shrink-0 rounded-full"
        :style="{ width: `${width}%` }"
      />
      <div
        class="help-free ring-foreground/15 mt-auto flex-1 rounded-[calc(var(--radius-2xl)-0.625rem)] ring-1"
      />
    </div>
  </div>
</template>

<style scoped>
.help-squeeze {
  animation: help-squeeze 5s ease-in-out infinite both;
}

.help-summary {
  animation: help-summary 5s cubic-bezier(0.16, 1, 0.3, 1) infinite both;
}

.help-free {
  animation: help-free 5s ease-in-out infinite both;
}

@keyframes help-squeeze {
  0%,
  20% {
    opacity: 1;
  }
  40%,
  90% {
    opacity: 0.25;
  }
  100% {
    opacity: 1;
  }
}

@keyframes help-summary {
  0%,
  30% {
    opacity: 0;
    transform: translateX(-12px) scale(0.9);
  }
  45%,
  90% {
    opacity: 1;
    transform: none;
  }
  100% {
    opacity: 0;
  }
}

@keyframes help-free {
  0%,
  40% {
    opacity: 0;
  }
  55%,
  90% {
    opacity: 1;
  }
  100% {
    opacity: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .help-squeeze,
  .help-summary,
  .help-free {
    animation: none;
  }
}
</style>
