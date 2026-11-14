<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  useTemplateRef,
  watch,
} from "vue";
import { useI18n } from "vue-i18n";
import { PanelLeft } from "@lucide/vue";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { Toggle } from "@/components/ui/toggle";
import type { Ebook } from "@/lib/ebook";
import { resolveColors } from "@/lib/themeColors";
import { useThemeRoot } from "@/composables/useThemeRoot";
import { cn } from "@/lib/utils";
import { previewExtension } from "@/shared/previewFormats";
import { useAppearanceStore } from "@/stores/appearance";
import HtmlFrame from "./HtmlFrame.vue";
import PreviewPager from "./PreviewPager.vue";
import { readPreviewBytes } from "./previewBytes";
import type {
  AnnotationRevealRequest,
  AnnotationSurface,
  PreviewRendererEvents,
  PreviewRendererHandle,
  PreviewRendererProps,
} from "./previewRenderer";
import { usePreviewToolbar } from "./usePreviewToolbar";

const themeRoot = useThemeRoot();
const props = defineProps<PreviewRendererProps>();
const emit = defineEmits<PreviewRendererEvents>();
const { t } = useI18n();
const appearance = useAppearanceStore();
const toolbar = usePreviewToolbar(() => props.compact);

/** Body text size at 100% zoom, in pixels. */
const BASE_FONT = 17;

const book = shallowRef<Ebook>();
const chapter = ref(1);
const html = ref<string>();
/** The chapter `html` holds; `chapter` moves first, while it loads. */
const shown = ref(1);
const frame = useTemplateRef<InstanceType<typeof HtmlFrame>>("frame");
const contents = ref(true);
const colors = ref(readerColors());
const reading = new AbortController();
let opening = 0;

const fontSize = computed(() =>
  Math.round((BASE_FONT * (props.compact ? 100 : props.zoom)) / 100),
);
/** Book styles stay, but the page takes the app's colors and a reading measure. */
const stylesheet = computed(
  () => `
html, body { background: ${colors.value.background} !important; color: ${colors.value.foreground} !important; }
body { max-width: 40em; margin: 0 auto !important; padding: 2em 1.75em 4em !important; font-size: ${fontSize.value}px !important; line-height: 1.75; font-family: ${colors.value.font}; }
a { color: ${colors.value.primary} !important; }
img, svg, video { max-width: 100% !important; height: auto !important; }
pre { white-space: pre-wrap; }
table { max-width: 100%; }
`,
);

function readerColors() {
  return {
    ...resolveColors(
      {
        background: "--background",
        foreground: "--foreground",
        primary: "--primary",
      },
      themeRoot(),
    ),
    font: getComputedStyle(document.body).fontFamily,
  };
}

/** The chapter being opened, or the last one. */
let pending: Promise<void> = Promise.resolve();

function open(index: number): Promise<void> {
  return (pending = load(index));
}

async function load(index: number): Promise<void> {
  const target = book.value?.chapters[index - 1];
  if (!target) return;
  const current = ++opening;
  let loaded: string;
  try {
    loaded = await target.load();
  } catch (error) {
    if (current !== opening) return;
    console.error("Failed to open the chapter.", error);
    loaded = `<p>${t("project.preview.ebookChapterFailed")}</p>`;
  }
  if (current !== opening) return;
  html.value = loaded;
  shown.value = index;
}

/**
 * Comments anchor in the shown chapter's body, one segment per chapter by its
 * place in the book's contents. A chapter is one frame document, however
 * long, so offsets hold across scrolling.
 */
function annotationSurfaces(): readonly AnnotationSurface[] {
  const body = frame.value?.body();
  if (!body) return [];
  return [
    {
      root: body,
      segment: `chapter:${shown.value}`,
      place: {
        kind: "chapter",
        title:
          book.value?.chapters[shown.value - 1]?.title ||
          book.value?.title ||
          props.fileName,
      },
    },
  ];
}

/** Opens a comment's chapter. */
async function revealAnnotation(
  request: AnnotationRevealRequest,
): Promise<void> {
  const index = Number(/^chapter:(\d+)$/.exec(request.segment ?? "")?.[1]);
  if (!book.value?.chapters[index - 1]) return;
  chapter.value = index;
  await nextTick();
  await pending;
}

