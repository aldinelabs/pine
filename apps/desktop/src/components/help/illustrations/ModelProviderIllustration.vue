<script setup lang="ts">
import { CloudIcon, KeyRoundIcon, LaptopMinimalIcon } from "@lucide/vue";
</script>

<!-- Pine on your computer sends the conversation to a provider's model in
     the cloud, and the reply comes back. The key marks the connection. -->
<template>
  <div class="flex items-center justify-center gap-3 sm:gap-5">
    <div class="flex flex-col items-center gap-1.5">
      <div
        class="bg-background ring-foreground/10 flex size-14 items-center justify-center rounded-2xl shadow-sm ring-1"
      >
        <LaptopMinimalIcon class="text-foreground size-6" />
      </div>
      <span class="text-muted-foreground text-[11px] font-medium">Pine</span>
    </div>

    <div class="flex w-16 flex-col gap-3 sm:w-24">
      <div class="help-track">
        <span class="help-dot help-dot--out bg-primary" />
      </div>
      <div class="help-track">
        <span class="help-dot help-dot--back bg-info" />
      </div>
    </div>

    <div class="flex flex-col gap-1.5">
      <div
        v-for="index in 3"
        :key="index"
        :class="[
          'ring-foreground/10 relative flex size-11 items-center justify-center rounded-xl ring-1',
          index === 2 ? 'help-provider bg-background shadow-sm' : 'opacity-45',
        ]"
      >
        <CloudIcon
          :class="[
            'size-5',
            index === 2 ? 'text-primary' : 'text-muted-foreground',
          ]"
        />
        <span
          v-if="index === 2"
          class="bg-warning text-background absolute -end-1.5 -bottom-1.5 flex size-5 items-center justify-center rounded-full"
        >
          <KeyRoundIcon class="size-3" />
        </span>
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
  width: 8px;
  height: 8px;
  margin-top: -4px;
  border-radius: 9999px;
  animation: 3.6s ease-in-out infinite both;
}

.help-dot--out {
  left: 0;
  animation-name: help-dot-out;
}

.help-dot--back {
  right: 0;
  animation-name: help-dot-back;
}

.help-provider {
  animation: help-provider 3.6s ease-in-out infinite;
}

@keyframes help-dot-out {
  0% {
    left: 0;
    opacity: 0;
  }
  5%,
  35% {
    opacity: 1;
  }
  40% {
    left: calc(100% - 8px);
    opacity: 0;
  }
  100% {
    left: calc(100% - 8px);
    opacity: 0;
  }
}

@keyframes help-dot-back {
  0%,
  55% {
    right: 0;
    opacity: 0;
  }
  60%,
  90% {
    opacity: 1;
  }
  95%,
  100% {
    right: calc(100% - 8px);
    opacity: 0;
  }
}

@keyframes help-provider {
  0%,
  38%,
  58%,
  100% {
    transform: scale(1);
  }
  48% {
    transform: scale(1.08);
  }
}

@media (prefers-reduced-motion: reduce) {
  .help-dot,
  .help-provider {
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
