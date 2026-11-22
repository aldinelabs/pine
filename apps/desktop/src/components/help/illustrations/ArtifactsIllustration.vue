<script setup lang="ts">
import {
  ChevronDownIcon,
  ClockIcon,
  FileTextIcon,
  FolderIcon,
  SheetIcon,
} from "@lucide/vue";
</script>

<!-- The Artifacts list: a folder of deliverables, one with several kept
     versions, and a file at the top level. -->
<template>
  <div
    class="bg-background ring-foreground/10 flex w-64 flex-col gap-0.5 rounded-2xl p-1.5 text-[11px] shadow-sm ring-1"
  >
    <div class="flex items-center gap-2 rounded-xl px-2.5 py-1.5">
      <ChevronDownIcon class="text-muted-foreground size-3.5 shrink-0" />
      <FolderIcon class="text-muted-foreground size-4 shrink-0" />
      <span class="bg-foreground/35 h-1.5 w-1/3 rounded-full" />
    </div>
    <div class="help-new flex items-center gap-2 rounded-xl px-2.5 py-1.5 ps-8">
      <FileTextIcon class="text-info size-4 shrink-0" />
      <span class="bg-foreground/30 h-1.5 w-2/5 rounded-full" />
      <span
        class="bg-muted text-muted-foreground ms-auto flex items-center gap-0.5 rounded-full px-1.5 py-0.5 tabular-nums"
      >
        <ClockIcon class="size-3" />3
      </span>
    </div>
    <div class="flex items-center gap-2 rounded-xl px-2.5 py-1.5 ps-8">
      <SheetIcon class="text-primary size-4 shrink-0" />
      <span class="bg-foreground/30 h-1.5 w-1/2 rounded-full" />
    </div>
    <div class="flex items-center gap-2 rounded-xl px-2.5 py-1.5">
      <FileTextIcon class="text-warning ms-5.5 size-4 shrink-0" />
      <span class="bg-foreground/30 h-1.5 w-1/3 rounded-full" />
    </div>
  </div>
</template>

<style scoped>
.help-new {
  animation: help-new 3.5s ease-in-out infinite both;
}

@keyframes help-new {
  0%,
  40% {
    background-color: var(--accent);
  }
  60%,
  100% {
    background-color: transparent;
  }
}

@media (prefers-reduced-motion: reduce) {
  .help-new {
    animation: none;
  }
}
</style>
