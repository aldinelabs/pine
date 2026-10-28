<script setup lang="ts">
import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  useTemplateRef,
  watch,
} from "vue";
import { useI18n } from "vue-i18n";
import { MapPin, Route, Shapes } from "@lucide/vue";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { formatGridCell } from "@/lib/dataGrid";
import { featureName, geometryKind, type GeoFeature } from "@/lib/geo";
import { resolveColors } from "@/lib/themeColors";
import { useThemeRoot } from "@/composables/useThemeRoot";
import { cn } from "@/lib/utils";
import { previewExtension } from "@/shared/previewFormats";
import { useAppearanceStore } from "@/stores/appearance";
import { readPreviewBytes } from "./previewBytes";
import type {
  PreviewRendererEvents,
  PreviewRendererProps,
} from "./previewRenderer";
import ZoomableImage from "./ZoomableImage.vue";

const themeRoot = useThemeRoot();
const props = defineProps<PreviewRendererProps>();
const emit = defineEmits<PreviewRendererEvents>();
const { t, locale } = useI18n();
const appearance = useAppearanceStore();
const stage = useTemplateRef<InstanceType<typeof ZoomableImage>>("stage");

const features = shallowRef<GeoFeature[]>([]);
const selected = ref<number>();
const image = ref<string>();
const reading = new AbortController();

const properties = computed(() =>
  Object.entries(
    (selected.value !== undefined
      ? features.value[selected.value]?.properties
      : undefined) ?? {},
  ),
);

function icon(feature: GeoFeature) {
  const kind = geometryKind(feature);
  if (kind.includes("Point")) return MapPin;
  if (kind.includes("Line")) return Route;
  return Shapes;
}

async function render(): Promise<void> {
  if (!features.value.length) return;
  const { renderGeoMap } = await import("@/lib/geo");
  const colors = resolveColors(
    {
      background: "--background",
      grid: "--border",
      stroke: "--foreground",
      fill: "--muted-foreground",
      highlight: "--primary",
      label: "--muted-foreground",
    },
    themeRoot(),
  );
  const svg = renderGeoMap(
    features.value,
    { ...colors, font: getComputedStyle(document.body).fontFamily },
    selected.value,
  );
  if (image.value) URL.revokeObjectURL(image.value);
  image.value = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
}

function select(index: number): void {
  selected.value = selected.value === index ? undefined : index;
}

onMounted(async () => {
  emit("capabilitiesChange", {
    zoom: !props.compact,
    fitWidth: !props.compact,
    zoomMin: 10,
    zoomMax: 800,
  });
  try {
    const { readGeo } = await import("@/lib/geo");
    features.value = await readGeo(
      await readPreviewBytes(props.preview, reading.signal),
      previewExtension(props.filePath),
    );
    emit("metadataChange", {
      rowCount: features.value.length,
      columnCount: new Set(
        features.value.flatMap((feature) =>
          Object.keys(feature.properties ?? {}),
        ),
      ).size,
    });
    await render();
  } catch (error) {
    if (reading.signal.aborted) return;
    console.error("Failed to read the geodata.", error);
    emit("failed");
  }
});
watch(selected, () => void render());
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
  <div v-if="!image" class="grid h-full place-items-center" role="status">
    <Spinner class="size-5 text-muted-foreground" />
  </div>
  <ResizablePanelGroup v-else direction="horizontal">
    <ResizablePanel
      v-if="!compact"
      :default-size="28"
      :min-size="16"
      :max-size="50"
    >
      <div class="flex h-full min-h-0 flex-col">
        <ScrollArea class="min-h-0 flex-1">
          <ul class="flex flex-col gap-0.5 px-2 pb-2">
            <li v-for="(feature, index) in features" :key="index">
              <button
                type="button"
                :aria-pressed="selected === index"
                :class="
                  cn(
                    'flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-sm outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30',
                    selected === index && 'bg-muted',
                  )
                "
                @click="select(index)"
              >
                <component
                  :is="icon(feature)"
                  class="size-4 shrink-0 text-muted-foreground"
                />
                <span class="min-w-0 flex-1 truncate">{{
                  featureName(feature, index)
                }}</span>
                <span class="shrink-0 text-xs text-muted-foreground">{{
                  geometryKind(feature)
                }}</span>
              </button>
            </li>
          </ul>
        </ScrollArea>
        <ScrollArea
          v-if="properties.length"
          class="max-h-[45%] shrink-0 border-t"
        >
          <dl
            class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 px-4 py-3 text-sm"
          >
            <template v-for="[key, value] in properties" :key="key">
              <dt class="text-muted-foreground">{{ key }}</dt>
              <dd class="min-w-0 break-words">
                {{ formatGridCell(value, locale).text }}
              </dd>
            </template>
          </dl>
        </ScrollArea>
        <p
          v-else-if="selected !== undefined"
          class="border-t px-4 py-3 text-sm text-muted-foreground"
        >
          {{ t("project.preview.geoNoProperties") }}
        </p>
      </div>
    </ResizablePanel>
    <ResizableHandle v-if="!compact" />
    <ResizablePanel :default-size="72">
      <div class="relative h-full">
        <ZoomableImage
          ref="stage"
          :src="image"
          :alt="fileName"
          :zoom="zoom"
          :compact="compact"
          :max-fit="4"
          :checkerboard="false"
          @error="emit('failed')"
          @zoom-change="emit('zoomChange', $event)"
        />
      </div>
    </ResizablePanel>
  </ResizablePanelGroup>
</template>
