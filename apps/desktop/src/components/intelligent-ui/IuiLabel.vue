<script setup lang="ts">
import type { ComponentRenderProps } from "@openuidev/vue-lang";
import type { IntelligentUiProps } from "@/shared/intelligentUi";

const props = defineProps<ComponentRenderProps<IntelligentUiProps<"Label">>>();
</script>

<template>
  <p data-iui="label" class="text-sm leading-snug font-medium">
    {{ props.props.text }}
  </p>
</template>
