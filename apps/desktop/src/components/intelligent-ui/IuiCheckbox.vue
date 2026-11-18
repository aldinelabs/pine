<script setup lang="ts">
import { useIsStreaming, type ComponentRenderProps } from "@openuidev/vue-lang";
import { computed, useId } from "vue";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import type { IntelligentUiProps } from "@/shared/intelligentUi";
import { useBoundValue, useFieldRules } from "./context";

const props =
  defineProps<ComponentRenderProps<IntelligentUiProps<"Checkbox">>>();
const id = useId();
const isStreaming = useIsStreaming();
const bound = useBoundValue<boolean | null>(() => props.props.value);
const model = computed({
  get: () => bound.value === true,
  set: (value: boolean | "indeterminate") => {
    bound.value = value === true;
  },
});
// Unticked reads as empty, so `required` means it must be ticked.
const error = useFieldRules(
  () => props.props.rules,
  () => (bound.value === true ? true : null),
);
</script>

<template>
  <Field
    data-iui="checkbox"
    orientation="horizontal"
    :data-invalid="error ? true : undefined"
  >
    <Checkbox
      :id="id"
      v-model="model"
      :disabled="isStreaming"
      :aria-invalid="error ? true : undefined"
    />
    <FieldContent v-if="props.props.description || error">
      <FieldLabel :for="id">{{ props.props.label }}</FieldLabel>
      <FieldDescription v-if="props.props.description">
        {{ props.props.description }}
      </FieldDescription>
      <FieldError v-if="error" :errors="[error]" />
    </FieldContent>
    <FieldLabel v-else :for="id">{{ props.props.label }}</FieldLabel>
  </Field>
</template>
