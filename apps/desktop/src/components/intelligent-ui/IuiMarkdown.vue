<script setup lang="ts">
import type { ComponentRenderProps } from "@openuidev/vue-lang";
import { defineAsyncComponent } from "vue";
import type { IntelligentUiProps } from "@/shared/intelligentUi";

// MarkdownContent renders this block's fence, so it loads lazily to break
// the import cycle.
const MarkdownContent = defineAsyncComponent(
  () => import("@/components/markdown/MarkdownContent.vue"),
);

const props =
  defineProps<ComponentRenderProps<IntelligentUiProps<"Markdown">>>();
</script>

<template>
  <div data-slot="iui-markdown" class="transcript-prose min-w-0">
    <MarkdownContent :source="props.props.source" final />
  </div>
</template>
