<script setup lang="ts">
import {
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  useTemplateRef,
  watch,
} from "vue";
import { useI18n } from "vue-i18n";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import type { MindSheet } from "@/lib/mindmap";
import { resolveColors } from "@/lib/themeColors";
import { useThemeRoot } from "@/composables/useThemeRoot";
import { useAppearanceStore } from "@/stores/appearance";
import { readPreviewBytes } from "./previewBytes";
import type {
  AnnotationRevealRequest,
  AnnotationTarget,
  PreviewRendererCapabilities,
  PreviewRendererEvents,
  PreviewRendererProps,
} from "./previewRenderer";
import { usePreviewToolbar } from "./usePreviewToolbar";
import ZoomableImage from "./ZoomableImage.vue";

const themeRoot = useThemeRoot();
const props = defineProps<PreviewRendererProps>();
const emit = defineEmits<PreviewRendererEvents>();
const { t } = useI18n();
const appearance = useAppearanceStore();
const toolbar = usePreviewToolbar(() => props.compact);
const stage = useTemplateRef<InstanceType<typeof ZoomableImage>>("stage");

const sheets = shallowRef<MindSheet[]>([]);
const sheet = ref("0");
const image = ref<string>();
/** The sheet the image shows; `sheet` changes before it renders. */
const shownSheet = ref(0);
const loaded = ref(false);
const reading = new AbortController();

async function render(): Promise<void> {
  const current = sheets.value[Number(sheet.value)];
  if (!current) return;
  const { renderMindMap } = await import("@/lib/mindmap");
  const svg = renderMindMap(current, {
    ...resolveColors(
      {
        background: "--background",
        foreground: "--foreground",
        muted: "--muted",
        mutedForeground: "--muted-foreground",
        border: "--border",
        primary: "--primary",
        primaryForeground: "--primary-foreground",
      },
      themeRoot(),
    ),
    font: getComputedStyle(document.body).fontFamily,
  });
  if (image.value) URL.revokeObjectURL(image.value);
  image.value = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  shownSheet.value = Number(sheet.value);
}

function capabilities(): Partial<PreviewRendererCapabilities> {
  return {
    zoom: !props.compact,
    fitWidth: !props.compact,
    zoomMin: 10,
    zoomMax: 400,
    toolbar: sheets.value.length > 1,
    annotateRegions: loaded.value,
  };
}

function imageLoaded(): void {
  if (loaded.value) return;
  loaded.value = true;
  emit("capabilitiesChange", capabilities());
}

function sheetName(index: number): string {
  return (
    sheets.value[index]?.title ||
    t("project.preview.sheetFallback", { index: index + 1 })
  );
}

/** The drawn map; each sheet of a workbook is its own segment. */
function annotationTargets(): readonly AnnotationTarget[] {
  const target = stage.value?.annotationTarget();
  if (!target) return [];
  if (sheets.value.length < 2) return [target];
  const index = shownSheet.value;
  return [
    {
      ...target,
      segment: `sheet:${index}`,
      place: { kind: "sheet", name: sheetName(index) },
    },
  ];
}

function revealAnnotation(request: AnnotationRevealRequest): void {
  const match = /^sheet:(\d+)$/.exec(request.segment ?? "");
  const place = request.place;
  let index = -1;
  if (match) index = Number(match[1]);
  else if (place?.kind === "sheet")
    index = sheets.value.findIndex(
      (_, candidate) => sheetName(candidate) === place.name,
    );
  if (index >= 0 && index < sheets.value.length) sheet.value = String(index);
}

/** The central topic and how many topics the map has, for Details. */
async function describe(): Promise<void> {
  try {
    const { mindMapProperties } =
      await import("@/lib/previewProperties/structure");
    emit("metadataChange", { properties: mindMapProperties(sheets.value) });
  } catch (error) {
    console.error("Failed to read the mind map's properties.", error);
  }
}

onMounted(async () => {
  emit("capabilitiesChange", capabilities());
  try {
    const { readMindMap } = await import("@/lib/mindmap");
    sheets.value = await readMindMap(
      await readPreviewBytes(props.preview, reading.signal),
    );
    if (sheets.value.length > 1) emit("capabilitiesChange", capabilities());
    await render();
    void describe();
  } catch (error) {
    if (reading.signal.aborted) return;
    console.error("Failed to read the mind map.", error);
    emit("failed");
  }
});
watch(sheet, () => void render());
watch(
  () => appearance.colorScheme,
  // Tokens resolve after the theme class switches.
  () => requestAnimationFrame(() => void render()),
);
onBeforeUnmount(() => {
  reading.abort();
  if (image.value) URL.revokeObjectURL(image.value);
});

defineExpose({
  fitWidth: () => stage.value?.fitWidth(),
  annotationTargets,
  revealAnnotation,
});
</script>

<template>
  <div class="relative h-full min-h-0">
    <Teleport v-if="toolbar && sheets.length > 1" :to="toolbar">
      <Select v-model="sheet">
        <SelectTrigger
          size="sm"
          class="w-56"
          :aria-label="t('project.preview.sheet')"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem
            v-for="(item, index) in sheets"
            :key="index"
            :value="String(index)"
            >{{ sheetName(index) }}</SelectItem
          >
        </SelectContent>
      </Select>
    </Teleport>
    <ZoomableImage
      v-if="image"
      ref="stage"
      :src="image"
      :alt="fileName"
      :zoom="zoom"
      :compact="compact"
      :max-fit="1.5"
      :checkerboard="false"
      @load="imageLoaded"
      @error="emit('failed')"
      @zoom-change="emit('zoomChange', $event)"
    />
    <div v-else class="absolute inset-0 grid place-items-center" role="status">
      <Spinner class="size-5 text-muted-foreground" />
    </div>
  </div>
</template>
