<script setup lang="ts">
import { useIsStreaming, type ComponentRenderProps } from "@openuidev/vue-lang";
import { computed, useId } from "vue";
import { Textarea } from "@/components/ui/textarea";
import type { IntelligentUiProps } from "@/shared/intelligentUi";
import { useBoundValue } from "./context";
import IuiField from "./IuiField.vue";

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
  <IuiField :label="props.props.label" :for="id">
    <Textarea
      :id="id"
      v-model="model"
      class="min-h-20"
      :placeholder="props.props.placeholder"
      :disabled="isStreaming"
    />
  </IuiField>
</template>
