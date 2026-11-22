<script setup lang="ts">
import {
  FileTextIcon,
  MessageSquareIcon,
  SettingsIcon,
  WrenchIcon,
} from "@lucide/vue";

// What goes into the context, bottom to top as it builds up; the heights
// are shares of the window.
const layers = [
  { icon: SettingsIcon, height: 14, tone: "bg-muted-foreground/35" },
  { icon: MessageSquareIcon, height: 16, tone: "bg-primary/45" },
  { icon: FileTextIcon, height: 22, tone: "bg-info/45" },
  { icon: WrenchIcon, height: 18, tone: "bg-warning/50" },
  { icon: MessageSquareIcon, height: 12, tone: "bg-primary/45" },
];
</script>

<!-- The context window fills layer by layer: instructions, messages, files,
     tool results. The ring beside it tracks the same share. -->
<template>
  <div class="flex items-end justify-center gap-6">
    <!-- Layers and the reveal's clip use the window's radius less its
         padding, so their corners stay concentric with it. -->
    <div
      class="ring-foreground/20 relative flex h-36 w-24 flex-col-reverse overflow-hidden rounded-2xl p-1 ring-2 [--help-inner-radius:calc(var(--radius-2xl)-0.25rem)]"
    >
      <div class="help-layers flex h-full w-full flex-col-reverse gap-px">
        <div
          v-for="(layer, index) in layers"
          :key="index"
          :class="[
            'flex shrink-0 items-center justify-center rounded-(--help-inner-radius)',
            layer.tone,
          ]"
          :style="{ height: `${layer.height}%` }"
        >
          <component :is="layer.icon" class="text-foreground/70 size-3.5" />
        </div>
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
.help-layers {
  animation: help-layers 6s ease-in-out infinite both;
}

.help-ring {
  stroke-dashoffset: 18;
  animation: help-ring 6s ease-out infinite both;
}

/* On the svg, so the track and the arc change colour together. */
.help-ring-tone {
  color: var(--destructive);
  animation: help-ring-tone 6s ease-out infinite both;
}

/* Reveals the stacked layers from the bottom up, in step with the ring. */
@keyframes help-layers {
  0% {
    clip-path: inset(100% 0 0 0 round var(--help-inner-radius));
  }
  60%,
  90% {
    clip-path: inset(0 round var(--help-inner-radius));
  }
  100% {
    clip-path: inset(100% 0 0 0 round var(--help-inner-radius));
  }
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
  .help-layers,
  .help-ring,
  .help-ring-tone {
    animation: none;
  }
}
</style>
