<script setup lang="ts">
import { FootnoteReferenceNode } from "markstream-vue";
import { computed, inject } from "vue";
import { Button } from "@/components/ui/button";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { markdownCitations } from "./citation";

/** The `node` markstream hands a custom `footnote_reference` renderer. */
interface Props {
  node: { type: "footnote_reference"; id: string; raw: string };
}

defineOptions({ inheritAttrs: false });

const props = defineProps<Props>();
const citations = inject(markdownCitations, undefined);
const citation = computed(() => citations?.value.get(props.node.id));
</script>

<template>
  <HoverCard v-if="citation" :open-delay="10" :close-delay="100">
    <HoverCardTrigger as-child>
      <!-- An anchor inside the markdown container, so MarkdownContent's
           external-link confirmation intercepts the click. -->
      <Button
        as="a"
        variant="secondary"
        size="xs"
        class="mx-0.5 h-5 px-2 align-baseline no-underline"
        data-slot="inline-citation"
        :href="citation.href"
        target="_blank"
        rel="noopener noreferrer"
      >
        {{ citation.hostname }}
      </Button>
    </HoverCardTrigger>
    <HoverCardContent class="flex w-72 flex-col gap-1">
      <div v-if="citation.title" class="font-medium">
        {{ citation.title }}
      </div>
      <div class="text-muted-foreground">{{ citation.hostname }}</div>
      <div class="break-all text-xs text-muted-foreground">
        {{ citation.href }}
      </div>
    </HoverCardContent>
  </HoverCard>
  <FootnoteReferenceNode v-else v-bind="$attrs" :node="node" />
</template>
