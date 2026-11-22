<script setup lang="ts">
import { BellIcon, CircleCheckIcon, LoaderCircleIcon } from "@lucide/vue";
</script>

<!-- A session with two sub-sessions indented under it: one done, one still
     working, and a notice travelling back to the parent. -->
<template>
  <div class="flex w-64 flex-col gap-1.5">
    <div
      class="bg-background ring-foreground/10 flex items-center gap-2 rounded-xl px-3 py-2.5 shadow-sm ring-1"
    >
      <span class="bg-foreground/40 h-1.5 w-1/2 rounded-full" />
      <BellIcon class="help-bell text-primary ms-auto size-4 shrink-0" />
    </div>
    <div class="border-foreground/20 ms-4 flex flex-col gap-1.5 border-s ps-3">
      <div
        class="bg-background ring-foreground/10 flex items-center gap-2 rounded-xl px-3 py-2 ring-1"
      >
        <span class="bg-foreground/25 h-1.5 w-2/5 rounded-full" />
        <CircleCheckIcon class="text-primary ms-auto size-4 shrink-0" />
      </div>
      <div
        class="bg-background ring-foreground/10 flex items-center gap-2 rounded-xl px-3 py-2 ring-1"
      >
        <span class="bg-foreground/25 h-1.5 w-1/3 rounded-full" />
        <LoaderCircleIcon
          class="help-spin text-muted-foreground ms-auto size-4 shrink-0"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.help-bell {
  transform-origin: top center;
  animation: help-bell 3s ease-in-out infinite both;
}

.help-spin {
  animation: help-spin 1.2s linear infinite;
}

@keyframes help-bell {
  0%,
  70%,
  100% {
    transform: none;
  }
  78% {
    transform: rotate(14deg);
  }
  86% {
    transform: rotate(-12deg);
  }
  94% {
    transform: rotate(6deg);
  }
}

@keyframes help-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .help-bell,
  .help-spin {
    animation: none;
  }
}
</style>
