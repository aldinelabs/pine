<script setup lang="ts">
import { useIsStreaming, type ComponentRenderProps } from "@openuidev/vue-lang";
import { computed, useId } from "vue";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import type { IntelligentUiProps } from "@/shared/intelligentUi";
import { useBoundValue } from "./context";

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
</script>

<template>
  <div data-slot="iui-slider" class="flex min-w-0 flex-col gap-2.5">
    <div
      v-if="props.props.label"
      class="flex items-center justify-between gap-3"
    >
      <Label :for="id">{{ props.props.label }}</Label>
      <span class="text-sm text-muted-foreground tabular-nums">
        {{ value.toLocaleString() }}
      </span>
    </div>
    <Slider
      :id="id"
      v-model="model"
      :min="props.props.min"
      :max="props.props.max"
      :step="props.props.step ?? 1"
      :disabled="isStreaming"
    />
  </div>
</template>
