<script setup lang="ts">
import { ImageNode } from "markstream-vue";
import { computed, inject, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { ImageOff } from "@lucide/vue";
import { resolveMarkdownImageSrc } from "@/lib/markdownImage";
import { markdownImageDocumentUrl } from "./markdownImageContext";

/**
 * The `node` markstream hands a custom `image` renderer. `loading` mirrors
 * the streaming flag markstream passes its own image renderer.
 */
interface MarkdownImageNodeProps {
  node: {
    type: "image";
    src: string;
    alt: string;
    title: string | null;
    raw: string;
    loading?: boolean;
  };
  loading?: boolean;
}

const props = defineProps<MarkdownImageNodeProps>();
const documentUrl = inject(markdownImageDocumentUrl, undefined);
const { t } = useI18n();
const failed = ref(false);

/**
 * Markdown images must resolve like Typora's: remote and inline-data URLs
 * load directly, while local files route through `pine-attachment://` so the
 * main process can validate the path. ImageNode sanitizes custom protocols
 * out of its src, so native images render those two Pine protocols directly.
 * Remote and inline-data images retain markstream's ImageNode behavior.
 */
const displayNode = computed(() => ({
  ...props.node,
  src: resolveMarkdownImageSrc(props.node.src, documentUrl?.value),
}));

const isLoading = computed(() => props.loading ?? props.node.loading);
const isLocal = computed(() =>
  /^pine-(?:attachment|project-media):\/\//u.test(displayNode.value.src),
);
watch(
  () => displayNode.value.src,
  () => {
    failed.value = false;
  },
);
</script>

<template>
  <span v-if="isLocal" class="block my-4">
    <img
      v-if="!failed"
      :src="displayNode.src"
      :alt="displayNode.alt"
      :title="displayNode.title ?? undefined"
      class="max-w-full h-auto rounded-md"
      @error="failed = true"
    />
    <span
      v-else
      role="status"
      class="flex items-center gap-2 rounded-md bg-muted p-4 text-sm text-muted-foreground"
    >
      <ImageOff class="size-4 shrink-0" aria-hidden="true" />
      {{ t("markdown.imageLoadFailed") }}
    </span>
  </span>
  <ImageNode v-else :node="displayNode" :loading="isLoading" />
</template>
