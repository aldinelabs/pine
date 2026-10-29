<script setup lang="ts">
import { useIsStreaming, type ComponentRenderProps } from "@openuidev/vue-lang";
import { computed, useId } from "vue";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { IntelligentUiProps } from "@/shared/intelligentUi";
import { useBoundValue } from "./context";

const props = defineProps<ComponentRenderProps<IntelligentUiProps<"Input">>>();
const id = useId();
const isStreaming = useIsStreaming();
const bound = useBoundValue<string | number | null>(() => props.props.value);
const isNumber = computed(() => props.props.type === "number");
const model = computed({
  get: () => bound.value ?? "",
  set: (value: string | number) => {
    bound.value =
      isNumber.value && value !== "" && !Number.isNaN(Number(value))
        ? Number(value)
        : value;
  },
});
</script>

<template>
  <Field data-iui="input">
    <FieldLabel v-if="props.props.label" :for="id">
      {{ props.props.label }}
    </FieldLabel>
    <Input
      :id="id"
      v-model="model"
      :type="isNumber ? 'number' : 'text'"
      :placeholder="props.props.placeholder"
      :disabled="isStreaming"
    />
  </Field>
</template>
