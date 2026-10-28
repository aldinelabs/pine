<script setup lang="ts">
import type { Layer, Psd } from "ag-psd";
import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  triggerRef,
  useTemplateRef,
} from "vue";
import { useI18n } from "vue-i18n";
import { Eye, EyeOff, Folder, Image as ImageIcon } from "@lucide/vue";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import {
  compositeToBlob,
  hasRealComposite,
  layerTree,
} from "@/lib/psdComposite";
import { cn } from "@/lib/utils";
import { readPreviewBytes } from "./previewBytes";
import type {
  PreviewRendererEvents,
  PreviewRendererProps,
} from "./previewRenderer";
import ZoomableImage from "./ZoomableImage.vue";

const props = defineProps<PreviewRendererProps>();
const emit = defineEmits<PreviewRendererEvents>();
const { t } = useI18n();
const stage = useTemplateRef<InstanceType<typeof ZoomableImage>>("stage");

/** Decoded pixels allowed before reading stops, enough for large layered documents. */
const MEMORY_LIMIT = 1024 * 1024 * 1024;

const psd = shallowRef<Psd>();
/** Layers the reader turned off or on; the rest keep the file's state. */
const hidden = shallowRef(new Set<Layer>());
const source = ref<string>();
const loaded = ref(false);
const reading = new AbortController();
let generation = 0;

const layers = computed(() => layerTree(psd.value?.children));

function isVisible(layer: Layer): boolean {
  return !hidden.value.has(layer);
}

function setSource(blob: Blob): void {
  if (source.value) URL.revokeObjectURL(source.value);
  source.value = URL.createObjectURL(blob);
}

async function recomposite(): Promise<void> {
  const file = psd.value;
  if (!file) return;
  const current = ++generation;
  const blob = await compositeToBlob(
    file.width,
    file.height,
    file.children,
    isVisible,
  );
  if (current === generation) setSource(blob);
}

function update(next: Set<Layer>): void {
  hidden.value = next;
  triggerRef(hidden);
  recomposite().catch((error: unknown) => {
    console.error("Failed to composite the Photoshop layers.", error);
  });
}

function toggle(layer: Layer): void {
  const next = new Set(hidden.value);
  if (next.has(layer)) next.delete(layer);
  else next.add(layer);
  update(next);
}

function showAll(visible: boolean): void {
  update(new Set(visible ? [] : layers.value.map((node) => node.layer)));
}

function fitWidth(): void {
  stage.value?.fitWidth();
}

onMounted(async () => {
  emit("capabilitiesChange", {
    zoom: !props.compact,
    fitWidth: !props.compact,
    zoomMin: 10,
    zoomMax: 800,
  });
  try {
    const [{ readPsd }, bytes] = await Promise.all([
      import("ag-psd"),
      readPreviewBytes(props.preview, reading.signal),
    ]);
    const file = readPsd(bytes, {
      skipThumbnail: true,
      skipLinkedFilesData: true,
      totalMemoryLimit: MEMORY_LIMIT,
    });
    if (reading.signal.aborted) return;
    psd.value = file;
    // Start from the layers' own visibility.
    hidden.value = new Set(
      layerTree(file.children)
        .filter((node) => node.layer.hidden)
        .map((node) => node.layer),
    );
    if (hasRealComposite(file))
      setSource(
        await new Promise<Blob>((resolve, reject) =>
          file.canvas!.toBlob(
            (blob) =>
              blob ? resolve(blob) : reject(new Error("No composite image.")),
            "image/png",
          ),
        ),
      );
    else await recomposite();
  } catch (error) {
    if (reading.signal.aborted) return;
    console.error("Failed to read the Photoshop file.", error);
    emit("failed");
  }
});

onBeforeUnmount(() => {
  reading.abort();
  if (source.value) URL.revokeObjectURL(source.value);
});

defineExpose({ fitWidth });
</script>

<template>
  <div class="flex h-full min-h-0">
    <div class="relative min-w-0 flex-1">
      <ZoomableImage
        ref="stage"
        :src="source"
        :alt="fileName"
        :zoom="zoom"
        :compact="compact"
        @load="
          loaded = true;
          emit('metadataChange', $event);
        "
        @error="emit('failed')"
        @zoom-change="emit('zoomChange', $event)"
      />
      <div
        v-if="!loaded"
        class="absolute inset-0 grid place-items-center bg-background"
        role="status"
      >
        <Spinner class="size-5 text-muted-foreground" />
      </div>
    </div>
    <aside
      v-if="!compact && layers.length"
      class="flex w-64 shrink-0 flex-col border-l"
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
          @click="showAll(true)"
        >
          <Eye />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          :aria-label="t('project.preview.hideAllLayers')"
          @click="showAll(false)"
        >
          <EyeOff />
        </Button>
      </div>
      <ScrollArea class="min-h-0 flex-1">
        <ul class="flex flex-col gap-0.5 px-2 pb-2">
          <li v-for="node in layers" :key="node.id">
            <button
              type="button"
              :aria-pressed="isVisible(node.layer)"
              :class="
                cn(
                  'flex h-8 w-full items-center gap-2 rounded-lg pr-2 text-left text-sm outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30',
                  !isVisible(node.layer) && 'text-muted-foreground',
                )
              "
              :style="{ paddingLeft: `${8 + node.depth * 14}px` }"
              @click="toggle(node.layer)"
            >
              <Eye v-if="isVisible(node.layer)" class="size-3.5 shrink-0" />
              <EyeOff v-else class="size-3.5 shrink-0" />
              <Folder
                v-if="node.group"
                class="size-3.5 shrink-0 text-muted-foreground"
              />
              <ImageIcon
                v-else
                class="size-3.5 shrink-0 text-muted-foreground"
              />
              <span class="truncate">{{
                node.name || t("project.preview.psdUntitledLayer")
              }}</span>
            </button>
          </li>
        </ul>
      </ScrollArea>
    </aside>
  </div>
</template>
