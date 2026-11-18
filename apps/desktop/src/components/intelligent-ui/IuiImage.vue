<script setup lang="ts">
import { ImageOffIcon } from "@lucide/vue";
import type { ComponentRenderProps } from "@openuidev/vue-lang";
import { computed, ref, watch } from "vue";
import { Skeleton } from "@/components/ui/skeleton";
import { resolveMarkdownImageSrc } from "@/lib/markdownImage";
import type { IntelligentUiProps } from "@/shared/intelligentUi";

const props = defineProps<ComponentRenderProps<IntelligentUiProps<"Image">>>();

/**
 * Sources resolve like Markdown images: web and inline-data images load as
 * they are, and local paths go through `pine-attachment://`, whose handler
 * checks the path against the session's grants. Other schemes do not load.
 */
const src = computed(() => {
  const raw = typeof props.props.src === "string" ? props.props.src.trim() : "";
  if (!raw) return undefined;
  const resolved = resolveMarkdownImageSrc(raw);
  return /^(?:https?:|data:image\/|pine-attachment:|pine-project-media:)/iu.test(
    resolved,
  )
    ? resolved
    : undefined;
});
const ratio = computed(() => {
  const value = Number(props.props.aspectRatio);
  return Number.isFinite(value) && value > 0
    ? Math.min(5, Math.max(0.2, value))
    : 1.5;
});
const loaded = ref(false);
const failed = ref(false);
watch(src, () => {
  loaded.value = false;
  failed.value = false;
});
</script>

<template>
  <figure
    data-iui="image"
    class="relative min-w-0 overflow-hidden rounded-lg bg-muted"
    :style="{ aspectRatio: String(ratio) }"
  >
    <!-- Holds the final size while the picture loads. -->
    <Skeleton
      v-if="src && !loaded && !failed"
      class="absolute inset-0 size-full rounded-none"
    />
    <img
      v-if="src && !failed"
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
      @error="failed = true"
    />
    <div
      v-if="!src || failed"
      class="absolute inset-0 flex items-center justify-center text-muted-foreground"
      role="img"
      :aria-label="props.props.alt"
    >
      <ImageOffIcon class="size-6" />
    </div>
  </figure>
</template>
