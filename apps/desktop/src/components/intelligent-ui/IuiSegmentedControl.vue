<script setup lang="ts">
import { useIsStreaming, type ComponentRenderProps } from "@openuidev/vue-lang";
import { computed } from "vue";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { IntelligentUiProps } from "@/shared/intelligentUi";
import { useBoundValue } from "./context";

const props =
  defineProps<ComponentRenderProps<IntelligentUiProps<"SegmentedControl">>>();
const isStreaming = useIsStreaming();
const bound = useBoundValue<string | null>(() => props.props.value);
const model = computed({
  get: () => bound.value ?? undefined,
  // A single toggle group clears on re-click; keep one option selected.
  set: (value: unknown) => {
    if (typeof value === "string" && value) bound.value = value;
  },
});
</script>

<template>
  <ToggleGroup
    v-model="model"
    data-slot="iui-segmented-control"
    type="single"
    variant="outline"
    size="sm"
    :spacing="2"
    class="w-fit"
    :disabled="isStreaming"
  >
    <ToggleGroupItem
      v-for="option in props.props.options ?? []"
      :key="option"
      :value="option"
    >
      {{ option }}
    </ToggleGroupItem>
  </ToggleGroup>
</template>
