<script setup lang="ts">
import {
  FileCodeIcon,
  GitCommitHorizontalIcon,
  SparklesIcon,
  TargetIcon,
} from "@lucide/vue";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

const prose = [88, 72, 94, 60];
</script>

<!-- The same history compacted two ways: the model writes a summary in
     prose; the semantic algorithm picks out goals, files and commits. -->
<template>
  <div class="flex w-full max-w-md gap-3 px-4 text-[11px]">
    <div
      class="bg-background ring-foreground/10 flex flex-1 flex-col gap-2 rounded-2xl p-3 ring-1"
    >
      <span class="text-muted-foreground flex items-center gap-1.5 font-medium">
        <SparklesIcon class="text-primary size-3.5 shrink-0" />
        {{ t("preferences.contextCompactionRouteModel") }}
      </span>
      <span
        v-for="(width, index) in prose"
        :key="index"
        class="help-write bg-foreground/20 h-1.5 rounded-full"
        :style="{ width: `${width}%`, animationDelay: `${index * 0.4}s` }"
      />
    </div>
    <div
      class="bg-background ring-foreground/10 flex flex-1 flex-col gap-2 rounded-2xl p-3 ring-1"
    >
      <span class="text-muted-foreground font-medium">
        {{ t("preferences.contextCompactionRouteSemantic") }}
      </span>
      <span class="text-muted-foreground flex items-center gap-1.5">
        <TargetIcon class="text-warning size-3.5 shrink-0" />
        <span class="bg-foreground/20 h-1.5 flex-1 rounded-full" />
      </span>
      <span class="text-muted-foreground flex items-center gap-1.5">
        <FileCodeIcon class="text-info size-3.5 shrink-0" />
        <span class="bg-foreground/20 h-1.5 w-2/3 rounded-full" />
      </span>
      <span class="text-muted-foreground flex items-center gap-1.5">
        <GitCommitHorizontalIcon class="text-primary size-3.5 shrink-0" />
        <span class="bg-foreground/20 h-1.5 w-3/4 rounded-full" />
      </span>
    </div>
  </div>
</template>

<style scoped>
.help-write {
  transform-origin: left;
  animation: help-write 4s ease-out infinite both;
}

@keyframes help-write {
  0% {
    transform: scaleX(0);
  }
  30%,
  100% {
    transform: scaleX(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .help-write {
    animation: none;
  }
}
</style>
