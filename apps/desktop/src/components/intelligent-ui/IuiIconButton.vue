<script setup lang="ts">
import { useIsStreaming, type ComponentRenderProps } from "@openuidev/vue-lang";
import { computed } from "vue";
import { Button } from "@/components/ui/button";
import type { IntelligentUiProps } from "@/shared/intelligentUi";
import { useRunAction } from "./context";
import { iuiIcon } from "./icons";

const props =
  defineProps<ComponentRenderProps<IntelligentUiProps<"IconButton">>>();
const isStreaming = useIsStreaming();
const runAction = useRunAction();
const icon = computed(() => iuiIcon(props.props.icon));
/** The label is what a click without an action sends, and what is read aloud. */
const label = computed(() => props.props.label || props.props.icon || "");
</script>

<template>
  <Button
    data-iui="icon-button"
    type="button"
    size="icon"
    class="rounded-full"
    :variant="props.props.variant ?? 'outline'"
    :aria-label="label"
    :title="label"
    :disabled="isStreaming"
    @click="runAction(label, props.props.action)"
  >
    <component :is="icon" v-if="icon" />
    <span v-else class="text-xs">{{ label.slice(0, 1) }}</span>
  </Button>
</template>
