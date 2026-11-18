<script setup lang="ts">
import { useIsStreaming, type ComponentRenderProps } from "@openuidev/vue-lang";
import { cn } from "@/lib/utils";
import type { IntelligentUiProps } from "@/shared/intelligentUi";
import { IuiNodes, useRunAction } from "./context";

const props =
  defineProps<ComponentRenderProps<IntelligentUiProps<"Pressable">>>();
const isStreaming = useIsStreaming();
const runAction = useRunAction();

/** A click without an action sends the content's text, as a Button would. */
function press(event: MouseEvent): void {
  const text = (event.currentTarget as HTMLElement).innerText.trim();
  runAction(text, props.props.action);
}
</script>

<template>
  <button
    data-iui="pressable"
    type="button"
    :aria-pressed="
      props.props.selected === undefined ? undefined : props.props.selected
    "
    :disabled="isStreaming"
    :class="
      cn(
        'flex min-w-0 cursor-pointer flex-col gap-2 rounded-lg border border-border p-3 text-left text-sm transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-60',
        props.props.selected === true &&
          'border-primary bg-primary/5 hover:bg-primary/10',
      )
    "
    @click="press"
  >
    <IuiNodes :value="props.props.children" />
  </button>
</template>
