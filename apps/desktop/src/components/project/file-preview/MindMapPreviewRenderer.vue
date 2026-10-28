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
import { useAppearanceStore } from "@/stores/appearance";
import { readPreviewBytes } from "./previewBytes";
import type {
  PreviewRendererEvents,
  PreviewRendererProps,
} from "./previewRenderer";
import { usePreviewToolbar } from "./usePreviewToolbar";
import ZoomableImage from "./ZoomableImage.vue";

const props = defineProps<PreviewRendererProps>();
const emit = defineEmits<PreviewRendererEvents>();
const { t } = useI18n();
const appearance = useAppearanceStore();
const toolbar = usePreviewToolbar(() => props.compact);
const stage = useTemplateRef<InstanceType<typeof ZoomableImage>>("stage");

const sheets = shallowRef<MindSheet[]>([]);
const sheet = ref("0");
const image = ref<string>();
const reading = new AbortController();

async function render(): Promise<void> {
  const current = sheets.value[Number(sheet.value)];
  if (!current) return;
  const { renderMindMap } = await import("@/lib/mindmap");
  const svg = renderMindMap(current, {
    ...resolveColors({
      background: "--background",
      foreground: "--foreground",
      muted: "--muted",
      mutedForeground: "--muted-foreground",
      border: "--border",
      primary: "--primary",
      primaryForeground: "--primary-foreground",
    }),
    font: getComputedStyle(document.body).fontFamily,
  });
  if (image.value) URL.revokeObjectURL(image.value);
  image.value = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
}

onMounted(async () => {
  emit("capabilitiesChange", {
    zoom: !props.compact,
    fitWidth: !props.compact,
    zoomMin: 10,
    zoomMax: 400,
  });
  try {
    const { readMindMap } = await import("@/lib/mindmap");
    sheets.value = await readMindMap(
      await readPreviewBytes(props.preview, reading.signal),
    );
    if (sheets.value.length > 1) emit("capabilitiesChange", { toolbar: true });
    await render();
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

defineExpose({ fitWidth: () => stage.value?.fitWidth() });
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
            >{{
              item.title ||
              t("project.preview.sheetFallback", { index: index + 1 })
            }}</SelectItem
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
      @error="emit('failed')"
      @zoom-change="emit('zoomChange', $event)"
    />
    <div v-else class="absolute inset-0 grid place-items-center" role="status">
      <Spinner class="size-5 text-muted-foreground" />
    </div>
  </div>
</template>
