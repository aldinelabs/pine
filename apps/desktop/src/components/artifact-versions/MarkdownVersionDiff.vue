<script setup lang="ts">
import { getMarkdown } from "markstream-vue";
import { computed } from "vue";
import { configurePineMarkdown } from "@/components/markdown/configureMarkdown";
import MarkdownContent from "@/components/markdown/MarkdownContent.vue";
import { diffMarkdown } from "@/lib/markdownDiff";

/**
 * The changes between two versions of a Markdown file, rendered: unchanged
 * blocks as they read, added and removed blocks tinted, and edited headings,
 * paragraphs and list items as text with their word changes marked.
 */
const props = defineProps<{ before: string; after: string }>();

const segments = computed(() =>
  diffMarkdown(
    configurePineMarkdown(getMarkdown("pine-version-diff")),
    props.before,
    props.after,
  ),
);

const HEADING_CLASSES: Record<number, string> = {
  1: "text-2xl",
  2: "text-xl",
  3: "text-lg",
};
</script>

<template>
  <div
    data-testid="markdown-version-diff"
    class="mx-auto flex w-full max-w-[var(--session-content-max-width)] flex-col gap-2 px-4 py-4"
  >
    <template v-for="(segment, index) in segments" :key="index">
      <div
        v-if="segment.type !== 'changed'"
        :data-diff="segment.type"
        :class="{
          'rounded-md border-l-2 border-emerald-500 bg-emerald-500/10 px-3':
            segment.type === 'added',
          'rounded-md border-l-2 border-red-500 bg-red-500/10 px-3 opacity-70':
            segment.type === 'removed',
        }"
      >
        <MarkdownContent :source="segment.source" final />
      </div>
      <div
        v-else
        data-diff="changed"
        class="rounded-md border-l-2 border-amber-500 px-3 py-2 leading-7"
        :class="
          segment.kind === 'heading'
            ? [
                'font-semibold',
                HEADING_CLASSES[segment.level ?? 1] ?? 'text-base',
              ]
            : 'text-sm'
        "
      >
        <span
          v-if="segment.marker"
          class="mr-2 text-muted-foreground tabular-nums"
          >{{ /^\d/.test(segment.marker) ? segment.marker : "•" }}</span
        ><template v-for="(part, partIndex) in segment.parts" :key="partIndex"
          ><ins
            v-if="part.type === 'added'"
            class="rounded-sm bg-emerald-500/20 text-emerald-800 no-underline dark:text-emerald-200"
            >{{ part.text }}</ins
          ><del
            v-else-if="part.type === 'removed'"
            class="rounded-sm bg-red-500/15 text-red-700 dark:text-red-300"
            >{{ part.text }}</del
          ><span v-else>{{ part.text }}</span></template
        >
      </div>
    </template>
  </div>
</template>
