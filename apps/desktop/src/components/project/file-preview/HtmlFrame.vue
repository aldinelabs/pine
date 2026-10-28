<script setup lang="ts">
import { computed } from "vue";
import { sandboxHtml } from "@/lib/htmlSandbox";

/**
 * Shows untrusted HTML in a frame that runs no scripts and reaches no
 * network. Zoom scales the frame, since the page cannot be asked to.
 */
const props = withDefaults(
  defineProps<{ html: string; title: string; zoom?: number }>(),
  { zoom: 100 },
);
const scale = computed(() => props.zoom / 100);
const document = computed(() => sandboxHtml(props.html));
</script>

<template>
  <div class="relative h-full min-h-0 overflow-hidden bg-white">
    <iframe
      data-slot="html-frame"
      sandbox=""
      referrerpolicy="no-referrer"
      :title="title"
      :srcdoc="document"
      class="absolute top-0 left-0 origin-top-left border-0"
      :style="{
        width: `${100 / scale}%`,
        height: `${100 / scale}%`,
        transform: `scale(${scale})`,
      }"
    />
  </div>
</template>
