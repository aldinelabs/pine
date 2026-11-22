<script setup lang="ts">
import {
  FileTextIcon,
  MessageSquareIcon,
  SettingsIcon,
  WrenchIcon,
} from "@lucide/vue";
import { onBeforeUnmount, onMounted, useTemplateRef } from "vue";
import { EASE_OUT_EXPO } from "@/lib/motion";

// What goes into the context, bottom to top as it builds up; heights are
// shares of the window. Each is tall enough (16px and up) that the layers'
// corner radius is never cut down to a pill, so every corner matches.
const layers = [
  { icon: SettingsIcon, height: 14, tone: "bg-muted-foreground/35" },
  { icon: MessageSquareIcon, height: 16, tone: "bg-primary/45" },
  { icon: FileTextIcon, height: 20, tone: "bg-info/45" },
  { icon: WrenchIcon, height: 18, tone: "bg-warning/50" },
  { icon: MessageSquareIcon, height: 14, tone: "bg-primary/45" },
];

/** One loop: layers drop in one by one, hold, then all fade together. */
const CYCLE_MS = 6000;
const FIRST_ARRIVAL = 0.06;
const ARRIVAL_GAP = 0.1;
const ARRIVAL_LENGTH = 0.08;
const FADE_START = 0.9;

const layerElements = useTemplateRef<HTMLElement[]>("layerElements");
let animations: Animation[] = [];

onMounted(() => {
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  // Per-layer keyframe offsets keep every layer on the same clock, which a
  // CSS animation-delay cannot do once the loop repeats.
  animations = (layerElements.value ?? []).flatMap((element, index) => {
    if (typeof element.animate !== "function") return [];
    const arrive = FIRST_ARRIVAL + index * ARRIVAL_GAP;
    const hidden = { opacity: 0, transform: "translateY(-0.75rem)" };
    const shown = { opacity: 1, transform: "none" };
    return [
      element.animate(
        [
          { ...hidden, offset: 0 },
          { ...hidden, offset: arrive, easing: EASE_OUT_EXPO },
          { ...shown, offset: arrive + ARRIVAL_LENGTH },
          { ...shown, offset: FADE_START },
          { opacity: 0, transform: "none", offset: 1 },
        ],
        { duration: CYCLE_MS, iterations: Infinity },
      ),
    ];
  });
});

onBeforeUnmount(() => {
  animations.forEach((animation) => animation.cancel());
  animations = [];
});
</script>

<!-- The context window fills layer by layer: instructions, messages, files,
     tool results. The ring beside it tracks the same share. -->
<template>
  <div class="flex items-end justify-center gap-6">
    <!-- Same box as the compaction picture's; the layers' radius is the
         box's less its padding, so their corners stay concentric. -->
    <div
      class="ring-foreground/20 flex h-36 w-24 flex-col-reverse gap-px rounded-2xl p-2.5 ring-2"
    >
      <div
        v-for="(layer, index) in layers"
        ref="layerElements"
        :key="index"
        :class="[
          'flex shrink-0 items-center justify-center rounded-[calc(var(--radius-2xl)-0.625rem)]',
          layer.tone,
        ]"
        :style="{ height: `${layer.height}%` }"
      >
        <component :is="layer.icon" class="text-foreground/70 size-3.5" />
      </div>
    </div>

    <svg viewBox="0 0 40 40" class="help-ring-tone size-16" aria-hidden="true">
      <circle
        cx="20"
        cy="20"
        r="16"
        fill="none"
        stroke="currentColor"
        stroke-width="4"
        class="opacity-15"
      />
      <circle
        cx="20"
        cy="20"
        r="16"
        fill="none"
        stroke="currentColor"
        stroke-width="4"
        stroke-linecap="round"
        pathLength="100"
        stroke-dasharray="100"
        transform="rotate(-90 20 20)"
        class="help-ring"
      />
    </svg>
  </div>
</template>

<style scoped>
.help-ring {
  stroke-dashoffset: 18;
  animation: help-ring 6s ease-out infinite both;
}

/* On the svg, so the track and the arc change colour together. */
.help-ring-tone {
  color: var(--destructive);
  animation: help-ring-tone 6s ease-out infinite both;
}

@keyframes help-ring {
  0% {
    stroke-dashoffset: 100;
  }
  60%,
  90% {
    stroke-dashoffset: 18;
  }
  100% {
    stroke-dashoffset: 100;
  }
}

@keyframes help-ring-tone {
  0%,
  50% {
    color: var(--muted-foreground);
  }
  60%,
  90% {
    color: var(--destructive);
  }
  100% {
    color: var(--muted-foreground);
  }
}

@media (prefers-reduced-motion: reduce) {
  .help-ring,
  .help-ring-tone {
    animation: none;
  }
}
</style>
