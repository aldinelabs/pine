<script setup lang="ts">
import { CpuIcon } from "@lucide/vue";
import { computed } from "vue";
import { monoIconSource, resolveProviderIcon } from "@/lib/provider-icons";
import { cn } from "@/lib/utils";

const props = defineProps<{
  providerId: string;
  providerName?: string;
  /** Draw the single-colour icon in the surrounding text colour. */
  mono?: boolean;
}>();

const icon = computed(() =>
  resolveProviderIcon(props.providerId, props.providerName),
);

// A mask filled with `currentColor` follows the text colour in both themes,
// which an <img> of a `currentColor` SVG cannot. It stays a direct child of
// the button with `data-icon`, the shadcn-vue slot for a leading icon.
const maskStyle = computed(() => {
  if (!icon.value) return undefined;
  const url = `url(${JSON.stringify(monoIconSource(icon.value))})`;
  return {
    maskImage: url,
    maskPosition: "center",
    maskRepeat: "no-repeat",
    // Lobe glyphs fill their 24px box; Lucide icons beside them keep about
    // 2px clear on each side. Matching that keeps the button's gap even.
    maskSize: "83.333%",
  };
});
</script>

<template>
  <span
    v-if="icon && mono"
    aria-hidden="true"
    data-slot="provider-icon"
    data-variant="mono"
    class="inline-block size-4 shrink-0 bg-current"
    :style="maskStyle"
  />
  <img
    v-else-if="icon"
    aria-hidden="true"
    data-slot="provider-icon"
    :src="icon.src"
    alt=""
    :class="cn('size-4 shrink-0', { 'dark:invert': icon.monochrome })"
  />
  <CpuIcon v-else aria-hidden="true" />
</template>
