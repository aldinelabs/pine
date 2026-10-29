<script setup lang="ts">
import { useIsStreaming, type ComponentRenderProps } from "@openuidev/vue-lang";
import { computed, useId } from "vue";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { IntelligentUiProps } from "@/shared/intelligentUi";
import { useBoundValue } from "./context";

const props =
  defineProps<ComponentRenderProps<IntelligentUiProps<"RadioGroup">>>();
const id = useId();
const isStreaming = useIsStreaming();
const bound = useBoundValue<string | null>(() => props.props.value);
const model = computed({
  get: () => bound.value ?? undefined,
  set: (value: unknown) => {
    if (typeof value === "string") bound.value = value;
  },
});
</script>

<template>
  <div data-slot="iui-radio-group" class="flex min-w-0 flex-col gap-2">
    <Label v-if="props.props.label" :id="`${id}-label`">
      {{ props.props.label }}
    </Label>
    <RadioGroup
      v-model="model"
      :aria-labelledby="props.props.label ? `${id}-label` : undefined"
      :disabled="isStreaming"
    >
      <div
        v-for="(option, index) in props.props.options ?? []"
        :key="option"
        class="flex items-center gap-2.5"
      >
        <RadioGroupItem :id="`${id}-${index}`" :value="option" />
        <Label :for="`${id}-${index}`" class="font-normal">{{ option }}</Label>
      </div>
    </RadioGroup>
  </div>
</template>
