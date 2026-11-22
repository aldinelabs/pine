<script setup lang="ts">
import {
  CircleXIcon,
  MinusIcon,
  SparklesIcon,
  WorkflowIcon,
} from "@lucide/vue";

const runs = [
  { icon: SparklesIcon, tone: "text-primary", width: "w-3/5" },
  { icon: MinusIcon, tone: "text-muted-foreground", width: "w-2/5" },
  { icon: CircleXIcon, tone: "text-destructive", width: "w-1/2" },
];
</script>

<!-- The Activity list: runs that found something, found nothing new, or
     failed, each a session of its own. -->
<template>
  <div
    class="bg-background ring-foreground/10 flex w-64 flex-col gap-1 rounded-2xl p-1.5 shadow-sm ring-1"
  >
    <div
      v-for="(run, index) in runs"
      :key="index"
      :class="[
        'flex items-center gap-2.5 rounded-xl px-2.5 py-2',
        index === 0 ? 'help-latest' : '',
      ]"
    >
      <WorkflowIcon class="text-muted-foreground size-4 shrink-0" />
      <span class="flex flex-1 flex-col gap-1">
        <span :class="['bg-foreground/35 h-1.5 rounded-full', run.width]" />
        <span class="bg-foreground/15 h-1.5 w-full rounded-full" />
      </span>
      <component :is="run.icon" :class="['size-4 shrink-0', run.tone]" />
    </div>
  </div>
</template>

<style scoped>
.help-latest {
  animation: help-latest 3.5s ease-in-out infinite both;
}

@keyframes help-latest {
  0%,
  40% {
    background-color: var(--accent);
  }
  60%,
  100% {
    background-color: transparent;
  }
}

@media (prefers-reduced-motion: reduce) {
  .help-latest {
    animation: none;
  }
}
</style>
