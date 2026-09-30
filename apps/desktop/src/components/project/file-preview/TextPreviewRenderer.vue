<script setup lang="ts">
import { computed, useTemplateRef, watch } from "vue";
import { useEventListener } from "@vueuse/core";
import { getMarkdown, parseMarkdownToStructure } from "markstream-vue";
import CodeBlock from "@/components/markdown/CodeBlock.vue";
import { disableMarkdownReplacements } from "@/components/markdown/configureMarkdown";
import MarkdownContent from "@/components/markdown/MarkdownContent.vue";
import { ScrollArea } from "@/components/ui/scroll-area";
import { fileLanguage } from "@/lib/fileLanguage";
import { filePreviewSelection } from "@/lib/filePreviewSelection";
import type { AttachmentSelection } from "@/shared/attachments";
import ProjectHtmlPreview from "../ProjectHtmlPreview.vue";
import type {
  PreviewRendererEvents,
  PreviewRendererProps,
} from "./previewRenderer";

const props = defineProps<PreviewRendererProps>();
const emit = defineEmits<PreviewRendererEvents>();
const content = useTemplateRef<HTMLDivElement>("content");
const source = computed(() =>
  props.preview.kind === "text" ? props.preview.text : "",
);
const language = computed(() => fileLanguage(props.filePath));
const rendered = computed(() => props.mode === "rendered");
const renderedHtml = computed(
  () => rendered.value && language.value === "html",
);
const markdownNodes = computed(() =>
  rendered.value && language.value === "markdown"
    ? parseMarkdownToStructure(
        source.value,
        disableMarkdownReplacements(getMarkdown("pine-preview")),
        {
          final: true,
          includeSourceMap: true,
        },
      )
    : undefined,
);

function readSelection(): AttachmentSelection | undefined {
  return props.active && content.value
    ? filePreviewSelection(content.value, source.value, markdownNodes.value)
    : undefined;
}

function updateSelection(): void {
  emit("selectionChange", readSelection());
}

useEventListener(document, "selectionchange", updateSelection);
watch(() => props.mode, updateSelection);
defineExpose({ readSelection });
</script>

<template>
  <ProjectHtmlPreview
    v-if="renderedHtml"
    class="h-full min-h-0"
    :source="source"
    :title="fileName"
    :zoom="zoom"
    @zoom-wheel="emit('zoomWheel', $event)"
  />
  <ScrollArea
    v-else
    class="h-full min-h-0 min-w-0 [&_[data-slot=scroll-area-viewport]]:scroll-fade"
  >
    <div
      ref="content"
      class="min-w-0 px-4 pb-4"
      @pointerup="updateSelection"
      @keyup="updateSelection"
    >
      <MarkdownContent
        v-if="rendered && language === 'markdown'"
        class="mx-auto w-full max-w-[var(--session-content-max-width)] py-4"
        :source="source"
        :nodes="markdownNodes"
        final
      />
      <CodeBlock
        v-else
        layout="preview"
        :node="{
          type: 'code_block',
          code: source,
          language: source.length > 200_000 ? 'text' : language,
        }"
      />
    </div>
  </ScrollArea>
</template>