defineExpose<PreviewRendererHandle>({ annotationSurfaces, revealAnnotation });

onMounted(async () => {
  // Read the colors where the reader shows, now that it has an element.
  colors.value = readerColors();
  emit("capabilitiesChange", {
    zoom: !props.compact,
    zoomMin: 60,
    zoomMax: 200,
    toolbar: !props.compact,
  });
  try {
    const bytes = await readPreviewBytes(props.preview, reading.signal);
    const ebook = await import("@/lib/ebook");
    const readers: Record<string, (buffer: ArrayBuffer) => Promise<Ebook>> = {
      epub: ebook.readEpub,
      fb2: ebook.readFb2,
      umd: ebook.readUmd,
      chm: ebook.readChm,
    };
    const read = readers[previewExtension(props.filePath)];
    if (!read) throw new Error("No reader for this book format.");
    const opened = await read(bytes);
    if (reading.signal.aborted) {
      opened.close?.();
      return;
    }
    if (!opened.chapters.length) throw new Error("The book has no chapters.");
    book.value = opened;
    emit("metadataChange", { pageCount: opened.chapters.length });
    await open(1);
    if (!props.compact) emit("capabilitiesChange", { annotate: true });
  } catch (error) {
    if (reading.signal.aborted) return;
    console.error("Failed to read the book.", error);
    emit("failed");
  }
});

watch(chapter, (value) => void open(value));
watch(
  () => appearance.colorScheme,
  () => requestAnimationFrame(() => (colors.value = readerColors())),
);
onBeforeUnmount(() => {
  reading.abort();
  book.value?.close?.();
});
</script>

<template>
  <div class="flex h-full min-h-0">
    <Teleport v-if="toolbar && book" :to="toolbar">
      <Toggle
        v-model="contents"
        size="sm"
        :aria-label="t('project.preview.ebookContents')"
        :title="t('project.preview.ebookContents')"
      >
        <PanelLeft />
      </Toggle>
      <PreviewPager
        v-if="book.chapters.length > 1"
        v-model:page="chapter"
        :page-count="book.chapters.length"
      />
      <span class="truncate text-sm text-muted-foreground">{{
        book.chapters[chapter - 1]?.title
      }}</span>
    </Teleport>
    <aside
      v-if="book && contents && !compact && book.chapters.length > 1"
      class="flex w-64 shrink-0 flex-col border-r"
      :aria-label="t('project.preview.ebookContents')"
    >
      <div v-if="book.title" class="flex shrink-0 flex-col gap-0.5 px-4 pb-3">
        <span class="truncate text-sm font-medium">{{ book.title }}</span>
        <span
          v-if="book.author"
          class="truncate text-xs text-muted-foreground"
          >{{ book.author }}</span
        >
      </div>
      <ScrollArea class="min-h-0 flex-1">
        <ul class="flex flex-col gap-0.5 px-2 pb-2">
          <li v-for="(item, index) in book.chapters" :key="index">
            <button
              type="button"
              :aria-current="chapter === index + 1 ? 'page' : undefined"
              :class="
                cn(
                  'w-full truncate rounded-lg py-1.5 pr-2 text-left text-sm outline-none hover:bg-muted active:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30',
                  chapter === index + 1
                    ? 'bg-muted font-medium'
                    : 'text-muted-foreground',
                )
              "
              :style="{ paddingLeft: `${8 + item.depth * 14}px` }"
              :title="item.title"
              @click="chapter = index + 1"
            >
              {{ item.title }}
            </button>
          </li>
        </ul>
      </ScrollArea>
    </aside>
    <HtmlFrame
      v-if="html !== undefined"
      ref="frame"
      :key="shown"
      class="min-w-0 flex-1"
      :html="html"
      :title="book?.chapters[shown - 1]?.title ?? fileName"
      :stylesheet="stylesheet"
      :background="colors.background"
      @load="emit('annotationsChange')"
    />
    <div v-else class="grid flex-1 place-items-center" role="status">
      <Spinner class="size-5 text-muted-foreground" />
    </div>
  </div>
</template>
