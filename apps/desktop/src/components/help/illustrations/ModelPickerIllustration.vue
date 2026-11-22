<script setup lang="ts">
import { SearchIcon, SparklesIcon } from "@lucide/vue";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

/** Rows of a miniature model picker; the first two are recommended. */
const rows = [
  { width: "w-20", recommended: true },
  { width: "w-24", recommended: true },
  { width: "w-16", recommended: false },
];
</script>

<!-- A miniature model picker: the Recommended group on top, the choice
     moving down the list. -->
<template>
  <div
    class="bg-background ring-foreground/10 flex w-full max-w-xs flex-col gap-1 rounded-3xl p-2 shadow-sm ring-1"
  >
    <div
      class="bg-muted text-muted-foreground flex items-center gap-2 rounded-2xl px-3 py-2"
    >
      <SearchIcon class="size-3.5 shrink-0" />
      <span class="bg-foreground/15 h-1.5 w-24 rounded-full" />
    </div>
    <span class="text-muted-foreground px-3 pt-1.5 text-[11px] font-medium">
      {{ t("models.recommended") }}
    </span>
    <div
      v-for="(row, index) in rows"
      :key="index"
      class="help-row flex items-center gap-2 rounded-2xl px-3 py-2"
      :style="{ animationDelay: `${index * 1.5}s` }"
    >
      <SparklesIcon class="text-primary size-3.5 shrink-0" />
      <span :class="['bg-foreground/60 h-2 rounded-full', row.width]" />
      <span
        v-if="row.recommended"
        class="bg-primary/10 text-primary ms-auto rounded-full px-2 py-0.5 text-[10px] font-medium"
      >
        {{ t("models.picker.recommended") }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.help-row {
  animation: help-row 4.5s ease-in-out infinite both;
}

@keyframes help-row {
  0%,
  30%,
  100% {
    background: transparent;
  }
  5%,
  25% {
    background: var(--accent);
  }
}

@media (prefers-reduced-motion: reduce) {
  .help-row {
    animation: none;
  }

  .help-row:first-of-type {
    background: var(--accent);
  }
}
</style>
