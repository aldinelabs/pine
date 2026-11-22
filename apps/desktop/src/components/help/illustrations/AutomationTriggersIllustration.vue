<script setup lang="ts">
import {
  ArrowRightIcon,
  ClockIcon,
  FolderSyncIcon,
  MonitorIcon,
  RssIcon,
  WorkflowIcon,
} from "@lucide/vue";

const triggers = [ClockIcon, FolderSyncIcon, MonitorIcon, RssIcon];
</script>

<!-- The four kinds of trigger light up in turn, each starting the same
     automation. -->
<template>
  <div class="flex items-center justify-center gap-3 sm:gap-5">
    <div class="grid grid-cols-2 gap-2">
      <span
        v-for="(icon, index) in triggers"
        :key="index"
        class="help-trigger bg-background ring-foreground/10 text-muted-foreground flex size-12 items-center justify-center rounded-xl shadow-sm ring-1"
        :style="{ animationDelay: `${index * 1.2}s` }"
      >
        <component :is="icon" class="size-5" />
      </span>
    </div>
    <ArrowRightIcon class="text-muted-foreground size-5 shrink-0" />
    <span
      class="bg-primary/15 text-primary flex size-16 items-center justify-center rounded-2xl"
    >
      <WorkflowIcon class="size-7" />
    </span>
  </div>
</template>

<style scoped>
.help-trigger {
  animation: help-trigger 4.8s ease-in-out infinite both;
}

@keyframes help-trigger {
  0%,
  20% {
    color: var(--primary);
    transform: scale(1.06);
  }
  25%,
  100% {
    color: var(--muted-foreground);
    transform: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .help-trigger {
    animation: none;
  }
}
</style>
