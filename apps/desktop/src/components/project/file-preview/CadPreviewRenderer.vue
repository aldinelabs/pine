<script setup lang="ts">
import type {
  CadDocument,
  CadViewer,
  CadViewerLoadResult,
} from "@flyfish-dev/cad-viewer";
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
import {
  Contrast,
  Eye,
  EyeOff,
  ImageDown,
  Minus,
  Plus,
  Scan,
} from "@lucide/vue";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { Toggle } from "@/components/ui/toggle";
import { resolveColors, toHex } from "@/lib/themeColors";
import { cn } from "@/lib/utils";
import { useAppearanceStore } from "@/stores/appearance";
import { readPreviewBytes } from "./previewBytes";
import type {
  PreviewRendererEvents,
  PreviewRendererProps,
} from "./previewRenderer";
import { usePreviewToolbar } from "./usePreviewToolbar";

const props = defineProps<PreviewRendererProps>();
const emit = defineEmits<PreviewRendererEvents>();
const { t, locale } = useI18n();
const appearance = useAppearanceStore();
const toolbar = usePreviewToolbar(() => props.compact);
const host = useTemplateRef<HTMLDivElement>("host");

const viewer = shallowRef<CadViewer>();
const result = shallowRef<CadViewerLoadResult>();
const hidden = shallowRef(new Set<string>());
const monochrome = ref(false);
const loading = ref(true);
const reading = new AbortController();
/** The view scale that fits the drawing; the zoom slider is relative to it. */
let fitScale = 1;
let applyingZoom = false;

/**
 * Layers by name. Documents list a layer under its name and its lowercase
 * key, so keys that share a name toggle together.
 */
const layers = computed(() => {
  const byName = new Map<
    string,
    { key: string; name: string; keys: string[] }
  >();
  for (const [key, layer] of Object.entries(
    result.value?.document.layers ?? {},
  )) {
    const name = layer.name || key;
    const id = name.toLocaleLowerCase();
    const entry = byName.get(id);
    if (entry) entry.keys.push(key);
    else byName.set(id, { key: id, name, keys: [key] });
  }
  return [...byName.values()].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true }),
  );
});
const summary = computed(() => {
  const value = result.value?.summary;
  if (!value) return "";
  return t("project.preview.cadStats", {
    entities: value.entityCount.toLocaleString(locale.value),
    layers: value.layerCount.toLocaleString(locale.value),
  });
});

/** Drawing settings: the app's colors, with drawing colors kept legible on them. */
function canvasOptions() {
  const colors = resolveColors({
    background: "--background",
    foreground: "--foreground",
  });
  return {
    background: toHex(colors.background),
    foreground: toHex(colors.foreground),
    contrastMode: "adaptive" as const,
    minColorContrast: 2.4,
    showPageBounds: true,
    showUnsupportedMarkers: true,
    enableSpatialIndex: true,
    maxVisibleTextLabels: 2400,
    // Saved DWG views often frame a corner of the drawing; show it whole.
    fitMode: "extents" as const,
  };
}

/** Shows the source drawing with the chosen layers turned off. */
function applyLayers(): void {
  const instance = viewer.value;
  const source = instance?.getSourceDocument();
  if (!instance || !source) return;
  const document: CadDocument = {
    ...source,
    layers: Object.fromEntries(
      Object.entries(source.layers).map(([key, layer]) => [
        key,
        {
          ...layer,
          isVisible:
            layer.isVisible !== false &&
            !hidden.value.has((layer.name || key).toLocaleLowerCase()),
        },
      ]),
    ),
  };
  instance.setDocument(document, props.fileName);
}

