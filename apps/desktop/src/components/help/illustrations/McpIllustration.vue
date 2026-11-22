<script setup lang="ts">
import {
  BlocksIcon,
  CloudIcon,
  DatabaseIcon,
  SquareKanbanIcon,
} from "@lucide/vue";

const servers = [
  { icon: DatabaseIcon, tone: "text-info" },
  { icon: SquareKanbanIcon, tone: "text-warning" },
  { icon: CloudIcon, tone: "text-primary" },
];
</script>

<!-- Three MCP servers plugged into Pine, a signal running along each
     connection in turn. -->
<template>
  <div class="flex items-center justify-center gap-2">
    <div class="flex flex-col gap-2">
      <div
        v-for="(server, index) in servers"
        :key="index"
        class="flex items-center gap-2"
      >
        <span
          class="bg-background ring-foreground/10 flex size-10 items-center justify-center rounded-xl shadow-sm ring-1"
        >
          <component :is="server.icon" :class="['size-5', server.tone]" />
        </span>
        <span class="bg-foreground/15 relative h-0.5 w-16 overflow-hidden">
          <span
            class="help-signal bg-primary absolute inset-y-0 w-4 rounded-full"
            :style="{ animationDelay: `${index * 0.9}s` }"
          />
        </span>
      </div>
    </div>
    <span
      class="bg-background ring-foreground/10 flex size-14 items-center justify-center rounded-2xl shadow-sm ring-1"
    >
      <BlocksIcon class="text-foreground size-6" />
    </span>
  </div>
</template>

<style scoped>
.help-signal {
  left: -1rem;
  animation: help-signal 2.7s ease-in-out infinite both;
}

@keyframes help-signal {
  0% {
    left: -1rem;
  }
  33%,
  100% {
    left: 100%;
  }
}

@media (prefers-reduced-motion: reduce) {
  .help-signal {
    display: none;
  }
}
</style>
