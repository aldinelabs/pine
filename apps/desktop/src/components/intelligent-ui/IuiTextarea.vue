<script setup lang="ts">
import { useIsStreaming, type ComponentRenderProps } from "@openuidev/vue-lang";
import { computed, useId } from "vue";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import type { IntelligentUiProps } from "@/shared/intelligentUi";
import { useBoundValue, useFieldRules } from "./context";

const props =
  defineProps<ComponentRenderProps<IntelligentUiProps<"Textarea">>>();
const id = useId();
const isStreaming = useIsStreaming();
const bound = useBoundValue<string | null>(() => props.props.value);
const model = computed({
  get: () => bound.value ?? "",
  set: (value: string) => {
    bound.value = value;
  },
});
const error = useFieldRules(
  () => props.props.rules,
  () => bound.value,
);
</script>

<template>
  <Field data-iui="textarea" :data-invalid="error ? true : undefined">
    <FieldLabel v-if="props.props.label" :for="id">
      {{ props.props.label }}
    </FieldLabel>
    <Textarea
      :id="id"
      v-model="model"
      :placeholder="props.props.placeholder"
      :disabled="isStreaming"
      :aria-invalid="error ? true : undefined"
    />
    <FieldError v-if="error" :errors="[error]" />
  </Field>
</template>
