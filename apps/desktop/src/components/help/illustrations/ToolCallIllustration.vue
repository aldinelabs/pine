<script setup lang="ts">
import {
  FileTextIcon,
  GlobeIcon,
  ShieldCheckIcon,
  SparklesIcon,
  TerminalIcon,
} from "@lucide/vue";

const tools = [FileTextIcon, TerminalIcon, GlobeIcon];
</script>

<!-- The model asks for a tool, Pine checks the request, the tool runs and
     its result travels back. -->
<template>
  <div class="flex items-center justify-center gap-3 sm:gap-5">
    <div
      class="bg-background ring-foreground/10 flex size-14 items-center justify-center rounded-2xl shadow-sm ring-1"
    >
      <SparklesIcon class="text-primary size-6" />
    </div>

    <div class="flex w-14 flex-col gap-3 sm:w-20">
      <div class="help-track">
        <span class="help-dot help-dot--out bg-primary" />
      </div>
      <div class="help-track">
        <span class="help-dot help-dot--back bg-info" />
      </div>
    </div>

    <div
      class="help-gate bg-background ring-foreground/10 flex size-14 items-center justify-center rounded-full shadow-sm ring-1"
    >
      <ShieldCheckIcon class="text-warning size-6" />
    </div>

    <div class="flex w-8 flex-col gap-3 sm:w-12">
      <div class="help-track">
        <span class="help-dot help-dot--out help-dot--late bg-primary" />
      </div>
      <div class="help-track">
        <span class="help-dot help-dot--back help-dot--early bg-info" />
      </div>
    </div>

    <div class="flex flex-col gap-1.5">
      <div
        v-for="(icon, index) in tools"
        :key="index"
        class="help-tool bg-background ring-foreground/10 flex size-11 items-center justify-center rounded-xl ring-1"
        :style="{ animationDelay: `${1.2 + index * 0.15}s` }"
      >
        <component :is="icon" class="text-muted-foreground size-5" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.help-track {
  position: relative;
  height: 2px;
  border-radius: 9999px;
  background: color-mix(in oklab, var(--foreground) 12%, transparent);
}

.help-dot {
  position: absolute;
  top: 50%;
  left: 0;
  width: 8px;
  height: 8px;
  margin-top: -4px;
  border-radius: 9999px;
  animation: 4s ease-in-out infinite both;
}

.help-dot--out {
  animation-name: help-dot-out;
}

.help-dot--out.help-dot--late {
  animation-name: help-dot-out-late;
}

.help-dot--back {
  left: auto;
  right: 0;
  animation-name: help-dot-back;
}

.help-dot--back.help-dot--early {
  animation-name: help-dot-back-early;
}

.help-gate {
  animation: help-gate 4s ease-in-out infinite;
}

.help-tool {
  animation: help-tool 4s ease-in-out infinite;
}

@keyframes help-dot-out {
  0% {
    left: 0;
    opacity: 0;
  }
  5% {
    opacity: 1;
  }
  25% {
    left: calc(100% - 8px);
    opacity: 1;
  }
  30%,
  100% {
    left: calc(100% - 8px);
    opacity: 0;
  }
}

@keyframes help-dot-out-late {
  0%,
  30% {
    left: 0;
    opacity: 0;
  }
  33% {
    opacity: 1;
  }
  45% {
    left: calc(100% - 8px);
    opacity: 1;
  }
  50%,
  100% {
    left: calc(100% - 8px);
    opacity: 0;
  }
}

@keyframes help-dot-back-early {
  0%,
  60% {
    right: 0;
    opacity: 0;
  }
  63% {
    opacity: 1;
  }
  72% {
    right: calc(100% - 8px);
    opacity: 1;
  }
  75%,
  100% {
    right: calc(100% - 8px);
    opacity: 0;
  }
}

@keyframes help-dot-back {
  0%,
  75% {
    right: 0;
    opacity: 0;
  }
  78% {
    opacity: 1;
  }
  95% {
    right: calc(100% - 8px);
    opacity: 1;
  }
  100% {
    right: calc(100% - 8px);
    opacity: 0;
  }
}

@keyframes help-gate {
  0%,
  22%,
  40%,
  100% {
    transform: scale(1);
  }
  30% {
    transform: scale(1.12);
  }
}

@keyframes help-tool {
  0%,
  45%,
  70%,
  100% {
    transform: scale(1);
    background: var(--background);
  }
  55% {
    transform: scale(1.08);
    background: color-mix(in oklab, var(--primary) 14%, var(--background));
  }
}

@media (prefers-reduced-motion: reduce) {
  .help-dot,
  .help-gate,
  .help-tool {
    animation: none;
  }

  .help-dot {
    opacity: 1;
  }

  .help-dot--out {
    left: calc(50% - 4px);
  }

  .help-dot--back {
    right: calc(50% - 4px);
  }
}
</style>
