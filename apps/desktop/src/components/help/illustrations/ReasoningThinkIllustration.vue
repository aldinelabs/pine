<script setup lang="ts">
import { BrainIcon, ChevronDownIcon } from "@lucide/vue";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

const thoughts = ["w-11/12", "w-4/5", "w-3/5"];
const answer = ["w-full", "w-5/6"];
</script>

<!-- The model thinks first (faint lines under the reasoning marker), then
     writes the answer. -->
<template>
  <div
    class="bg-background ring-foreground/10 flex w-full max-w-xs flex-col gap-3 rounded-3xl p-4 shadow-sm ring-1"
  >
    <div class="text-muted-foreground flex items-center gap-1.5 text-[11px]">
      <BrainIcon class="size-3.5 shrink-0" />
      <span class="font-medium">
        {{ t("project.transcript.thinkingComplete", { duration: "12s" }) }}
      </span>
      <ChevronDownIcon class="size-3.5 shrink-0" />
    </div>
    <div class="border-foreground/10 flex flex-col gap-1.5 border-s-2 ps-3">
      <span
        v-for="(width, index) in thoughts"
        :key="index"
        :class="['help-line bg-foreground/15 h-1.5 rounded-full', width]"
        :style="{ animationDelay: `${index * 0.5}s` }"
      />
    </div>
    <div class="flex flex-col gap-1.5">
      <span
        v-for="(width, index) in answer"
        :key="index"
        :class="['help-line bg-foreground/60 h-2 rounded-full', width]"
        :style="{ animationDelay: `${1.8 + index * 0.4}s` }"
      />
    </div>
  </div>
</template>

<style scoped>
.help-line {
  transform-origin: left center;
  animation: help-line 5s cubic-bezier(0.16, 1, 0.3, 1) infinite both;
}

@keyframes help-line {
  0% {
    opacity: 0;
    transform: scaleX(0.2);
  }
  10%,
  85% {
    opacity: 1;
    transform: none;
  }
  100% {
    opacity: 0;
    transform: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .help-line {
    animation: none;
  }
}
</style>