function toggleLayer(key: string): void {
  const next = new Set(hidden.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  hidden.value = next;
  triggerRef(hidden);
  applyLayers();
}

function showAllLayers(visible: boolean): void {
  hidden.value = new Set(visible ? [] : layers.value.map((layer) => layer.key));
  applyLayers();
}

function setZoom(percent: number): void {
  const renderer = viewer.value?.renderer;
  if (!renderer) return;
  applyingZoom = true;
  renderer.setViewState({
    ...renderer.getViewState(),
    scale: fitScale * (percent / 100),
  });
  applyingZoom = false;
}

async function exportImage(): Promise<void> {
  const canvas = await viewer.value?.captureCanvas();
  if (!canvas) return;
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png"),
  );
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${props.fileName.replace(/\.\w+$/, "")}.png`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

onMounted(async () => {
  emit("capabilitiesChange", {
    zoom: !props.compact,
    gestureZoom: true,
    zoomMin: 1,
    zoomMax: 10000,
    toolbar: !props.compact,
  });
  const element = host.value;
  if (!element) return;
  try {
    const [{ CadViewer }, { resolveFileViewerCadAssetUrls }, bytes] =
      await Promise.all([
        import("@flyfish-dev/cad-viewer"),
        import("@file-viewer/core/assets"),
        readPreviewBytes(props.preview, reading.signal),
      ]);
    if (reading.signal.aborted) return;
    const assets = resolveFileViewerCadAssetUrls(
      undefined,
      new URL("file-viewer/", document.baseURI).href,
    );
    const instance = new CadViewer({
      container: element,
      renderer: "auto",
      autoFit: true,
      ...assets,
      canvasOptions: canvasOptions(),
      onViewChange: (event) => {
        fitScale = event.fitScale || 1;
        if (!applyingZoom && !props.compact)
          emit("zoomChange", Math.round(event.zoomPercent));
      },
    });
    viewer.value = instance;
    result.value = await instance.loadBuffer(bytes, props.fileName, assets);
    hidden.value = new Set(
      Object.entries(result.value.document.layers)
        .filter(([, layer]) => layer.isVisible === false)
        .map(([key, layer]) => (layer.name || key).toLocaleLowerCase()),
    );
    emit("metadataChange", {
      pageCount: result.value.summary.pageCount || undefined,
    });
  } catch (error) {
    if (reading.signal.aborted) return;
    console.error("Failed to render the CAD drawing.", error);
    emit("failed");
  } finally {
    loading.value = false;
  }
});

watch(monochrome, (value) =>
  viewer.value?.setColorMode(value ? "monochrome" : "source"),
);
watch(
  () => props.zoom,
  (value) => {
    if (!props.compact && viewer.value) setZoom(value);
  },
);
watch(
  () => appearance.colorScheme,
  () =>
    requestAnimationFrame(() =>
      viewer.value?.setCanvasOptions(canvasOptions()),
    ),
);

onBeforeUnmount(() => {
  reading.abort();
  viewer.value?.destroy();
});
</script>

<template>
  <div class="flex h-full min-h-0">
    <Teleport v-if="toolbar && result" :to="toolbar">
      <Button
        variant="ghost"
        size="icon-sm"
        :aria-label="t('project.preview.modelFit')"
        :title="t('project.preview.modelFit')"
        @click="viewer?.fit('extents')"
      >
        <Scan />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        :aria-label="t('project.preview.zoomOut')"
        @click="viewer?.zoomOut()"
      >
        <Minus />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        :aria-label="t('project.preview.zoomIn')"
        @click="viewer?.zoomIn()"
      >
        <Plus />
      </Button>
      <Toggle
        v-model="monochrome"
        size="sm"
        :aria-label="t('project.preview.cadMonochrome')"
        :title="t('project.preview.cadMonochrome')"
      >
        <Contrast />
      </Toggle>
      <Button
        variant="ghost"
        size="icon-sm"
        :aria-label="t('project.preview.cadExport')"
        :title="t('project.preview.cadExport')"
        @click="exportImage"
      >
        <ImageDown />
      </Button>
      <span class="truncate text-sm text-muted-foreground">{{ summary }}</span>
    </Teleport>
    <div class="relative min-w-0 flex-1">
      <div
        ref="host"
        data-slot="cad-preview"
        class="absolute inset-0 overflow-hidden [&_canvas]:block [&_canvas]:size-full"
      />
      <div
        v-if="loading"
        class="absolute inset-0 grid place-items-center bg-background"
        role="status"
      >
        <Spinner class="size-5 text-muted-foreground" />
      </div>
    </div>
    <aside
      v-if="!compact && layers.length > 1"
      class="flex w-56 shrink-0 flex-col border-l"
      :aria-label="t('project.preview.layers')"
    >
      <div class="flex h-10 shrink-0 items-center gap-1 pr-2 pl-3">
        <span class="flex-1 text-sm font-medium">{{
          t("project.preview.layers")
        }}</span>
        <Button
          variant="ghost"
          size="icon-xs"
          :aria-label="t('project.preview.showAllLayers')"
          @click="showAllLayers(true)"
        >
          <Eye />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          :aria-label="t('project.preview.hideAllLayers')"
          @click="showAllLayers(false)"
        >
          <EyeOff />
        </Button>
      </div>
      <ScrollArea class="min-h-0 flex-1">
        <ul class="flex flex-col gap-0.5 px-2 pb-2">
          <li v-for="layer in layers" :key="layer.key">
            <button
              type="button"
              :aria-pressed="!hidden.has(layer.key)"
              :class="
                cn(
                  'flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-sm outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30',
                  hidden.has(layer.key) && 'text-muted-foreground',
                )
              "
              @click="toggleLayer(layer.key)"
            >
              <EyeOff v-if="hidden.has(layer.key)" class="size-3.5 shrink-0" />
              <Eye v-else class="size-3.5 shrink-0" />
              <span class="truncate">{{ layer.name }}</span>
            </button>
          </li>
        </ul>
      </ScrollArea>
    </aside>
  </div>
</template>
