<script setup lang="ts">
import { ImageOffIcon } from "@lucide/vue";
import type { ComponentRenderProps } from "@openuidev/vue-lang";
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Skeleton } from "@/components/ui/skeleton";
import type { IntelligentUiProps } from "@/shared/intelligentUi";
import { useProjectStore } from "@/stores/project";
import {
  imageFailure,
  resolveImageSource,
  type ImageFailure,
} from "./imageSource";

const props = defineProps<ComponentRenderProps<IntelligentUiProps<"Image">>>();
const { t } = useI18n();
const projectStore = useProjectStore();

/** Relative paths are read from the folder the agent works in. */
const baseFolder = computed(() => {
  const project = projectStore.activeProject;
  return project?.folders.find(
    (folder) => folder.id === project.defaultFolderId,
  )?.path;
});
const raw = computed(() =>
  typeof props.props.src === "string" ? props.props.src.trim() : "",
);
const src = computed(() => resolveImageSource(raw.value, baseFolder.value));
const ratio = computed(() => {
  const value = Number(props.props.aspectRatio);
  return Number.isFinite(value) && value > 0
    ? Math.min(5, Math.max(0.2, value))
    : 1.5;
});
const loaded = ref(false);
const failure = ref<ImageFailure>();
watch(src, () => {
  loaded.value = false;
  failure.value = undefined;
});
const reason = computed(() =>
  !src.value ? (raw.value ? "unsupported" : undefined) : failure.value,
);
const reasonText = computed(() =>
  reason.value ? t(`intelligentUi.image.${reason.value}`) : undefined,
);

async function handleError(): Promise<void> {
  const current = src.value;
  failure.value = "failed";
  if (!current) return;
  const found = await imageFailure(current);
  if (src.value === current) failure.value = found;
}
</script>

<template>
  <!-- Fills its slot: an image sized only by its own content collapses to
       nothing in a row while it loads or when it fails. -->
  <figure
    data-iui="image"
    class="relative w-full min-w-0 overflow-hidden rounded-lg bg-muted"
    :style="{ aspectRatio: String(ratio) }"
  >
    <!-- Holds the final size while the picture loads. -->
    <Skeleton
      v-if="src && !loaded && !failure"
      class="absolute inset-0 size-full rounded-none"
    />
    <img
      v-if="src && !failure"
      :src="src"
      :alt="props.props.alt"
      loading="lazy"
      decoding="async"
      referrerpolicy="no-referrer"
      draggable="false"
      :class="[
        'size-full transition-opacity motion-reduce:transition-none',
        props.props.fit === 'contain' ? 'object-contain' : 'object-cover',
        loaded ? 'opacity-100' : 'opacity-0',
      ]"
      @load="loaded = true"
      @error="handleError"
    />
    <div
      v-if="!src || failure"
      data-iui-image-failure
      :data-reason="reason"
      class="absolute inset-0 flex flex-col items-center justify-center gap-1.5 p-3 text-center text-muted-foreground"
      role="img"
      :aria-label="[props.props.alt, reasonText].filter(Boolean).join(': ')"
      :title="raw ? `${reasonText ?? ''}\n${raw}`.trim() : undefined"
    >
      <ImageOffIcon class="size-6 shrink-0" />
      <span v-if="reasonText" class="line-clamp-2 text-xs">
        {{ reasonText }}
      </span>
      <span
        v-if="raw"
        class="line-clamp-1 max-w-full text-xs break-all opacity-70"
      >
        {{ raw }}
      </span>
    </div>
  </figure>
</template>
