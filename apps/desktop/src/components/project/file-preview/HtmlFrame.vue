<script setup lang="ts">
import { computed } from "vue";
import { sandboxHtml } from "@/lib/htmlSandbox";

/**
 * Shows untrusted HTML in a frame that runs no scripts and reaches no
 * network. Zoom scales the frame, since the page cannot be asked to; a
 * reader stylesheet, when given, restyles the page instead.
 */
const props = withDefaults(
  defineProps<{
    html: string;
    title: string;
    zoom?: number;
    /** CSS added after the page's own, such as reading typography. */
    stylesheet?: string;
    /** The frame's backdrop; pages default to white, like a browser. */
    background?: string;
  }>(),
  { zoom: 100, stylesheet: undefined, background: "#ffffff" },
);
const scale = computed(() => props.zoom / 100);
const document = computed(() => {
  const html = sandboxHtml(props.html);
  if (!props.stylesheet) return html;
  const style = `<style>${props.stylesheet.replace(/<\//g, "<\\/")}</style>`;
  const close = html.search(/<\/head>/i);
  return close < 0
    ? html + style
    : html.slice(0, close) + style + html.slice(close);
});
</script>

<template>
  <div class="relative h-full min-h-0 overflow-hidden" :style="{ background }">
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
