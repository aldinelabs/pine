<script setup lang="ts">
import { useIsStreaming, type ComponentRenderProps } from "@openuidev/vue-lang";
import { computed, useId } from "vue";
import { Field, FieldLabel } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import type { IntelligentUiProps } from "@/shared/intelligentUi";
import { useBoundValue } from "./context";

const props = defineProps<ComponentRenderProps<IntelligentUiProps<"Switch">>>();
const id = useId();
const isStreaming = useIsStreaming();
const bound = useBoundValue<boolean | null>(() => props.props.value);
const model = computed({
  get: () => bound.value === true,
  set: (value: boolean) => {
    bound.value = value;
  },
});
</script>

<template>
  <Field data-iui="switch" orientation="horizontal">
    <Switch :id="id" v-model="model" :disabled="isStreaming" />
    <FieldLabel :for="id">{{ props.props.label }}</FieldLabel>
  </Field>
</template>
