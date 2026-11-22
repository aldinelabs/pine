<script setup lang="ts">
import { BrainIcon, ZapIcon } from "@lucide/vue";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

const levels = ["low", "medium", "high", "xhigh"] as const;
</script>

<!-- The reasoning effort slider: further right thinks longer. The thumb
     visits each level and rests longest on Medium, the usual default. -->
<template>
  <div class="flex w-full max-w-md flex-col gap-4 px-4">
    <!-- Inset by the end icons' width plus their gap (1rem + 0.5rem) and
         without column gaps, so each label sits over its stop. -->
    <div class="grid grid-cols-4 px-6">
      <span
        v-for="level in levels"
        :key="level"
        class="text-muted-foreground truncate px-1 text-center text-[11px] font-medium"
      >
        {{ t(`models.thinkingLevels.${level}`) }}
      </span>
    </div>
    <div class="text-muted-foreground flex items-center gap-2">
      <ZapIcon class="size-4 shrink-0" aria-hidden="true" />
      <div class="bg-muted relative h-1.5 flex-1 rounded-full">
        <span
          class="help-fill bg-primary absolute inset-y-0 start-0 rounded-full"
        />
        <span class="help-thumb bg-background ring-primary ring-2" />
      </div>
      <BrainIcon class="size-4 shrink-0" aria-hidden="true" />
    </div>
  </div>
</template>

<style scoped>
.help-fill {
  width: 37.5%;
  animation: help-fill 6s cubic-bezier(0.16, 1, 0.3, 1) infinite;
}

.help-thumb {
  position: absolute;
  top: 50%;
  inset-inline-start: 37.5%;
  width: 14px;
  height: 14px;
  margin-top: -7px;
  margin-inline-start: -7px;
  border-radius: 9999px;
  animation: help-thumb 6s cubic-bezier(0.16, 1, 0.3, 1) infinite;
}

@keyframes help-thumb {
  0%,
  15% {
    inset-inline-start: 12.5%;
  }
  20%,
  50% {
    inset-inline-start: 37.5%;
  }
  55%,
  70% {
    inset-inline-start: 62.5%;
  }
  75%,
  90% {
    inset-inline-start: 87.5%;
  }
  95%,
  100% {
    inset-inline-start: 12.5%;
  }
}

@keyframes help-fill {
  0%,
  15% {
    width: 12.5%;
  }
  20%,
  50% {
    width: 37.5%;
  }
  55%,
  70% {
    width: 62.5%;
  }
  75%,
  90% {
    width: 87.5%;
  }
  95%,
  100% {
    width: 12.5%;
  }
}

@media (prefers-reduced-motion: reduce) {
  .help-fill,
  .help-thumb {
    animation: none;
  }
}
</style>
