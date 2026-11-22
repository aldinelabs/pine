<script setup lang="ts">
import {
  ArrowRightIcon,
  BrainCircuitIcon,
  CircleCheckIcon,
  HandIcon,
  TerminalIcon,
  ZapIcon,
} from "@lucide/vue";
import { useI18n } from "vue-i18n";

const { t } = useI18n();
</script>

<!-- The two paths side by side: model review sends every call to the
     approval model; the decision model screens first and hands only unclear
     calls on to it. -->
<template>
  <div class="flex w-full max-w-md flex-col gap-3 px-4 text-[11px]">
    <div
      class="bg-background ring-foreground/10 flex flex-col gap-2 rounded-2xl p-3 ring-1"
    >
      <span class="text-muted-foreground font-medium">
        {{ t("preferences.autoApprovalModel") }}
      </span>
      <div class="flex items-center gap-2">
        <span class="help-node bg-muted"><TerminalIcon class="size-4" /></span>
        <ArrowRightIcon class="text-muted-foreground size-3.5 shrink-0" />
        <span class="help-node bg-info/15 text-info">
          <BrainCircuitIcon class="size-4" />
        </span>
        <ArrowRightIcon class="text-muted-foreground size-3.5 shrink-0" />
        <span class="help-node bg-primary/15 text-primary">
          <CircleCheckIcon class="size-4" />
        </span>
      </div>
    </div>

    <div
      class="bg-background ring-foreground/10 flex flex-col gap-2 rounded-2xl p-3 ring-1"
    >
      <span class="text-muted-foreground font-medium">
        {{ t("preferences.autoApprovalDecisions") }}
      </span>
      <div class="flex items-center gap-2">
        <span class="help-node bg-muted"><TerminalIcon class="size-4" /></span>
        <ArrowRightIcon class="text-muted-foreground size-3.5 shrink-0" />
        <span class="help-node help-screen bg-warning/15 text-warning">
          <ZapIcon class="size-4" />
        </span>
        <ArrowRightIcon class="text-muted-foreground size-3.5 shrink-0" />
        <div class="flex flex-col gap-1.5">
          <span class="help-branch help-node bg-primary/15 text-primary">
            <CircleCheckIcon class="size-4" />
          </span>
          <span
            class="help-branch help-node bg-foreground/10 text-foreground"
            style="animation-delay: 1.2s"
          >
            <HandIcon class="size-4" />
          </span>
          <span
            class="help-branch help-node bg-info/15 text-info"
            style="animation-delay: 2.4s"
          >
            <BrainCircuitIcon class="size-4" />
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.help-node {
  display: flex;
  width: 2rem;
  height: 2rem;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: calc(var(--radius-2xl) - 0.75rem + 0.25rem);
}

.help-branch {
  animation: help-branch 3.6s ease-in-out infinite both;
}

@keyframes help-branch {
  0%,
  30% {
    opacity: 1;
    transform: translateX(2px);
  }
  40%,
  100% {
    opacity: 0.4;
    transform: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .help-branch {
    animation: none;
  }
}
</style>
