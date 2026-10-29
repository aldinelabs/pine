<script setup lang="ts">
import { useIsStreaming, type ComponentRenderProps } from "@openuidev/vue-lang";
import { computed, useId } from "vue";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { IntelligentUiProps } from "@/shared/intelligentUi";
import { useBoundValue } from "./context";

const props = defineProps<ComponentRenderProps<IntelligentUiProps<"Select">>>();
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
  <Field data-iui="select">
    <FieldLabel v-if="props.props.label" :for="id">
      {{ props.props.label }}
    </FieldLabel>
    <Select v-model="model" :disabled="isStreaming">
      <SelectTrigger :id="id">
        <SelectValue :placeholder="props.props.placeholder" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem
          v-for="option in props.props.options ?? []"
          :key="option"
          :value="option"
        >
          {{ option }}
        </SelectItem>
      </SelectContent>
    </Select>
  </Field>
</template>
