<script setup lang="ts">
import { CheckIcon, CloudIcon, KeyRoundIcon } from "@lucide/vue";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

const rows = ["w-16", "w-24", "w-20"];
</script>

<!-- A miniature provider list: one provider is picked, its key goes in and
     it turns Connected. -->
<template>
  <div
    class="bg-background ring-foreground/10 flex w-full max-w-xs flex-col gap-1 rounded-3xl p-2 shadow-sm ring-1"
  >
    <span
      class="text-muted-foreground px-3 pt-1.5 pb-1 text-[11px] font-medium"
    >
      {{ t("providers.picker.all") }}
    </span>
    <div
      v-for="(width, index) in rows"
      :key="index"
      :class="[
        'flex items-center gap-2 rounded-2xl px-3 py-2',
        index === 1 ? 'help-picked' : '',
      ]"
    >
      <CloudIcon class="text-muted-foreground size-3.5 shrink-0" />
      <span :class="['bg-foreground/50 h-2 rounded-full', width]" />
      <span v-if="index === 1" class="relative ms-auto flex h-5 items-center">
        <span
          class="help-key bg-warning text-background flex size-5 items-center justify-center rounded-full"
        >
          <KeyRoundIcon class="size-3" />
        </span>
        <span
          class="help-connected bg-primary/10 text-primary absolute end-0 flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium whitespace-nowrap"
        >
          <CheckIcon class="size-3" />
          {{ t("providers.connected") }}
        </span>
      </span>
    </div>
  </div>
</template>

<style scoped>
.help-picked {
  animation: help-picked 5s ease-in-out infinite both;
}

.help-key {
  animation: help-key 5s ease-in-out infinite both;
}

.help-connected {
  animation: help-connected 5s cubic-bezier(0.16, 1, 0.3, 1) infinite both;
}

@keyframes help-picked {
  0%,
  8% {
    background: transparent;
  }
  14%,
  92% {
    background: var(--accent);
  }
  100% {
    background: transparent;
  }
}

@keyframes help-key {
  0%,
  18% {
    opacity: 0;
    transform: translateX(-0.75rem);
  }
  28%,
  42% {
    opacity: 1;
    transform: none;
  }
  48%,
  100% {
    opacity: 0;
    transform: scale(0.6);
  }
}

@keyframes help-connected {
  0%,
  46% {
    opacity: 0;
    transform: scale(0.85);
  }
  54%,
  92% {
    opacity: 1;
    transform: none;
  }
  100% {
    opacity: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .help-picked,
  .help-key,
  .help-connected {
    animation: none;
  }

  .help-picked {
    background: var(--accent);
  }

  .help-key {
    opacity: 0;
  }
}
</style>
