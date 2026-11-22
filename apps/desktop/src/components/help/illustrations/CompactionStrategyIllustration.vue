<script setup lang="ts">
import { useI18n } from "vue-i18n";

const { t } = useI18n();

// Where each strategy compacts, as a share of the context window.
const strategies = [
  { label: "preferences.contextCompactionPassive", at: 96 },
  { label: "preferences.contextCompactionRecommended", at: 80 },
];
</script>

<!-- Two context windows filling up: each empties back to a short summary
     when it reaches its strategy's mark. -->
<template>
  <div class="flex w-full max-w-md flex-col gap-4 px-4 text-[11px]">
    <div
      v-for="strategy in strategies"
      :key="strategy.label"
      class="flex flex-col gap-1.5"
    >
      <span class="text-muted-foreground font-medium">
        {{ t(strategy.label) }}
      </span>
      <div class="bg-muted relative h-3 overflow-hidden rounded-full">
        <span
          class="help-fill bg-primary/60 absolute inset-y-0 start-0 rounded-full"
          :style="{ '--help-at': `${strategy.at}%` }"
        />
        <span
          class="bg-foreground absolute inset-y-0 w-0.5"
          :style="{ insetInlineStart: `${strategy.at}%` }"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.help-fill {
  width: 12%;
  animation: help-fill 5s ease-in infinite both;
}

@keyframes help-fill {
  0% {
    width: 12%;
  }
  85% {
    width: var(--help-at);
  }
  100% {
    width: 12%;
  }
}

@media (prefers-reduced-motion: reduce) {
  .help-fill {
    width: var(--help-at);
    animation: none;
  }
}
</style>
