<script setup lang="ts">
import { ShieldAlertIcon } from "@lucide/vue";
import { useI18n } from "vue-i18n";

const { t } = useI18n();
</script>

<!-- A miniature approval card; each choice lights up in turn. -->
<template>
  <div
    class="bg-background ring-foreground/10 flex w-full max-w-sm flex-col gap-3 rounded-3xl p-4 shadow-sm ring-1"
  >
    <div class="flex items-center gap-2">
      <ShieldAlertIcon class="text-warning size-4 shrink-0" />
      <span class="bg-foreground/70 h-2 w-32 rounded-full" />
    </div>
    <div class="flex flex-col gap-1.5">
      <span class="bg-foreground/15 h-1.5 w-full rounded-full" />
      <span class="bg-foreground/15 h-1.5 w-4/5 rounded-full" />
    </div>
    <div
      class="bg-muted text-muted-foreground truncate rounded-lg px-2 py-1 font-mono text-[11px]"
    >
      rm -r ~/Downloads/old-drafts
    </div>
    <div class="flex flex-wrap gap-1.5">
      <span
        class="help-choice bg-primary text-primary-foreground rounded-full px-2.5 py-1 text-[11px] font-medium"
      >
        {{ t("project.approvalRequest.approve") }}
      </span>
      <span
        class="help-choice ring-foreground/15 rounded-full px-2.5 py-1 text-[11px] font-medium ring-1"
        style="animation-delay: 1.5s"
      >
        {{ t("project.approvalRequest.reject") }}
      </span>
      <span
        class="help-choice ring-foreground/15 rounded-full px-2.5 py-1 text-[11px] font-medium ring-1"
        style="animation-delay: 3s"
      >
        {{ t("project.approvalRequest.guide") }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.help-choice {
  animation: help-choice 4.5s ease-in-out infinite both;
}

@keyframes help-choice {
  0%,
  30%,
  100% {
    opacity: 0.55;
    transform: none;
  }
  8%,
  22% {
    opacity: 1;
    transform: translateY(-2px);
    box-shadow: 0 0 0 3px color-mix(in oklab, var(--ring) 40%, transparent);
  }
}

@media (prefers-reduced-motion: reduce) {
  .help-choice {
    animation: none;
  }
}
</style>
