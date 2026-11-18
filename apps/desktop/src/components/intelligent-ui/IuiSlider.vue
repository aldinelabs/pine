<script setup lang="ts">
import { useIsStreaming, type ComponentRenderProps } from "@openuidev/vue-lang";
import { computed, useId } from "vue";
import { Field, FieldLabel } from "@/components/ui/field";
import { Slider } from "@/components/ui/slider";
import type { IntelligentUiProps } from "@/shared/intelligentUi";
import { useBoundValue } from "./context";
import { withUnit } from "./units";

const props = defineProps<ComponentRenderProps<IntelligentUiProps<"Slider">>>();
const id = useId();
const isStreaming = useIsStreaming();
const bound = useBoundValue<number | null>(() => props.props.value);
const value = computed(() => Number(bound.value ?? props.props.min ?? 0));
const model = computed({
  get: () => [value.value],
  set: (next: number[] | undefined) => {
    if (next?.[0] !== undefined) bound.value = next[0];
  },
});
const shown = computed(() => withUnit(value.value, props.props.unit));

/** Marks inside the range, placed along the track. */
const marks = computed(() => {
  const { min, max } = props.props;
  const span = Number(max) - Number(min);
  if (!Array.isArray(props.props.marks) || !(span > 0)) return [];
  return props.props.marks.flatMap((mark) => {
    const at = Number(mark?.value);
    if (!Number.isFinite(at) || at < min || at > max) return [];
    const left = ((at - min) / span) * 100;
    // Labels at the ends stay inside the track instead of overhanging it.
    const shift = left < 8 ? "0%" : left > 92 ? "-100%" : "-50%";
    return [{ label: String(mark.label ?? ""), left, shift }];
  });
});
</script>

<template>
  <Field data-iui="slider">
    <div
      v-if="props.props.label"
      class="flex items-center justify-between gap-3"
    >
      <FieldLabel :for="id">{{ props.props.label }}</FieldLabel>
      <span class="text-sm text-muted-foreground tabular-nums">
        {{ shown }}
      </span>
    </div>
    <Slider
      :id="id"
      v-model="model"
      :min="props.props.min"
      :max="props.props.max"
      :step="props.props.step ?? 1"
      :disabled="isStreaming"
      :aria-valuetext="shown"
    />
    <div
      v-if="marks.length > 0"
      data-iui="slider-marks"
      class="relative h-4 text-xs text-muted-foreground"
      aria-hidden="true"
    >
      <span
        v-for="(mark, index) in marks"
        :key="index"
        class="absolute top-0 whitespace-nowrap"
        :style="{
          left: `${mark.left}%`,
          transform: `translateX(${mark.shift})`,
        }"
      >
        {{ mark.label }}
      </span>
    </div>
  </Field>
</template>
