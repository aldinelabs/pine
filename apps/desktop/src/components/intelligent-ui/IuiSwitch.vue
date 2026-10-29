<script setup lang="ts">
import { useIsStreaming, type ComponentRenderProps } from "@openuidev/vue-lang";
import { computed, useId } from "vue";
import { Label } from "@/components/ui/label";
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
  <div data-slot="iui-switch" class="flex items-center gap-2.5">
    <Switch :id="id" v-model="model" :disabled="isStreaming" />
    <Label :for="id">{{ props.props.label }}</Label>
  </div>
</template>
