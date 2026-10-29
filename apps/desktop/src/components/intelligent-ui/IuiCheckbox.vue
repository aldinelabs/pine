<script setup lang="ts">
import { useIsStreaming, type ComponentRenderProps } from "@openuidev/vue-lang";
import { computed, useId } from "vue";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@/components/ui/field";
import type { IntelligentUiProps } from "@/shared/intelligentUi";
import { useBoundValue } from "./context";

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
</script>

<template>
  <Field data-iui="checkbox" orientation="horizontal">
    <Checkbox :id="id" v-model="model" :disabled="isStreaming" />
    <FieldContent v-if="props.props.description">
      <FieldLabel :for="id">{{ props.props.label }}</FieldLabel>
      <FieldDescription>{{ props.props.description }}</FieldDescription>
    </FieldContent>
    <FieldLabel v-else :for="id">{{ props.props.label }}</FieldLabel>
  </Field>
</template>
