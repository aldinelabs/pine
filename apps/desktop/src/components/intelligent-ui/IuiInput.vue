<script setup lang="ts">
import { useIsStreaming, type ComponentRenderProps } from "@openuidev/vue-lang";
import { computed, useId } from "vue";
import { Input } from "@/components/ui/input";
import type { IntelligentUiProps } from "@/shared/intelligentUi";
import { useBoundValue } from "./context";
import IuiField from "./IuiField.vue";

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
  <IuiField :label="props.props.label" :for="id">
    <Input
      :id="id"
      v-model="model"
      :type="isNumber ? 'number' : 'text'"
      :placeholder="props.props.placeholder"
      :disabled="isStreaming"
    />
  </IuiField>
</template>
