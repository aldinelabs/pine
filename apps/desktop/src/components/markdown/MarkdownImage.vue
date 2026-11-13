<script setup lang="ts">
import { ImageNode } from "markstream-vue";
import { computed, inject, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { ImageOff } from "@lucide/vue";
import { resolveMarkdownImageSrc } from "@/lib/markdownImage";
import {
  markdownImageDocumentUrl,
  markdownImageName,
  markdownImageZoom,
} from "./markdownImageContext";

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
const zoomImage = inject(markdownImageZoom, undefined);
const { t } = useI18n();
const failed = ref(false);
const loaded = ref(false);
const root = ref<HTMLElement>();

/**
 * Markdown images must resolve like Typora's: remote and inline-data URLs
 * load directly, while local files route through `pine-attachment://` so the
 * main process can validate the path. ImageNode sanitizes custom protocols
 * out of its src, so native images render those two Pine protocols directly.
 * Remote and inline-data images retain markstream's ImageNode behavior.
 */
// markstream hands over a new `node` object on every parse. Each field is its
// own computed so an unchanged image yields the same `displayNode` object and
// the rendered ImageNode is not patched on every streamed flush.
const src = computed(() =>
  resolveMarkdownImageSrc(props.node.src, documentUrl?.value),
);
const alt = computed(() => props.node.alt);
const title = computed(() => props.node.title);
const raw = computed(() => props.node.raw);
const nodeLoading = computed(() => props.node.loading);
const displayNode = computed(() => ({
  type: "image" as const,
  src: src.value,
  alt: alt.value,
  title: title.value,
  raw: raw.value,
  ...(nodeLoading.value === undefined ? {} : { loading: nodeLoading.value }),
}));

const isLoading = computed(() => props.loading ?? props.node.loading);
const isLocal = computed(() =>
  /^pine-(?:attachment|project-media):\/\//u.test(displayNode.value.src),
);
watch(
  () => displayNode.value.src,
  () => {
    failed.value = false;
    loaded.value = false;
  },
);

const name = computed(
  () =>
    markdownImageName(alt.value, props.node.src) ||
    t("markdown.imageViewer.untitled"),
);
// A linked image follows its link instead of opening the enlarged view.
const insideLink = ref(false);
onMounted(() => {
  insideLink.value = Boolean(root.value?.parentElement?.closest("a"));
});
/** Only an image that loaded opens the enlarged view; a broken one cannot. */
const canZoom = computed(() => Boolean(zoomImage?.value));
const zoomable = computed(
  () => canZoom.value && loaded.value && !failed.value && !insideLink.value,
);

function imageLoaded(): void {
  failed.value = false;
  loaded.value = true;
  // The first image that can open schedules the viewer's code for idle time.
  if (canZoom.value) zoomImage?.value?.preload();
}

/** The pointer or focus on an image fetches the viewer's code right away. */
function preloadViewer(): void {
  if (zoomable.value) zoomImage?.value?.preload(true);
}

function imageFailed(): void {
  failed.value = true;
  loaded.value = false;
}

function openViewer(): void {
  if (zoomable.value && root.value) zoomImage?.value?.open(root.value);
}

function handleKeydown(event: KeyboardEvent): void {
  if (!zoomable.value || (event.key !== "Enter" && event.key !== " ")) return;
  event.preventDefault();
  openViewer();
}
</script>

<template>
  <span
    v-if="isLocal"
    ref="root"
    class="block my-4"
    data-markdown-image
    :data-image-name="name"
    :data-zoomable="zoomable ? 'true' : undefined"
  >
    <img
      v-if="!failed"
      :src="displayNode.src"
      :alt="displayNode.alt"
      :title="displayNode.title ?? undefined"
      :role="zoomable ? 'button' : undefined"
      :tabindex="zoomable ? 0 : undefined"
      :aria-label="
        zoomable ? t('markdown.imageViewer.open', { name }) : undefined
      "
      :class="[
        'max-w-full h-auto rounded-md',
        zoomable &&
          'cursor-zoom-in outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
      ]"
      @load="imageLoaded"
      @error="imageFailed"
      @click="openViewer"
      @keydown="handleKeydown"
      @pointerenter="preloadViewer"
      @focus="preloadViewer"
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
  <span
    v-else-if="canZoom"
    ref="root"
    data-markdown-image
    :data-image-name="name"
    :data-zoomable="zoomable ? 'true' : undefined"
    :class="zoomable && 'markdown-image-zoomable'"
    @keydown="handleKeydown"
    @pointerenter="preloadViewer"
    @focusin="preloadViewer"
  >
    <ImageNode
      :node="displayNode"
      :loading="isLoading"
      @load="imageLoaded"
      @error="imageFailed"
      @click="openViewer"
    />
  </span>
  <ImageNode v-else :node="displayNode" :loading="isLoading" />
</template>

<style scoped>
/* markstream marks a loaded image clickable; the enlarged view zooms in. */
.markdown-image-zoomable :deep(img) {
  cursor: zoom-in;
}
</style>
