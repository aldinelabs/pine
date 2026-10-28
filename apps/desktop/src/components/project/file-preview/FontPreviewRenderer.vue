<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import { useI18n } from "vue-i18n";
import { Type } from "@lucide/vue";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { readFontInfo, type FontInfo } from "@/lib/fontInfo";
import { readPreviewBytes } from "./previewBytes";
import type {
  PreviewRendererEvents,
  PreviewRendererProps,
} from "./previewRenderer";
import { usePreviewToolbar } from "./usePreviewToolbar";

const props = defineProps<PreviewRendererProps>();
const emit = defineEmits<PreviewRendererEvents>();
const { t } = useI18n();
const toolbar = usePreviewToolbar(() => props.compact);

/** The sample's size at 100% zoom, in pixels. */
const BASE_SIZE = 48;
const WATERFALL = [12, 16, 20, 28, 40, 56];
const GLYPHS = [
  ..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
  ..."&@#%?!$€£¥*+=<>()[]{}/\\.,:;\"'“”‘’-–—",
];
const CJK_GLYPHS = [..."永和九年岁在癸丑暮春之初会于会稽山阴之兰亭"];

const family = `pine-font-preview-${Math.random().toString(36).slice(2)}`;
const face = shallowRef<FontFace>();
const info = ref<FontInfo>({ coversCjk: false });
const sample = ref("");
const reading = new AbortController();

const defaultSample = computed(() =>
  info.value.coversCjk
    ? t("project.preview.fontSampleCjk")
    : "The quick brown fox jumps over the lazy dog",
);
const text = computed(() => sample.value || defaultSample.value);
const size = computed(() =>
  props.compact ? 32 : (BASE_SIZE * props.zoom) / 100,
);
const glyphs = computed(() =>
  info.value.coversCjk ? [...GLYPHS, ...CJK_GLYPHS] : GLYPHS,
);
const details = computed(() =>
  [
    info.value.style,
    info.value.version &&
      t("project.preview.fontVersion", { version: info.value.version }),
    info.value.glyphCount &&
      t("project.preview.fontGlyphs", { count: info.value.glyphCount }),
    info.value.designer,
  ].filter(Boolean),
);

onMounted(async () => {
  emit("capabilitiesChange", {
    zoom: !props.compact,
    zoomMin: 25,
    zoomMax: 400,
    toolbar: !props.compact,
  });
  try {
    const bytes = await readPreviewBytes(props.preview, reading.signal);
    info.value = await readFontInfo(bytes);
    const loaded = await new FontFace(family, bytes).load();
    if (reading.signal.aborted) return;
    document.fonts.add(loaded);
    face.value = loaded;
  } catch (error) {
    if (reading.signal.aborted) return;
    console.error("Failed to load the font preview.", error);
    emit("failed");
  }
});

onBeforeUnmount(() => {
  reading.abort();
  if (face.value) document.fonts.delete(face.value);
});
</script>

<template>
  <div class="relative h-full min-h-0">
    <Teleport v-if="toolbar" :to="toolbar">
      <InputGroup class="h-8 w-72">
        <InputGroupAddon><Type /></InputGroupAddon>
        <InputGroupInput
          v-model="sample"
          :placeholder="t('project.preview.fontSamplePlaceholder')"
          :aria-label="t('project.preview.fontSamplePlaceholder')"
        />
      </InputGroup>
    </Teleport>
    <div v-if="face" data-slot="font-preview" class="h-full overflow-auto">
      <div class="mx-auto flex max-w-4xl flex-col gap-8 px-8 py-8">
        <header class="flex flex-col gap-1">
          <h2 class="text-2xl font-medium">
            {{ info.family || info.fullName || fileName }}
          </h2>
          <p v-if="details.length" class="text-sm text-muted-foreground">
            {{ details.join(" · ") }}
          </p>
        </header>
        <p
          class="break-words"
          :style="{
            fontFamily: family,
            fontSize: `${size}px`,
            lineHeight: 1.25,
          }"
        >
          {{ text }}
        </p>
        <Separator />
        <div class="flex flex-col gap-3">
          <div
            v-for="line in WATERFALL"
            :key="line"
            class="flex items-baseline gap-4"
          >
            <span
              class="w-8 shrink-0 text-right text-xs text-muted-foreground tabular-nums"
              >{{ line }}</span
            >
            <span
              class="min-w-0 truncate"
              :style="{ fontFamily: family, fontSize: `${line}px` }"
              >{{ text }}</span
            >
          </div>
        </div>
        <Separator />
        <div
          class="grid grid-cols-[repeat(auto-fill,minmax(3.5rem,1fr))] gap-1"
          :style="{ fontFamily: family }"
        >
          <span
            v-for="glyph in glyphs"
            :key="glyph"
            class="grid aspect-square place-items-center rounded-md text-3xl hover:bg-muted"
            >{{ glyph }}</span
          >
        </div>
        <p v-if="info.copyright" class="text-xs text-muted-foreground">
          {{ info.copyright }}
        </p>
      </div>
    </div>
    <div v-else class="absolute inset-0 grid place-items-center" role="status">
      <Spinner class="size-5 text-muted-foreground" />
    </div>
  </div>
</template>
