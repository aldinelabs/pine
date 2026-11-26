<script setup lang="ts">
import {
  ChevronRightIcon,
  CircleCheckIcon,
  LoaderCircleIcon,
} from "@lucide/vue";
import OrchestratorIcon from "@/components/assistant/OrchestratorIcon.vue";
</script>

<!-- The Orchestrator's conversation: a request from the user, then two
     dispatch cards pointing at sessions in two projects, one done, one
     still working. -->
<template>
  <div class="flex w-64 flex-col gap-1.5">
    <div
      class="bg-background ring-foreground/10 flex items-center gap-2 rounded-xl px-3 py-2.5 shadow-sm ring-1"
    >
      <OrchestratorIcon class="text-primary size-4 shrink-0" />
      <span class="bg-foreground/40 h-1.5 w-1/2 rounded-full" />
    </div>
    <div
      class="bg-background ring-foreground/10 flex items-center gap-2 rounded-xl px-3 py-2 ring-1"
    >
      <span class="bg-foreground/25 h-1.5 w-1/5 rounded-full" />
      <ChevronRightIcon class="text-muted-foreground size-3 shrink-0" />
      <span class="bg-foreground/25 h-1.5 w-1/4 rounded-full" />
      <CircleCheckIcon class="text-primary ms-auto size-4 shrink-0" />
    </div>
    <div
      class="bg-background ring-foreground/10 flex items-center gap-2 rounded-xl px-3 py-2 ring-1"
    >
      <span class="bg-foreground/25 h-1.5 w-1/4 rounded-full" />
      <ChevronRightIcon class="text-muted-foreground size-3 shrink-0" />
      <span class="bg-foreground/25 h-1.5 w-1/5 rounded-full" />
      <LoaderCircleIcon
        class="help-spin text-muted-foreground ms-auto size-4 shrink-0"
      />
    </div>
  </div>
</template>

<style scoped>
.help-spin {
  animation: help-spin 1.2s linear infinite;
}

@keyframes help-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .help-spin {
    animation: none;
  }
}
</style>
