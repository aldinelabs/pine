<script setup lang="ts">
import { computed } from "vue";
import { cn } from "@/lib/utils";

/**
 * A small determinate ring for a download in a row of text: a faint track
 * and an arc that fills clockwise from twelve o'clock.
 */
const props = defineProps<{
  /** 0–1. */
  value: number;
  label: string;
  class?: string;
}>();

const RADIUS = 6;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const clamped = computed(() => Math.min(1, Math.max(0, props.value)));
</script>

<template>
  <svg
    viewBox="0 0 16 16"
    role="progressbar"
    :aria-label="label"
    aria-valuemin="0"
    aria-valuemax="100"
    :aria-valuenow="Math.round(clamped * 100)"
    :class="cn('size-3.5 -rotate-90', props.class)"
    data-testid="live-context-progress-ring"
  >
    <circle
      cx="8"
      cy="8"
      :r="RADIUS"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      class="opacity-20"
    />
    <circle
      v-if="clamped > 0"
      cx="8"
      cy="8"
      :r="RADIUS"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      :stroke-dasharray="CIRCUMFERENCE"
      :stroke-dashoffset="CIRCUMFERENCE * (1 - clamped)"
      class="transition-[stroke-dashoffset] duration-300 ease-out motion-reduce:transition-none"
    />
  </svg>
</template>
