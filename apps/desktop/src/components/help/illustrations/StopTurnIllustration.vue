<script setup lang="ts">
import { CheckIcon, LoaderCircleIcon, SquareIcon } from "@lucide/vue";
import { useI18n } from "vue-i18n";

const { t } = useI18n();
</script>

<!-- The Stop button is pressed: the step that was running is marked Stopped,
     while the finished step above keeps its check mark. -->
<template>
  <div class="flex items-center justify-center gap-5">
    <div
      class="bg-background ring-foreground/10 flex w-52 flex-col gap-2.5 rounded-3xl p-4 shadow-sm ring-1"
    >
      <div class="flex items-center gap-2">
        <CheckIcon class="text-primary size-3.5 shrink-0" />
        <span class="bg-foreground/40 h-2 w-24 rounded-full" />
      </div>
      <div class="relative flex h-4 items-center gap-2">
        <span class="help-running flex items-center gap-2">
          <LoaderCircleIcon
            class="help-spin text-muted-foreground size-3.5 shrink-0"
          />
          <span class="bg-foreground/40 h-2 w-20 rounded-full" />
        </span>
        <span
          class="help-stopped text-muted-foreground absolute inset-y-0 start-0 flex items-center gap-2 text-[11px] font-medium"
        >
          <SquareIcon class="size-3.5 shrink-0" />
          <span class="bg-foreground/40 h-2 w-20 rounded-full" />
          · {{ t("project.transcript.stopped") }}
        </span>
      </div>
    </div>
    <span
      class="help-stop bg-foreground text-background flex size-11 shrink-0 items-center justify-center rounded-full"
    >
      <SquareIcon class="size-4 fill-current" />
    </span>
  </div>
</template>

<style scoped>
.help-spin {
  animation: help-spin 1s linear infinite;
}

.help-running {
  animation: help-running 4s ease-in-out infinite both;
}

.help-stopped {
  animation: help-stopped 4s ease-in-out infinite both;
}

.help-stop {
  animation: help-stop 4s ease-in-out infinite;
}

@keyframes help-spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes help-running {
  0%,
  42% {
    opacity: 1;
  }
  48%,
  92% {
    opacity: 0;
  }
  100% {
    opacity: 1;
  }
}

@keyframes help-stopped {
  0%,
  42% {
    opacity: 0;
  }
  48%,
  92% {
    opacity: 1;
  }
  100% {
    opacity: 0;
  }
}

@keyframes help-stop {
  0%,
  32%,
  48%,
  100% {
    transform: scale(1);
  }
  40% {
    transform: scale(0.88);
  }
}

@media (prefers-reduced-motion: reduce) {
  .help-spin,
  .help-running,
  .help-stopped,
  .help-stop {
    animation: none;
  }

  .help-running {
    opacity: 0;
  }
}
</style>
