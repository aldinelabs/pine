<script setup lang="ts">
import { FootnoteNode } from "markstream-vue";
import { computed, inject } from "vue";
import { markdownCitations } from "./citation";

/** The `node` markstream hands a custom `footnote` renderer. */
interface Props {
  node: {
    type: "footnote";
    id: string;
    children: { type: string; raw: string }[];
    raw: string;
  };
  indexKey: string | number;
}

defineOptions({ inheritAttrs: false });

const props = defineProps<Props>();
const citations = inject(markdownCitations, undefined);
// A definition shown as an inline citation is not repeated as a footnote.
const isCitation = computed(() => citations?.value.has(props.node.id));
</script>

<template>
  <FootnoteNode
    v-if="!isCitation"
    v-bind="$attrs"
    :node="node"
    :index-key="indexKey"
  />
</template>
