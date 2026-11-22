<script setup lang="ts">
import { UsersIcon, ZapIcon } from "@lucide/vue";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

const tones = [
  "preferences.userProfileStyleCalm",
  "preferences.userProfileStyleNeutral",
  "preferences.userProfileStyleWarm",
];
</script>

<!-- The work style switch sliding between Full takeover and Collaborate,
     above the three communication styles. -->
<template>
  <div class="flex w-full max-w-sm flex-col items-center gap-4 px-4 text-xs">
    <div
      class="bg-muted relative grid w-full grid-cols-2 rounded-2xl p-1 font-medium"
    >
      <span
        class="help-thumb bg-background ring-foreground/10 absolute inset-y-1 start-1 w-[calc(50%-0.25rem)] rounded-xl shadow-sm ring-1"
      />
      <span class="relative flex items-center justify-center gap-1.5 py-2">
        <ZapIcon class="text-primary size-4" />
        {{ t("preferences.userProfileWorkStyleTakeover") }}
      </span>
      <span class="relative flex items-center justify-center gap-1.5 py-2">
        <UsersIcon class="text-info size-4" />
        {{ t("preferences.userProfileWorkStyleCollaborate") }}
      </span>
    </div>
    <div class="flex flex-wrap justify-center gap-1.5">
      <span
        v-for="tone in tones"
        :key="tone"
        class="ring-foreground/15 text-muted-foreground rounded-full px-2.5 py-1 ring-1"
      >
        {{ t(tone) }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.help-thumb {
  animation: help-thumb 5s cubic-bezier(0.16, 1, 0.3, 1) infinite both;
}

@keyframes help-thumb {
  0%,
  40% {
    transform: none;
  }
  50%,
  90% {
    transform: translateX(100%);
  }
  100% {
    transform: none;
  }
}

:dir(rtl) .help-thumb {
  animation-name: help-thumb-rtl;
}

@keyframes help-thumb-rtl {
  0%,
  40% {
    transform: none;
  }
  50%,
  90% {
    transform: translateX(-100%);
  }
  100% {
    transform: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .help-thumb {
    animation: none;
  }
}
</style>
