<script setup lang="ts">
import { useIsStreaming, type ComponentRenderProps } from "@openuidev/vue-lang";
import { computed, useId } from "vue";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { IntelligentUiProps } from "@/shared/intelligentUi";
import { useBoundValue, useFieldRules } from "./context";

const props = defineProps<ComponentRenderProps<IntelligentUiProps<"Input">>>();
const id = useId();
const isStreaming = useIsStreaming();
const bound = useBoundValue<string | number | null>(() => props.props.value);
const isNumber = computed(() => props.props.type === "number");
const model = computed({
  get: () => bound.value ?? "",
  set: (value: string | number) => {
    if (isNumber.value && value === "") bound.value = null;
    else
      bound.value =
        isNumber.value && !Number.isNaN(Number(value)) ? Number(value) : value;
  },
});
const error = useFieldRules(
  () => props.props.rules,
  () => bound.value,
);
</script>

<template>
  <Field data-iui="input" :data-invalid="error ? true : undefined">
    <FieldLabel v-if="props.props.label" :for="id">
      {{ props.props.label }}
    </FieldLabel>
    <Input
      :id="id"
      v-model="model"
      :type="isNumber ? 'number' : 'text'"
      :placeholder="props.props.placeholder"
      :disabled="isStreaming"
      :aria-invalid="error ? true : undefined"
    />
    <FieldError v-if="error" :errors="[error]" />
  </Field>
</template>
