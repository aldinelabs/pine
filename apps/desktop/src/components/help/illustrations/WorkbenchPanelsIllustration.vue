<script setup lang="ts">
import {
  EyeIcon,
  FolderTreeIcon,
  MessagesSquareIcon,
  PackageIcon,
  TerminalIcon,
} from "@lucide/vue";

const panels = [
  PackageIcon,
  EyeIcon,
  TerminalIcon,
  FolderTreeIcon,
  MessagesSquareIcon,
];
</script>

<!-- A window with the conversation on the left and the workbench on the
     right: two stacked cards, and the panels a card can switch between. -->
<template>
  <div
    class="bg-background ring-foreground/10 flex h-36 w-72 gap-2 rounded-2xl p-2 shadow-sm ring-1"
  >
    <div class="flex flex-1 flex-col justify-end gap-1.5 p-1.5">
      <span class="bg-foreground/20 h-1.5 w-4/5 rounded-full" />
      <span class="bg-foreground/20 h-1.5 w-3/5 rounded-full" />
      <span class="bg-primary/50 h-1.5 w-1/2 self-end rounded-full" />
      <span class="ring-foreground/15 mt-1 h-5 rounded-lg ring-1" />
    </div>
    <div class="flex w-32 flex-col gap-1.5">
      <div class="bg-muted flex flex-1 flex-col gap-1.5 rounded-xl p-2">
        <div class="flex gap-1">
          <component
            :is="icon"
            v-for="(icon, index) in panels"
            :key="index"
            class="help-panel text-muted-foreground size-3.5"
            :style="{ animationDelay: `${index * 0.8}s` }"
          />
        </div>
        <span class="bg-foreground/20 h-1.5 w-3/4 rounded-full" />
        <span class="bg-foreground/20 h-1.5 w-1/2 rounded-full" />
      </div>
      <div class="bg-muted flex flex-1 flex-col gap-1.5 rounded-xl p-2">
        <TerminalIcon class="text-muted-foreground size-3.5" />
        <span class="bg-foreground/20 h-1.5 w-2/3 rounded-full" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.help-panel {
  animation: help-panel 4s ease-in-out infinite both;
}

@keyframes help-panel {
  0%,
  15% {
    color: var(--primary);
    transform: translateY(-1px);
  }
  20%,
  100% {
    color: var(--muted-foreground);
    transform: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .help-panel {
    animation: none;
  }
}
</style>
