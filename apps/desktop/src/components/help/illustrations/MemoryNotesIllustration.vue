<script setup lang="ts">
import { ArrowRightIcon, FolderIcon, GlobeIcon } from "@lucide/vue";
</script>

<!-- A message asking Pine to remember becomes a note, filed either with the
     project or for every project. -->
<template>
  <div class="flex items-center justify-center gap-3 sm:gap-5">
    <div
      class="bg-primary text-primary-foreground flex w-28 flex-col gap-1.5 rounded-2xl rounded-br-md p-3 shadow-sm"
    >
      <span class="bg-primary-foreground/70 h-1.5 w-1/2 rounded-full" />
      <span class="bg-primary-foreground/40 h-1.5 w-full rounded-full" />
      <span class="bg-primary-foreground/40 h-1.5 w-3/4 rounded-full" />
    </div>

    <ArrowRightIcon class="text-muted-foreground size-5 shrink-0" />

    <div class="flex flex-col gap-2">
      <div
        v-for="(note, index) in [
          { icon: FolderIcon, tone: 'text-info' },
          { icon: GlobeIcon, tone: 'text-warning' },
        ]"
        :key="index"
        class="help-note bg-background ring-foreground/10 flex w-32 items-center gap-2 rounded-xl p-2.5 shadow-sm ring-1"
        :style="{ animationDelay: `${index * 1.5}s` }"
      >
        <component :is="note.icon" :class="['size-4 shrink-0', note.tone]" />
        <span class="flex flex-1 flex-col gap-1">
          <span class="bg-foreground/30 h-1.5 w-3/4 rounded-full" />
          <span class="bg-foreground/15 h-1.5 w-full rounded-full" />
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.help-note {
  animation: help-note 3s ease-in-out infinite both;
}

@keyframes help-note {
  0%,
  45% {
    transform: translateX(3px);
    opacity: 1;
  }
  55%,
  100% {
    transform: none;
    opacity: 0.55;
  }
}

@media (prefers-reduced-motion: reduce) {
  .help-note {
    animation: none;
  }
}
</style>
