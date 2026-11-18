<script setup lang="ts">
import { useIsStreaming, type ComponentRenderProps } from "@openuidev/vue-lang";
import { onBeforeUnmount, ref, watch } from "vue";
import { prefersReducedMotion } from "@/lib/animateScroll";
import type { IntelligentUiProps } from "@/shared/intelligentUi";

const props =
  defineProps<ComponentRenderProps<IntelligentUiProps<"Celebration">>>();
const isStreaming = useIsStreaming();

interface Piece {
  id: number;
  style: Record<string, string>;
}

const COLORS = 5;
const PIECES = 36;
const DURATION = 1600;
const pieces = ref<Piece[]>([]);
let timer: ReturnType<typeof setTimeout> | undefined;
let burst = 0;

/** Confetti from the block's centre; with reduced motion, none. */
function celebrate(): void {
  if (prefersReducedMotion()) return;
  burst += 1;
  pieces.value = Array.from({ length: PIECES }, (_unused, index) => {
    const angle = (index / PIECES) * Math.PI * 2 + Math.random() * 0.4;
    const distance = 80 + Math.random() * 120;
    return {
      id: burst * PIECES + index,
      style: {
        "--iui-dx": `${Math.cos(angle) * distance}px`,
        "--iui-dy": `${Math.sin(angle) * distance - 60}px`,
        "--iui-spin": `${Math.round(Math.random() * 720 - 360)}deg`,
        background: `var(--chart-${(index % COLORS) + 1})`,
        animationDelay: `${Math.round(Math.random() * 120)}ms`,
      },
    };
  });
  if (timer !== undefined) clearTimeout(timer);
  timer = setTimeout(() => (pieces.value = []), DURATION + 200);
}

// Fires on the change to true, not for a block that opens already true.
watch(
  () => props.props.when === true,
  (now, before) => {
    if (now && before === false && !isStreaming.value) celebrate();
  },
);
onBeforeUnmount(() => {
  if (timer !== undefined) clearTimeout(timer);
});
</script>

<template>
  <div
    data-iui="celebration"
    class="pointer-events-none relative h-0 w-full overflow-visible"
    aria-hidden="true"
  >
    <span
      v-for="piece in pieces"
      :key="piece.id"
      class="iui-confetti absolute top-0 left-1/2 size-2 rounded-[2px]"
      :style="piece.style"
    />
  </div>
</template>

<style scoped>
.iui-confetti {
  animation: iui-confetti 1.6s cubic-bezier(0.2, 0.7, 0.3, 1) forwards;
  opacity: 0;
}

@keyframes iui-confetti {
  0% {
    opacity: 1;
    transform: translate(-50%, 0) rotate(0deg) scale(1);
  }
  70% {
    opacity: 1;
  }
  100% {
    opacity: 0;
    transform: translate(
        calc(-50% + var(--iui-dx)),
        calc(var(--iui-dy) + 120px)
      )
      rotate(var(--iui-spin)) scale(0.8);
  }
}

@media (prefers-reduced-motion: reduce) {
  .iui-confetti {
    display: none;
  }
}
</style>
