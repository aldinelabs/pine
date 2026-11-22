<script setup lang="ts">
import {
  CheckIcon,
  FolderOpenIcon,
  RocketIcon,
  ScanEyeIcon,
  TargetIcon,
} from "@lucide/vue";

const habits = [
  { icon: TargetIcon, tone: "text-warning", width: "w-3/5" },
  { icon: FolderOpenIcon, tone: "text-info", width: "w-1/2" },
  { icon: RocketIcon, tone: "text-primary", width: "w-2/3" },
  { icon: ScanEyeIcon, tone: "text-foreground", width: "w-2/5" },
];
</script>

<!-- A task handed over well: goal, material, room to work and a check,
     each ticked off in turn. -->
<template>
  <div class="flex w-60 flex-col gap-1.5">
    <div
      v-for="(habit, index) in habits"
      :key="index"
      class="bg-background ring-foreground/10 flex items-center gap-2.5 rounded-xl px-3 py-2 shadow-sm ring-1"
    >
      <component :is="habit.icon" :class="['size-4 shrink-0', habit.tone]" />
      <span :class="['bg-foreground/25 h-1.5 rounded-full', habit.width]" />
      <CheckIcon
        class="help-tick text-primary ms-auto size-4 shrink-0"
        :style="{ animationDelay: `${index * 0.6}s` }"
      />
    </div>
  </div>
</template>

<style scoped>
.help-tick {
  animation: help-tick 4s cubic-bezier(0.16, 1, 0.3, 1) infinite both;
}

@keyframes help-tick {
  0%,
  10% {
    opacity: 0;
    transform: scale(0.5);
  }
  20%,
  85% {
    opacity: 1;
    transform: none;
  }
  100% {
    opacity: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .help-tick {
    animation: none;
  }
}
</style>
