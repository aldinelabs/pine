<script setup lang="ts">
import { computed } from "vue";

interface SnippetPart {
  highlighted: boolean;
  text: string;
}

const props = defineProps<{
  /** Characters kept before the first match so a truncated line still shows it. */
  leadingContext?: number;
  query: string;
  text: string;
}>();

const MARKER_PATTERN = /(\u0001[^\u0002]*\u0002)/g;

function escapeRegExp(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function splitParts(text: string, query: string): SnippetPart[] {
  if (text.includes("\u0001")) {
    return text
      .split(MARKER_PATTERN)
      .filter(Boolean)
      .map((part) => ({
        highlighted: part.startsWith("\u0001"),
        text: part.replaceAll("\u0001", "").replaceAll("\u0002", ""),
      }));
  }

  const trimmedQuery = query.trim();
  if (!trimmedQuery) return [{ highlighted: false, text }];

  const queryPattern = new RegExp(`(${escapeRegExp(trimmedQuery)})`, "giu");
  return text
    .split(queryPattern)
    .filter(Boolean)
    .map((part) => ({
      highlighted:
        part.toLocaleLowerCase() === trimmedQuery.toLocaleLowerCase(),
      text: part,
    }));
}

const parts = computed<SnippetPart[]>(() => {
  const result = splitParts(props.text, props.query);
  const context = props.leadingContext;
  const lead = result[0];
  if (context === undefined || !lead || lead.highlighted || result.length < 2)
    return result;

  const characters = Array.from(lead.text.trimStart());
  if (characters.length <= context) return result;
  return [
    {
      highlighted: false,
      text: `…${characters.slice(-context).join("").trimStart()}`,
    },
    ...result.slice(1),
  ];
});
</script>

<template>
  <span>
    <template v-for="(part, index) in parts" :key="index">
      <mark
        v-if="part.highlighted"
        class="rounded-[3px] bg-primary/20 font-medium text-foreground"
        >{{ part.text }}</mark
      >
      <template v-else>{{ part.text }}</template>
    </template>
  </span>
</template>
