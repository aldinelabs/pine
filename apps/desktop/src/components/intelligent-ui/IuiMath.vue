<script setup lang="ts">
import type { ComponentRenderProps } from "@openuidev/vue-lang";
import katex from "katex";
import "katex/dist/katex.min.css";
import { computed } from "vue";
import type { IntelligentUiProps } from "@/shared/intelligentUi";

const props = defineProps<ComponentRenderProps<IntelligentUiProps<"Math">>>();

/**
 * KaTeX, as Markdown math uses. Untrusted commands (\href, \url, \includegraphics
 * and the like) stay disabled, so the HTML holds only KaTeX's own markup; a
 * formula that does not parse shows its source in the error colour.
 */
const html = computed(() =>
  katex.renderToString(String(props.props.tex ?? ""), {
    displayMode: props.props.inline !== true,
    throwOnError: false,
    trust: false,
    strict: "ignore",
    output: "htmlAndMathml",
  }),
);
</script>

<template>
  <span
    v-if="props.props.inline"
    data-iui="math"
    class="inline"
    v-html="html"
  />
  <div
    v-else
    data-iui="math"
    class="min-w-0 overflow-x-auto [&_.katex-display]:my-1"
    v-html="html"
  />
</template>
