<script setup lang="ts">
import { useIsStreaming, type ComponentRenderProps } from "@openuidev/vue-lang";
import { computed, useId } from "vue";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
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
  <div data-slot="iui-checkbox" class="flex items-start gap-2.5">
    <Checkbox :id="id" v-model="model" class="mt-0.5" :disabled="isStreaming" />
    <div class="flex min-w-0 flex-col gap-0.5">
      <Label
        :for="id"
        :class="['leading-snug', model && 'text-muted-foreground line-through']"
      >
        {{ props.props.label }}
      </Label>
      <span
        v-if="props.props.description"
        class="text-xs text-muted-foreground"
      >
        {{ props.props.description }}
      </span>
    </div>
  </div>
</template>
