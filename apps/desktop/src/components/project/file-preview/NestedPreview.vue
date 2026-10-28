<script setup lang="ts">
import { computed, onBeforeUnmount, shallowRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import { FileQuestion } from "@lucide/vue";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  audioPreviewExtensions,
  documentPreviewExtensions,
  previewExtension,
  renderedTextExtensions,
  videoPreviewExtensions,
} from "@/shared/previewFormats";
import {
  decodePreviewText,
  MAX_TEXT_PREVIEW_BYTES,
} from "@/shared/projectFiles";
import {
  resolvePreviewRenderer,
  type RenderablePreview,
} from "./previewRenderer";
import { previewRenderers } from "./previewRenderers";

/**
 * Previews a file held in memory, such as an archive entry or an email
 * attachment, with the same renderers as files on disk. It shows content
 * only: the surrounding preview keeps its own controls.
 */
const props = defineProps<{
  name: string;
  bytes: ArrayBuffer;
  active: boolean;
}>();
const { t } = useI18n();

const url = shallowRef<string>();
watch(
  () => props.bytes,
  (bytes, _old, onCleanup) => {
    const created = URL.createObjectURL(new Blob([bytes]));
    url.value = created;
    onCleanup(() => URL.revokeObjectURL(created));
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  if (url.value) URL.revokeObjectURL(url.value);
});

const preview = computed<RenderablePreview | undefined>(() => {
  const extension = previewExtension(props.name);
  const base = {
    size: props.bytes.byteLength,
    modifiedAt: new Date(0).toISOString(),
  };
  const href = url.value ?? "";
  if (videoPreviewExtensions.has(extension))
    return { ...base, kind: "video", url: href };
  if (audioPreviewExtensions.has(extension))
    return { ...base, kind: "audio", url: href };
  if (
    documentPreviewExtensions.has(extension) &&
    !renderedTextExtensions.has(extension)
  )
    return { ...base, kind: "document", url: href };
  if (props.bytes.byteLength <= MAX_TEXT_PREVIEW_BYTES) {
    const decoded = decodePreviewText(new Uint8Array(props.bytes));
    if (decoded) return { ...base, kind: "text", ...decoded, url: href };
  }
  return renderedTextExtensions.has(extension)
    ? { ...base, kind: "document", url: href }
    : undefined;
});

const renderer = computed(() =>
  preview.value
    ? resolvePreviewRenderer(previewRenderers, {
        preview: preview.value,
        filePath: props.name,
        mode: "rendered",
      })
    : undefined,
);
const failed = shallowRef(false);
watch(
  () => props.bytes,
  () => (failed.value = false),
);
</script>

<template>
  <component
    :is="renderer.component"
    v-if="renderer && preview && !failed"
    :key="url"
    class="min-h-0 flex-1"
    :preview="preview"
    :file-name="name.split('/').at(-1) ?? name"
    :file-path="name"
    :active="active"
    mode="rendered"
    :zoom="100"
    :inverted="false"
    :selection-label="name"
    compact
    @failed="failed = true"
  />
  <Empty v-else class="flex-1">
    <EmptyHeader>
      <EmptyMedia variant="icon"><FileQuestion /></EmptyMedia>
      <EmptyTitle>{{
        t(
          failed
            ? "project.preview.failedTitle"
            : "project.preview.unsupportedTitle",
        )
      }}</EmptyTitle>
      <EmptyDescription>{{ name.split("/").at(-1) }}</EmptyDescription>
    </EmptyHeader>
  </Empty>
</template>
