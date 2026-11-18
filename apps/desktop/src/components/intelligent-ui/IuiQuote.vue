<script setup lang="ts">
import type { ComponentRenderProps } from "@openuidev/vue-lang";
import type { IntelligentUiProps } from "@/shared/intelligentUi";

const props = defineProps<ComponentRenderProps<IntelligentUiProps<"Quote">>>();
</script>

<template>
  <figure data-iui="quote" class="flex flex-col gap-1.5 border-l-2 pl-4">
    <blockquote
      class="text-sm leading-relaxed text-pretty whitespace-pre-line italic"
    >
      {{ props.props.text }}
    </blockquote>
    <figcaption v-if="props.props.cite" class="text-xs text-muted-foreground">
      — {{ props.props.cite }}
    </figcaption>
  </figure>
</template>
