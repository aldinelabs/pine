<script setup lang="ts">
import { useIsStreaming, type ComponentRenderProps } from "@openuidev/vue-lang";
import { computed, useId } from "vue";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  intelligentUiOptions,
  type IntelligentUiProps,
} from "@/shared/intelligentUi";
import { useBoundValue, useFieldRules } from "./context";

const props = defineProps<ComponentRenderProps<IntelligentUiProps<"Select">>>();
const id = useId();
const isStreaming = useIsStreaming();
const bound = useBoundValue<string | null>(() => props.props.value);
const options = computed(() => intelligentUiOptions(props.props.options));
const model = computed({
  get: () => bound.value ?? undefined,
  set: (value: unknown) => {
    if (typeof value === "string") bound.value = value;
  },
});
const error = useFieldRules(
  () => props.props.rules,
  () => bound.value,
);
</script>

<template>
  <Field data-iui="select" :data-invalid="error ? true : undefined">
    <FieldLabel v-if="props.props.label" :for="id">
      {{ props.props.label }}
    </FieldLabel>
    <Select v-model="model" :disabled="isStreaming">
      <SelectTrigger :id="id" :aria-invalid="error ? true : undefined">
        <SelectValue :placeholder="props.props.placeholder" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem
          v-for="option in options"
          :key="option.value"
          :value="option.value"
        >
          {{ option.label }}
        </SelectItem>
      </SelectContent>
    </Select>
    <FieldError v-if="error" :errors="[error]" />
  </Field>
</template>
