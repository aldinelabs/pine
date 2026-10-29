<script setup lang="ts">
import type { ComponentRenderProps } from "@openuidev/vue-lang";
import type { IntelligentUiProps } from "@/shared/intelligentUi";

const props = defineProps<ComponentRenderProps<IntelligentUiProps<"List">>>();
</script>

<template>
  <component
    :is="props.props.ordered ? 'ol' : 'ul'"
    data-iui="list"
    :class="[
      'flex flex-col gap-1 pl-5 text-sm leading-relaxed marker:text-muted-foreground',
      props.props.ordered ? 'list-decimal' : 'list-disc',
    ]"
  >
    <li v-for="(item, index) in props.props.items ?? []" :key="index">
      {{ item }}
    </li>
  </component>
</template>
