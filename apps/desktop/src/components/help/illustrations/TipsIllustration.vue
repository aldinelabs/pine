<script setup lang="ts">
import { CheckIcon, LightbulbIcon } from "@lucide/vue";

const lines = [78, 64, 86];
</script>

<!-- A short checklist ticking itself off: the closing "good habits" step. -->
<template>
  <div class="flex items-center justify-center gap-5">
    <div
      class="bg-warning/15 text-warning flex size-16 items-center justify-center rounded-full"
    >
      <LightbulbIcon class="size-8" />
    </div>
    <div class="flex w-40 flex-col gap-2.5">
      <div
        v-for="(width, index) in lines"
        :key="index"
        class="flex items-center gap-2"
      >
        <span
          class="help-check bg-primary text-primary-foreground flex size-4 shrink-0 items-center justify-center rounded-full"
          :style="{ animationDelay: `${0.4 + index * 0.6}s` }"
        >
          <CheckIcon class="size-3" />
        </span>
        <span
          class="bg-foreground/20 h-2 rounded-full"
          :style="{ width: `${width}%` }"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.help-check {
  animation: help-check 0.6s cubic-bezier(0.16, 1, 0.3, 1) both;
}

@keyframes help-check {
  0% {
    opacity: 0;
    transform: scale(0.4);
  }
  100% {
    opacity: 1;
    transform: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .help-check {
    animation: none;
  }
}
</style>
