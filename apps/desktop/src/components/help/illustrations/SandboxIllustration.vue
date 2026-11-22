<script setup lang="ts">
import {
  FolderIcon,
  FolderLockIcon,
  ShieldCheckIcon,
  TerminalIcon,
} from "@lucide/vue";
</script>

<!-- Commands run inside the sandbox around the project's folders. Reaching
     for a folder outside stops at the edge, where the approval check
     decides. -->
<template>
  <div class="flex items-center justify-center gap-4">
    <div
      class="border-primary/40 flex items-center gap-3 rounded-3xl border-2 border-dashed p-4"
    >
      <div
        class="bg-background ring-foreground/10 flex size-11 items-center justify-center rounded-xl shadow-sm ring-1"
      >
        <TerminalIcon class="text-foreground size-5" />
      </div>
      <div class="flex flex-col gap-1.5">
        <FolderIcon class="text-info size-5" />
        <FolderIcon class="text-info size-5" />
      </div>
    </div>

    <div class="help-track">
      <span class="help-dot bg-primary" />
      <span class="help-shield text-warning">
        <ShieldCheckIcon class="size-6" />
      </span>
    </div>

    <div
      class="bg-muted text-muted-foreground flex size-11 items-center justify-center rounded-xl"
    >
      <FolderLockIcon class="size-5" />
    </div>
  </div>
</template>

<style scoped>
.help-track {
  position: relative;
  width: 3.5rem;
  height: 2px;
  border-radius: 9999px;
  background: color-mix(in oklab, var(--foreground) 12%, transparent);
}

.help-dot {
  position: absolute;
  top: 50%;
  left: 0;
  width: 8px;
  height: 8px;
  margin-top: -4px;
  border-radius: 9999px;
  animation: help-dot 4s ease-in-out infinite both;
}

.help-shield {
  position: absolute;
  top: 50%;
  left: 50%;
  margin: -12px 0 0 -12px;
  animation: help-shield 4s cubic-bezier(0.16, 1, 0.3, 1) infinite both;
}

@keyframes help-dot {
  0% {
    left: 0;
    opacity: 0;
  }
  8% {
    opacity: 1;
  }
  35%,
  45% {
    left: calc(50% - 16px);
    opacity: 1;
  }
  55%,
  100% {
    left: calc(50% - 16px);
    opacity: 0;
  }
}

@keyframes help-shield {
  0%,
  35% {
    opacity: 0;
    transform: scale(0.6);
  }
  45%,
  85% {
    opacity: 1;
    transform: none;
  }
  100% {
    opacity: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .help-dot,
  .help-shield {
    animation: none;
  }

  .help-dot {
    left: calc(50% - 16px);
  }
}
</style>
