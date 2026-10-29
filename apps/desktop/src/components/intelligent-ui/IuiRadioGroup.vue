<script setup lang="ts">
import { useIsStreaming, type ComponentRenderProps } from "@openuidev/vue-lang";
import { computed, useId } from "vue";
import {
  Field,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
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
  <FieldSet data-iui="radio-group">
    <FieldLegend v-if="props.props.label" variant="label">
      {{ props.props.label }}
    </FieldLegend>
    <RadioGroup v-model="model" :disabled="isStreaming">
      <Field
        v-for="(option, index) in props.props.options ?? []"
        :key="option"
        orientation="horizontal"
      >
        <RadioGroupItem :id="`${id}-${index}`" :value="option" />
        <FieldLabel :for="`${id}-${index}`" class="font-normal">
          {{ option }}
        </FieldLabel>
      </Field>
    </RadioGroup>
  </FieldSet>
</template>
