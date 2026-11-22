<script setup lang="ts">
import { CircleDashedIcon, PencilIcon } from "@lucide/vue";

const notes = [
  { width: "w-2/3", verified: true },
  { width: "w-1/2", verified: false },
  { width: "w-3/4", verified: true },
];
</script>

<!-- The Memory manager: a list of notes, one still unverified, each with
     its edit button. -->
<template>
  <div
    class="bg-background ring-foreground/10 flex w-64 flex-col gap-1 rounded-2xl p-1.5 shadow-sm ring-1"
  >
    <div
      v-for="(note, index) in notes"
      :key="index"
      :class="[
        'flex items-center gap-2.5 rounded-xl px-2.5 py-2',
        note.verified ? '' : 'help-unverified bg-warning/10',
      ]"
    >
      <span class="flex flex-1 flex-col gap-1">
        <span :class="['bg-foreground/35 h-1.5 rounded-full', note.width]" />
        <span class="bg-foreground/15 h-1.5 w-full rounded-full" />
      </span>
      <CircleDashedIcon
        v-if="!note.verified"
        class="text-warning size-4 shrink-0"
      />
      <PencilIcon class="text-muted-foreground size-3.5 shrink-0" />
    </div>
  </div>
</template>

<style scoped>
.help-unverified {
  animation: help-unverified 3s ease-in-out infinite both;
}

@keyframes help-unverified {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.6;
  }
}

@media (prefers-reduced-motion: reduce) {
  .help-unverified {
    animation: none;
  }
}
</style>
