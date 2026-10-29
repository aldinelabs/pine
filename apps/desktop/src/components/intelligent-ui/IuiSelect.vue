<script setup lang="ts">
import { useIsStreaming, type ComponentRenderProps } from "@openuidev/vue-lang";
import { computed, useId } from "vue";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { IntelligentUiProps } from "@/shared/intelligentUi";
import { useBoundValue } from "./context";
import IuiField from "./IuiField.vue";

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
  <IuiField :label="props.props.label" :for="id">
    <Select v-model="model" :disabled="isStreaming">
      <SelectTrigger :id="id" class="w-full min-w-40 sm:w-fit">
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
  </IuiField>
</template>
