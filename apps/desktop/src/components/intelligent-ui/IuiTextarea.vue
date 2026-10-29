<script setup lang="ts">
import { useIsStreaming, type ComponentRenderProps } from "@openuidev/vue-lang";
import { computed, useId } from "vue";
import { Field, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import type { IntelligentUiProps } from "@/shared/intelligentUi";
import { useBoundValue } from "./context";

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
</script>

<template>
  <Field data-iui="textarea">
    <FieldLabel v-if="props.props.label" :for="id">
      {{ props.props.label }}
    </FieldLabel>
    <Textarea
      :id="id"
      v-model="model"
      :placeholder="props.props.placeholder"
      :disabled="isStreaming"
    />
  </Field>
</template>
