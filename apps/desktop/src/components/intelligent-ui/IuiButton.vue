<script setup lang="ts">
import { useIsStreaming, type ComponentRenderProps } from "@openuidev/vue-lang";
import { Button } from "@/components/ui/button";
import type { IntelligentUiProps } from "@/shared/intelligentUi";
import { useRunAction } from "./context";

const props = defineProps<ComponentRenderProps<IntelligentUiProps<"Button">>>();
const isStreaming = useIsStreaming();
const runAction = useRunAction();
</script>

<template>
  <Button
    data-iui="button"
    type="button"
    class="w-fit"
    :variant="props.props.variant ?? 'default'"
    :disabled="isStreaming || props.props.disabled === true"
    @click="runAction(props.props.label, props.props.action)"
  >
    {{ props.props.label }}
  </Button>
</template>
