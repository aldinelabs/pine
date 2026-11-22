<script setup lang="ts">
import { CornerDownRightIcon, SparklesIcon } from "@lucide/vue";
import { useI18n } from "vue-i18n";

const { t } = useI18n();
</script>

<!-- While Pine works, a new message waits above the text box with Withdraw
     and Send now, then joins the conversation at the next step. -->
<template>
  <div
    class="bg-background ring-foreground/10 flex w-full max-w-xs flex-col gap-3 rounded-3xl p-4 shadow-sm ring-1"
  >
    <div class="flex items-center gap-2">
      <SparklesIcon class="help-working text-primary size-3.5 shrink-0" />
      <span class="bg-foreground/50 h-2 w-28 rounded-full" />
    </div>
    <div class="flex flex-col gap-1.5">
      <span class="bg-foreground/15 h-1.5 w-full rounded-full" />
      <span class="bg-foreground/15 h-1.5 w-3/4 rounded-full" />
    </div>
    <div class="help-staged flex flex-col items-end gap-1.5">
      <div
        class="bg-primary/10 text-primary flex items-center gap-1.5 rounded-2xl px-3 py-2"
      >
        <CornerDownRightIcon class="size-3.5 shrink-0" />
        <span class="bg-primary/60 h-1.5 w-24 rounded-full" />
      </div>
      <div class="flex gap-1.5">
        <span
          class="ring-foreground/15 text-muted-foreground rounded-full px-2 py-0.5 text-[10px] font-medium ring-1"
        >
          {{ t("project.composer.withdrawSteeringLabel") }}
        </span>
        <span
          class="ring-foreground/15 text-muted-foreground rounded-full px-2 py-0.5 text-[10px] font-medium ring-1"
        >
          {{ t("project.composer.sendSteeringNowLabel") }}
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.help-working {
  animation: help-working 1.5s ease-in-out infinite;
}

.help-staged {
  animation: help-staged 5s cubic-bezier(0.16, 1, 0.3, 1) infinite both;
}

@keyframes help-working {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.4;
  }
}

@keyframes help-staged {
  0%,
  8% {
    opacity: 0;
    transform: translateY(1rem);
  }
  20%,
  75% {
    opacity: 1;
    transform: none;
  }
  90%,
  100% {
    opacity: 0;
    transform: translateY(-0.75rem);
  }
}

@media (prefers-reduced-motion: reduce) {
  .help-working,
  .help-staged {
    animation: none;
  }
}
</style>
