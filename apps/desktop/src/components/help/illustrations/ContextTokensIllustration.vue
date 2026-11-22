<script setup lang="ts">
// Each turn sends the whole conversation again: its bar is the previous
// turn's (cached, striped) plus what is new (solid).
const turns = [
  { cached: 0, fresh: 22 },
  { cached: 22, fresh: 16 },
  { cached: 38, fresh: 20 },
  { cached: 58, fresh: 14 },
  { cached: 72, fresh: 18 },
];

/** Widths of the token chips, in rem; text becomes these small pieces. */
const tokens = [2.2, 1.4, 2.8, 1, 1.8, 2.4, 1.2, 2, 1.6];
</script>

<!-- Text is cut into tokens; every turn rereads all earlier turns, so the
     cost grows with the conversation, and the cached part is cheaper. -->
<template>
  <div class="flex w-full max-w-sm flex-col gap-5 px-4">
    <div class="flex flex-wrap justify-center gap-1">
      <span
        v-for="(width, index) in tokens"
        :key="index"
        :class="[
          'help-token h-4 rounded-md',
          index % 2 ? 'bg-primary/35' : 'bg-info/35',
        ]"
        :style="{ width: `${width}rem`, animationDelay: `${index * 0.12}s` }"
      />
    </div>

    <div class="flex h-24 items-end justify-center gap-3">
      <div
        v-for="(turn, index) in turns"
        :key="index"
        class="help-bar flex w-7 flex-col justify-end overflow-hidden rounded-lg"
        :style="{
          height: `${turn.cached + turn.fresh}%`,
          animationDelay: `${0.8 + index * 0.35}s`,
        }"
      >
        <span
          class="bg-primary/60 shrink-0"
          :style="{
            height: `${(turn.fresh / (turn.cached + turn.fresh)) * 100}%`,
          }"
        />
        <span
          class="help-cached shrink-0"
          :style="{
            height: `${(turn.cached / (turn.cached + turn.fresh)) * 100}%`,
          }"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.help-cached {
  background: repeating-linear-gradient(
    135deg,
    color-mix(in oklab, var(--primary) 30%, transparent) 0 4px,
    color-mix(in oklab, var(--primary) 12%, transparent) 4px 8px
  );
}

.help-token {
  animation: help-token 5s ease-out infinite both;
}

.help-bar {
  transform-origin: bottom;
  animation: help-bar 5s cubic-bezier(0.16, 1, 0.3, 1) infinite both;
}

@keyframes help-token {
  0% {
    opacity: 0;
    transform: scale(0.6);
  }
  6%,
  90% {
    opacity: 1;
    transform: none;
  }
  100% {
    opacity: 0;
  }
}

@keyframes help-bar {
  0% {
    opacity: 0;
    transform: scaleY(0);
  }
  12%,
  80% {
    opacity: 1;
    transform: none;
  }
  90%,
  100% {
    opacity: 0;
    transform: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .help-token,
  .help-bar {
    animation: none;
  }
}
</style>
