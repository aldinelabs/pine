<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  useTemplateRef,
  watch,
} from "vue";
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

let stopScrollRestore: (() => void) | undefined;
watch(source, () => {
  stopScrollRestore?.();
  const viewport = content.value?.closest<HTMLElement>(
    '[data-slot="scroll-area-viewport"]',
  );
  const root = content.value;
  if (!viewport || !root) return;
  const top = viewport.scrollTop;
  const left =
    root.querySelector<HTMLElement>(".code-preview-scroll")?.scrollLeft ?? 0;
  let stopped = false;
  const restore = (): void => {
    if (stopped) return;
    viewport.scrollTop = Math.min(
      top,
      Math.max(0, viewport.scrollHeight - viewport.clientHeight),
    );
    const code = root.querySelector<HTMLElement>(".code-preview-scroll");
    if (code)
      code.scrollLeft = Math.min(
        left,
        Math.max(0, code.scrollWidth - code.clientWidth),
      );
  };
  // Markdown and syntax highlighting can finish after Vue's first DOM update.
  // Continue through delayed layout changes until the user moves the viewport.
  const mutations = new MutationObserver(restore);
  const resize = new ResizeObserver(restore);
  mutations.observe(root, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  resize.observe(root);
  const inputRoot =
    viewport.closest<HTMLElement>('[data-slot="scroll-area"]') ?? viewport;
  const inputs = ["wheel", "pointerdown", "touchstart", "keydown"] as const;
  function stop(): void {
    stopped = true;
    mutations.disconnect();
    resize.disconnect();
    for (const input of inputs)
      inputRoot.removeEventListener(input, stop, true);
  }
  for (const input of inputs)
    inputRoot.addEventListener(input, stop, { capture: true, passive: true });
  stopScrollRestore = stop;
  void nextTick(restore);
});
watch(
  () => [props.mode, props.active],
  () => stopScrollRestore?.(),
);
onBeforeUnmount(() => stopScrollRestore?.());

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
