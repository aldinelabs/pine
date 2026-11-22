<script setup lang="ts">
import { ArrowRightIcon, BookMarkedIcon } from "@lucide/vue";

const shelf = ["text-info", "text-primary", "text-warning"];
</script>

<!-- A task comes in, and the Skill whose description matches it lifts off
     the shelf. -->
<template>
  <div class="flex items-center justify-center gap-3 sm:gap-5">
    <div
      class="bg-primary text-primary-foreground flex w-24 flex-col gap-1.5 rounded-2xl rounded-br-md p-3 shadow-sm"
    >
      <span class="bg-primary-foreground/70 h-1.5 w-3/4 rounded-full" />
      <span class="bg-primary-foreground/40 h-1.5 w-full rounded-full" />
    </div>

    <ArrowRightIcon class="text-muted-foreground size-5 shrink-0" />

    <div class="flex items-end gap-2">
      <div
        v-for="(tone, index) in shelf"
        :key="tone"
        :class="[
          'bg-background ring-foreground/10 flex h-24 w-12 flex-col items-center gap-2 rounded-xl px-2 pt-3 shadow-sm ring-1',
          index === 1 ? 'help-pick' : '',
        ]"
      >
        <BookMarkedIcon :class="['size-5', tone]" />
        <span class="bg-foreground/20 h-1 w-full rounded-full" />
        <span class="bg-foreground/20 h-1 w-2/3 rounded-full" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.help-pick {
  animation: help-pick 3.5s cubic-bezier(0.16, 1, 0.3, 1) infinite both;
}

@keyframes help-pick {
  0%,
  25% {
    transform: none;
  }
  40%,
  80% {
    transform: translateY(-12px);
    box-shadow: 0 8px 20px -8px
      color-mix(in oklch, var(--foreground) 30%, transparent);
  }
  100% {
    transform: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .help-pick {
    animation: none;
  }
}
</style>
