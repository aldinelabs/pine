<script setup lang="ts">
import { computed, ref, shallowRef, useTemplateRef, watch } from "vue";
import { sandboxHtml } from "@/lib/htmlSandbox";

/**
 * Shows untrusted HTML in a frame that runs no scripts and reaches no
 * network. It zooms the way a browser does: the preview's zoom is page zoom,
 * which lays the page out again at the new size (the frame is scaled, since
 * the page cannot be asked to), and a trackpad pinch magnifies the page as
 * it is, panned with two fingers until it returns to its own scrolling.
 *
 * The frame shares Pine's origin, without scripts, only so that Pine can
 * listen inside it: pinches and zoom shortcuts reach the page's document,
 * never the preview around it.
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
const emit = defineEmits<{
  /** The frame finished loading a page; it reloads whenever the page changes. */
  load: [];
}>();
const viewport = useTemplateRef<HTMLDivElement>("viewport");
const frame = useTemplateRef<HTMLIFrameElement>("frame");
const scale = computed(() => props.zoom / 100);
/**
 * How comment highlights look in the page. Pages are shown on white, so the
 * colours are fixed; `!important` keeps a page's own CSS from hiding them.
 */
const ANNOTATION_STYLESHEET = `
::highlight(pine-annotation) {
  background-color: rgb(245 158 11 / 0.22) !important;
  text-decoration: underline 1.5px rgb(217 119 6 / 0.7) !important;
  text-underline-offset: 3px !important;
}
::highlight(pine-annotation-active) {
  background-color: rgb(245 158 11 / 0.4) !important;
  text-decoration: underline 2px rgb(217 119 6) !important;
  text-underline-offset: 3px !important;
}
`;

const document = computed(() => {
  const html = sandboxHtml(props.html);
  const css = [props.stylesheet, ANNOTATION_STYLESHEET]
    .filter(Boolean)
    .join("\n");
  const style = `<style>${css.replace(/<\//g, "<\\/")}</style>`;
  const close = html.search(/<\/head>/i);
  return close < 0
    ? html + style
    : html.slice(0, close) + style + html.slice(close);
});

/** Browsers stop pinch magnification at five times. */
const MAX_MAGNIFICATION = 5;
const magnification = ref(1);
/** Top-left of the magnified page shown in the viewport, in pixels. */
const offset = ref({ x: 0, y: 0 });

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

function moveTo(x: number, y: number, factor: number): void {
  const element = viewport.value;
  const width = element?.clientWidth ?? 0;
  const height = element?.clientHeight ?? 0;
  offset.value = {
    x: clamp(x, 0, width * (factor - 1)),
    y: clamp(y, 0, height * (factor - 1)),
  };
}

function magnify(event: WheelEvent): void {
  const current = magnification.value;
  const next = clamp(
    current * Math.exp(-event.deltaY * 0.01),
    1,
    MAX_MAGNIFICATION,
  );
  // The point under the pointer, from page pixels to the viewport, stays put.
  const x = event.clientX * scale.value * current - offset.value.x;
  const y = event.clientY * scale.value * current - offset.value.y;
  const ratio = next / current;
  magnification.value = next;
  moveTo(
    (offset.value.x + x) * ratio - x,
    (offset.value.y + y) * ratio - y,
    next,
  );
}

function handleWheel(event: WheelEvent): void {
  if (event.ctrlKey || event.metaKey) {
    // A trackpad pinch, which browsers turn into magnification.
    event.preventDefault();
    magnify(event);
    return;
  }
  if (magnification.value === 1) return;
  // Magnified, two fingers pan first; at the edge the page scrolls.
  const { x, y } = offset.value;
  moveTo(x + event.deltaX, y + event.deltaY, magnification.value);
  if (offset.value.x !== x || offset.value.y !== y) event.preventDefault();
}

const ZOOM_KEYS = new Set(["=", "+", "-", "_", "0"]);

/** Zoom shortcuts typed in the page reach the preview, as in a browser. */
function forwardZoomKey(event: KeyboardEvent): void {
  if (!(event.metaKey || event.ctrlKey) || !ZOOM_KEYS.has(event.key)) return;
  event.preventDefault();
  frame.value?.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: event.key,
      code: event.code,
      metaKey: event.metaKey,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      bubbles: true,
      cancelable: true,
    }),
  );
}

/** The document of the page the frame last finished loading. */
const page = shallowRef<Document>();

function listen(): void {
  const loaded = frame.value?.contentDocument ?? undefined;
  page.value = loaded;
  loaded?.addEventListener("wheel", handleWheel, { passive: false });
  loaded?.addEventListener("keydown", forwardZoomKey);
  emit("load");
}

defineExpose({
  /** The loaded page's body; undefined until the frame loads, and while it reloads. */
  body: (): HTMLElement | undefined => page.value?.body ?? undefined,
});

watch(document, () => {
  page.value = undefined;
  magnification.value = 1;
  offset.value = { x: 0, y: 0 };
});
</script>

<template>
  <div
    ref="viewport"
    class="relative h-full min-h-0 overflow-hidden"
    :style="{ background }"
  >
    <div
      data-slot="html-frame-magnifier"
      class="absolute inset-0 origin-top-left"
      :style="
        magnification === 1
          ? undefined
          : {
              transform: `translate(${-offset.x}px, ${-offset.y}px) scale(${magnification})`,
            }
      "
    >
      <iframe
        ref="frame"
        data-slot="html-frame"
        sandbox="allow-same-origin"
        referrerpolicy="no-referrer"
        :title="title"
        :srcdoc="document"
        class="absolute top-0 left-0 origin-top-left border-0"
        :style="{
          width: `${100 / scale}%`,
          height: `${100 / scale}%`,
          transform: `scale(${scale})`,
        }"
        @load="listen"
      />
    </div>
  </div>
</template>
