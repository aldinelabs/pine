<script setup lang="ts">
import {
  BrainCircuitIcon,
  HandIcon,
  ShieldCheckIcon,
  ShieldIcon,
  ShieldOffIcon,
  ZapIcon,
} from "@lucide/vue";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

// The composer's own icons and colours for each mode, from most to least
// supervised.
const modes = [
  {
    icon: ShieldIcon,
    tone: "text-warning",
    label: "project.composer.approval.askForPermissionLabel",
  },
  {
    icon: ShieldCheckIcon,
    tone: "text-foreground",
    label: "project.composer.approval.agentDecidesLabel",
  },
  {
    icon: BrainCircuitIcon,
    tone: "text-info",
    label: "project.composer.approval.autonomousLabel",
  },
  {
    icon: ShieldOffIcon,
    tone: "text-destructive",
    label: "project.composer.approval.yoloLabel",
  },
];
</script>

<!-- A dial from "you decide" to "the agent decides": a marker steps across
     the four modes. -->
<template>
  <div class="flex w-full max-w-md flex-col gap-4 px-4">
    <div class="grid grid-cols-4 gap-2">
      <div
        v-for="(mode, index) in modes"
        :key="mode.label"
        class="help-mode flex flex-col items-center gap-1.5 text-center"
        :style="{ animationDelay: `${index * 1.5}s` }"
      >
        <div
          class="help-mode-icon bg-background ring-foreground/10 flex size-11 items-center justify-center rounded-2xl ring-1"
        >
          <component :is="mode.icon" :class="['size-5', mode.tone]" />
        </div>
        <span
          :class="[
            'line-clamp-2 text-[11px] leading-tight font-medium',
            mode.tone,
          ]"
        >
          {{ t(mode.label) }}
        </span>
      </div>
    </div>

    <div class="text-muted-foreground flex items-center gap-2">
      <HandIcon class="size-4 shrink-0" aria-hidden="true" />
      <div
        class="relative h-1.5 flex-1 rounded-full bg-[linear-gradient(to_right,var(--warning),var(--foreground)_40%,var(--info)_65%,var(--destructive))] opacity-60"
      >
        <span class="help-thumb bg-background ring-foreground/30 ring-2" />
      </div>
      <ZapIcon class="size-4 shrink-0" aria-hidden="true" />
    </div>
  </div>
</template>

<style scoped>
.help-mode {
  animation: help-mode 6s ease-in-out infinite both;
}

.help-thumb {
  position: absolute;
  top: 50%;
  left: 12.5%;
  width: 14px;
  height: 14px;
  margin: -7px 0 0 -7px;
  border-radius: 9999px;
  animation: help-thumb 6s cubic-bezier(0.16, 1, 0.3, 1) infinite;
}

@keyframes help-mode {
  0%,
  25% {
    opacity: 1;
    transform: translateY(-2px);
  }
  30%,
  95% {
    opacity: 0.45;
    transform: none;
  }
  100% {
    opacity: 1;
    transform: translateY(-2px);
  }
}

@keyframes help-thumb {
  0%,
  20% {
    left: 12.5%;
  }
  25%,
  45% {
    left: 37.5%;
  }
  50%,
  70% {
    left: 62.5%;
  }
  75%,
  95% {
    left: 87.5%;
  }
  100% {
    left: 12.5%;
  }
}

@media (prefers-reduced-motion: reduce) {
  .help-mode,
  .help-thumb {
    animation: none;
  }
}
</style>
