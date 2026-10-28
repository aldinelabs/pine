<script setup lang="ts">
import type { EdaLayoutPreview } from "@file-viewer/eda-layout";
import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  triggerRef,
  useTemplateRef,
  watch,
} from "vue";
import { useI18n } from "vue-i18n";
import { Eye, EyeOff } from "@lucide/vue";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { layerColor, type OrcadContents } from "@/lib/eda";
import { resolveColors } from "@/lib/themeColors";
import { useThemeRoot } from "@/composables/useThemeRoot";
import { cn } from "@/lib/utils";
import { previewExtension } from "@/shared/previewFormats";
import { useAppearanceStore } from "@/stores/appearance";
import DataGrid from "./DataGrid.vue";
import { readPreviewBytes } from "./previewBytes";
import type {
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

const layout = shallowRef<EdaLayoutPreview>();
const orcad = shallowRef<OrcadContents>();
const layers = ref<number[]>([]);
const hidden = shallowRef(new Set<number>());
const image = ref<string>();
const view = ref<"streams" | "strings">("streams");
const reading = new AbortController();

const table = computed(() => {
  const contents = orcad.value;
  if (!contents) return undefined;
  if (view.value === "streams" && contents.streams.length)
    return {
      columns: [
        { key: "path", label: t("project.preview.edaStream") },
        { key: "size", label: t("project.preview.edaSize") },
      ],
      rows: contents.streams,
    };
  return {
    columns: [{ key: "text", label: t("project.preview.edaText") }],
    rows: contents.strings.map((text) => [text]),
  };
});
const loadRows = computed(() => {
  const rows = table.value?.rows ?? [];
  return (start: number, end: number) =>
    Promise.resolve(rows.slice(start, end));
});

async function render(): Promise<void> {
  if (!layout.value) return;
  const { renderLayout } = await import("@/lib/eda");
  const colors = resolveColors(
    {
      background: "--background",
      text: "--foreground",
    },
    themeRoot(),
  );
  const svg = renderLayout(layout.value, hidden.value, colors);
  if (image.value) URL.revokeObjectURL(image.value);
  image.value = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
}

function toggle(layer: number): void {
  const next = new Set(hidden.value);
  if (next.has(layer)) next.delete(layer);
  else next.add(layer);
  hidden.value = next;
  triggerRef(hidden);
  void render();
}

onMounted(async () => {
  const extension = previewExtension(props.filePath);
  const isLayout = ["gds", "oas", "oasis"].includes(extension);
  emit("capabilitiesChange", {
    zoom: isLayout && !props.compact,
    fitWidth: isLayout && !props.compact,
    zoomMin: 5,
    zoomMax: 2000,
    toolbar: !isLayout && !props.compact,
  });
  try {
    const bytes = new Uint8Array(
      await readPreviewBytes(props.preview, reading.signal),
    );
    const eda = await import("@/lib/eda");
    if (isLayout) {
      layout.value = await eda.readLayout(bytes, extension);
      layers.value = eda.layoutLayers(layout.value);
      await render();
    } else {
      orcad.value = await eda.readOrcad(bytes);
      if (!orcad.value.streams.length) view.value = "strings";
    }
  } catch (error) {
    if (reading.signal.aborted) return;
    console.error("Failed to read the EDA file.", error);
    emit("failed");
  }
});
watch(
  () => appearance.colorScheme,
  () => requestAnimationFrame(() => void render()),
);
onBeforeUnmount(() => {
  reading.abort();
  if (image.value) URL.revokeObjectURL(image.value);
});

defineExpose({ fitWidth: () => stage.value?.fitWidth() });
</script>

<template>
  <div class="flex h-full min-h-0">
    <Teleport v-if="toolbar && orcad" :to="toolbar">
      <ToggleGroup
        v-model="view"
        type="single"
        variant="outline"
        size="sm"
        :aria-label="t('project.preview.edaView')"
      >
        <ToggleGroupItem value="streams" :disabled="!orcad.streams.length">{{
          t("project.preview.edaStreams", { count: orcad.streams.length })
        }}</ToggleGroupItem>
        <ToggleGroupItem value="strings">{{
          t("project.preview.edaStrings", { count: orcad.strings.length })
        }}</ToggleGroupItem>
      </ToggleGroup>
    </Teleport>

    <template v-if="layout">
      <div class="relative min-w-0 flex-1">
        <ZoomableImage
          v-if="image"
          ref="stage"
          :src="image"
          :alt="fileName"
          :zoom="zoom"
          :compact="compact"
          :max-fit="8"
          :checkerboard="false"
          @error="emit('failed')"
          @zoom-change="emit('zoomChange', $event)"
        />
      </div>
      <aside
        v-if="!compact && layers.length > 1"
        class="flex w-44 shrink-0 flex-col border-l"
        :aria-label="t('project.preview.layers')"
      >
        <div class="flex h-10 shrink-0 items-center px-3 text-sm font-medium">
          {{ t("project.preview.layers") }}
        </div>
        <ScrollArea class="min-h-0 flex-1">
          <ul class="flex flex-col gap-0.5 px-2 pb-2">
            <li v-for="layer in layers" :key="layer">
              <Button
                variant="ghost"
                size="sm"
                :aria-pressed="!hidden.has(layer)"
                :class="
                  cn(
                    'w-full justify-start',
                    hidden.has(layer) && 'text-muted-foreground',
                  )
                "
                @click="toggle(layer)"
              >
                <EyeOff v-if="hidden.has(layer)" data-icon="inline-start" />
                <Eye v-else data-icon="inline-start" />
                <span
                  class="size-2.5 rounded-sm"
                  :style="{ background: layerColor(layer) }"
                />
                {{ t("project.preview.edaLayer", { layer }) }}
              </Button>
            </li>
          </ul>
        </ScrollArea>
      </aside>
    </template>

    <DataGrid
      v-else-if="table"
      class="flex-1"
      :columns="table.columns"
      :row-count="table.rows.length"
      :load-rows="loadRows"
      @failed="emit('failed')"
    />

    <div v-else class="grid flex-1 place-items-center" role="status">
      <Spinner class="size-5 text-muted-foreground" />
    </div>
  </div>
</template>
