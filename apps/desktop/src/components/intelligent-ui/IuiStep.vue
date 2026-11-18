<script setup lang="ts">
import type { ComponentRenderProps } from "@openuidev/vue-lang";
import type { IntelligentUiProps } from "@/shared/intelligentUi";

// Steps reads its items itself; one placed elsewhere draws as a line.
const props = defineProps<ComponentRenderProps<IntelligentUiProps<"Step">>>();
</script>

<template>
  <div data-iui="step" class="flex flex-col gap-0.5 text-sm">
    <span class="font-medium">{{ props.props.title }}</span>
    <span v-if="props.props.description" class="text-muted-foreground">
      {{ props.props.description }}
    </span>
  </div>
</template>
