<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, shallowRef } from "vue";
import { useI18n } from "vue-i18n";
import { toast } from "vue-sonner";
import { Spinner } from "@/components/ui/spinner";
import {
  readAco,
  readAse,
  type Swatch,
  type SwatchGroup,
} from "@/lib/palettes";
import { previewExtension } from "@/shared/previewFormats";
import { readPreviewBytes } from "./previewBytes";
import type {
  PreviewRendererEvents,
  PreviewRendererProps,
} from "./previewRenderer";

const props = defineProps<PreviewRendererProps>();
const emit = defineEmits<PreviewRendererEvents>();
const { t } = useI18n();
const groups = shallowRef<SwatchGroup[]>();
const reading = new AbortController();
const count = computed(
  () =>
    groups.value?.reduce((sum, group) => sum + group.swatches.length, 0) ?? 0,
);

async function copy(swatch: Swatch): Promise<void> {
  try {
    await navigator.clipboard.writeText(swatch.hex);
    toast.success(t("project.preview.colorCopied", { color: swatch.hex }));
  } catch {
    toast.error(t("project.preview.colorCopyFailed"));
  }
}

onMounted(async () => {
  try {
    const bytes = await readPreviewBytes(props.preview, reading.signal);
    groups.value =
      previewExtension(props.filePath) === "aco"
        ? readAco(bytes)
        : readAse(bytes);
  } catch (error) {
    if (reading.signal.aborted) return;
    console.error("Failed to read the swatch file.", error);
    emit("failed");
  }
});
onBeforeUnmount(() => reading.abort());
</script>

<template>
  <div class="relative h-full min-h-0">
    <div
      v-if="groups"
      data-slot="palette-preview"
      class="scroll-fade h-full overflow-auto"
    >
      <div class="mx-auto flex max-w-5xl flex-col gap-8 px-8 py-8">
        <p v-if="!count" class="text-sm text-muted-foreground">
          {{ t("project.preview.paletteEmpty") }}
        </p>
        <section
          v-for="(group, index) in groups"
          :key="index"
          class="flex flex-col gap-3"
        >
          <h3 v-if="group.name" class="text-sm font-medium">
            {{ group.name }}
          </h3>
          <ul
            class="grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-x-3 gap-y-4"
          >
            <li v-for="(swatch, position) in group.swatches" :key="position">
              <button
                type="button"
                class="group flex w-full flex-col gap-2 rounded-lg text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
                :title="t('project.preview.copyColor', { color: swatch.hex })"
                @click="copy(swatch)"
              >
                <span
                  class="h-16 w-full rounded-lg ring-1 ring-foreground/10 ring-inset transition-transform group-hover:scale-[1.03]"
                  :style="{ background: swatch.css }"
                />
                <span class="flex min-w-0 flex-col px-0.5">
                  <span class="truncate text-sm">{{
                    swatch.name || swatch.hex
                  }}</span>
                  <span class="truncate text-xs text-muted-foreground">{{
                    swatch.source
                  }}</span>
                </span>
              </button>
            </li>
          </ul>
        </section>
      </div>
    </div>
    <div v-else class="absolute inset-0 grid place-items-center" role="status">
      <Spinner class="size-5 text-muted-foreground" />
    </div>
  </div>
</template>
