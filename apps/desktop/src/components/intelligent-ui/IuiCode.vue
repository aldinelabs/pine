<script setup lang="ts">
import type { ComponentRenderProps } from "@openuidev/vue-lang";
import { computed } from "vue";
import CodeBlock from "@/components/markdown/CodeBlock.vue";
import type { IntelligentUiProps } from "@/shared/intelligentUi";

const props = defineProps<ComponentRenderProps<IntelligentUiProps<"Code">>>();

/** The same block, highlighting and copy button as a Markdown code fence. */
const node = computed(() => ({
  type: "code_block" as const,
  language:
    typeof props.props.language === "string" ? props.props.language : "",
  code: typeof props.props.code === "string" ? props.props.code : "",
}));
</script>

<template>
  <div data-iui="code" class="min-w-0 [&>*]:my-0">
    <CodeBlock :node="node" />
  </div>
</template>
