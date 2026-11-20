<script setup lang="ts" generic="T extends string">
import { ref } from "vue";
import { cn } from "@/lib/utils";

export interface PineColorSwatch<V extends string = string> {
  value: V;
  label: string;
  /** A CSS colour for the swatch, or leave it out and pass `class`. */
  color?: string;
  class?: string;
}

/**
 * A row of round colour swatches that works as one radio group: arrow keys
 * move and choose, Tab enters on the chosen swatch. Shared by the user
 * dialog and the project editor so both pickers look and behave alike.
 */
const props = defineProps<{
  options: readonly PineColorSwatch<T>[];
  labelledby?: string;
  label?: string;
  /** `data-slot` for each swatch, so tests can find them. */
  itemSlot?: string;
}>();
const model = defineModel<T>({ required: true });
const group = ref<HTMLElement>();

function move(from: number, step: number): void {
  const count = props.options.length;
  if (count === 0) return;
  const next = (from + step + count) % count;
  model.value = props.options[next].value;
  group.value?.querySelectorAll<HTMLElement>("[role=radio]")[next]?.focus();
}

function onKeydown(event: KeyboardEvent, index: number): void {
  const step =
    event.key === "ArrowRight" || event.key === "ArrowDown"
      ? 1
      : event.key === "ArrowLeft" || event.key === "ArrowUp"
        ? -1
        : 0;
  if (step === 0) return;
  event.preventDefault();
  move(index, step);
}

function isTabStop(value: T, index: number): boolean {
  const chosen = props.options.some((option) => option.value === model.value);
  return chosen ? value === model.value : index === 0;
}
</script>

<template>
  <div
    ref="group"
    role="radiogroup"
    :aria-labelledby="props.labelledby"
    :aria-label="props.label"
    class="flex flex-wrap gap-2"
  >
    <button
      v-for="(option, index) in props.options"
      :key="option.value"
      type="button"
      role="radio"
      :data-slot="props.itemSlot ?? 'color-swatch'"
      :data-value="option.value"
      :aria-checked="model === option.value"
      :aria-label="option.label"
      :title="option.label"
      :tabindex="isTabStop(option.value, index) ? 0 : -1"
      :class="
        cn(
          'size-6 rounded-full border border-black/10 outline-none ring-offset-2 ring-offset-background transition-shadow focus-visible:ring-3 focus-visible:ring-ring/50 dark:border-white/15',
          model === option.value
            ? 'ring-2 ring-foreground/70'
            : 'hover:ring-2 hover:ring-foreground/20',
          option.class,
        )
      "
      :style="option.color ? { backgroundColor: option.color } : undefined"
      @click="model = option.value"
      @keydown="onKeydown($event, index)"
    />
  </div>
</template>
