<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  ref,
  useTemplateRef,
  watch,
} from "vue";
import { useI18n } from "vue-i18n";
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from "reka-ui";
import {
  ChevronLeft,
  ChevronRight,
  Maximize,
  X,
  ZoomIn,
  ZoomOut,
} from "@lucide/vue";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import ZoomableImage from "@/components/project/file-preview/ZoomableImage.vue";
import { prefersReducedMotion } from "@/lib/animateScroll";
import { EASE_OUT_EXPO } from "@/lib/motion";
import {
  CLOSE_MS,
  CONTROLS_DELAY_MS,
  CONTROLS_MS,
  DECODE_WAIT_MS,
  FADE_MS,
  OPEN_MS,
  flipTransform,
  readSafeAreaInsets,
  visibleSourceRect,
  type FlightRect,
} from "./imageViewerFlight";
import type { MarkdownViewerImage } from "./markdownImageContext";

/**
 * An enlarged view of a Markdown document's images. The clicked image flies
 * from its place in the document to the middle of the blurred window and
 * back when the view closes; it zooms and pans like the image file preview.
 * Only `transform` and `opacity` animate, and every layout read happens
 * before the first animated frame.
 */
const props = defineProps<{ images: MarkdownViewerImage[] }>();
const open = defineModel<boolean>("open", { required: true });
const index = defineModel<number>("index", { required: true });
const { t } = useI18n();
const stage = useTemplateRef<InstanceType<typeof ZoomableImage>>("stage");
const stageArea = useTemplateRef<HTMLDivElement>("stageArea");
const flight = useTemplateRef<HTMLImageElement>("flight");
const overlayLayer = useTemplateRef<HTMLDivElement>("overlayLayer");
const topBar = useTemplateRef<HTMLDivElement>("topBar");
const bottomBar = useTemplateRef<HTMLDivElement>("bottomBar");

const ZOOM_MIN = 10;
const ZOOM_MAX = 800;
/** The levels the zoom buttons step through, as in the file preview. */
const ZOOM_STEPS = [
  10, 25, 33, 50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300, 400,
  500, 600, 800,
];
/** Room kept clear of the title and toolbar when the image fits. */
const FIT_TOP = 64;
const FIT_BOTTOM = 80;
const FIT_SIDE = 24;

const zoom = ref(100);
const current = computed(() => props.images[index.value]);
const count = computed(() => props.images.length);
const naturalSize = computed(() =>
  current.value
    ? { width: current.value.width, height: current.value.height }
    : undefined,
);

type Phase = "closed" | "opening" | "open" | "closing";
const phase = ref<Phase>("closed");
/** The overlay and controls have faded in. */
const revealed = ref(false);
/** The zoomable stage shows; the flying copy stands in for it in flight. */
const stageVisible = ref(false);
const flightVisible = ref(false);
const flying = ref(false);
const flightRect = ref<FlightRect>();
const fitInsets = ref({
  top: FIT_TOP,
  right: FIT_SIDE,
  bottom: FIT_BOTTOM,
  left: FIT_SIDE,
});

const flightStyle = computed(() => {
  const rect = flightRect.value;
  return {
    left: `${rect?.left ?? 0}px`,
    top: `${rect?.top ?? 0}px`,
    width: `${rect?.width ?? 0}px`,
    height: `${rect?.height ?? 0}px`,
    willChange: flying.value ? "transform" : undefined,
  };
});
const controlsStyle = computed(() => ({ opacity: revealed.value ? 1 : 0 }));

let running: Animation[] = [];
/** Bumped by every open and close so a superseded one stops. */
let sequence = 0;
let returnFocus: HTMLElement | null = null;
/** The document image hidden while its copy flies; restored afterwards. */
let hiddenSource: { element: HTMLElement; opacity: string } | undefined;

function contentElement(): HTMLElement | null {
  return (
    stageArea.value?.closest<HTMLElement>(
      '[data-slot="markdown-image-viewer"]',
    ) ?? null
  );
}

function stageImage(): HTMLImageElement | null {
  return (
    stageArea.value?.querySelector<HTMLImageElement>(
      '[data-slot="image-preview"] img',
    ) ?? null
  );
}

function rectOf(element: Element): FlightRect | undefined {
  const { left, top, width, height } = element.getBoundingClientRect();
  return width > 0 && height > 0 ? { left, top, width, height } : undefined;
}

/** A slight shrink about the middle, for a copy with no place to fly to. */
function shrunk(rect: FlightRect): string {
  return `translate(${rect.width * 0.02}px, ${rect.height * 0.02}px) scale(0.96)`;
}

function hideSource(element: HTMLElement): void {
  if (hiddenSource) return;
  hiddenSource = { element, opacity: element.style.opacity };
  element.style.opacity = "0";
}

function restoreSource(): void {
  if (!hiddenSource) return;
  hiddenSource.element.style.opacity = hiddenSource.opacity;
  hiddenSource = undefined;
}

function play(
  element: HTMLElement | null | undefined,
  keyframes: Keyframe[] | PropertyIndexedKeyframes,
  options: KeyframeAnimationOptions,
): void {
  if (!element || typeof element.animate !== "function") return;
  running.push(element.animate(keyframes, { fill: "both", ...options }));
}

function settled(): Promise<void> {
  return Promise.all(
    running.map((animation) =>
      animation.finished.then(
        () => undefined,
        () => undefined,
      ),
    ),
  ).then(() => undefined);
}

function cancelRunning(): void {
  const animations = running;
  running = [];
  for (const animation of animations) animation.cancel();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function fadeControls(from: number, to: number, duration: number): void {
  for (const [element, offset] of [
    [topBar.value, "-8px"],
    [bottomBar.value, "8px"],
  ] as const) {
    play(
      element,
      from < to
        ? {
            opacity: [from, to],
            transform: [`translateY(${offset})`, "none"],
          }
        : { opacity: [from, to] },
      from < to
        ? { duration, delay: CONTROLS_DELAY_MS, easing: EASE_OUT_EXPO }
        : { duration, easing: "ease-out" },
    );
  }
}

/** The open state, committed without animations. */
function commitOpen(): void {
  revealed.value = true;
  stageVisible.value = true;
  flightVisible.value = false;
  flying.value = false;
  restoreSource();
  phase.value = "open";
}

function commitClosed(): void {
  cancelRunning();
  restoreSource();
  revealed.value = false;
  stageVisible.value = false;
  flightVisible.value = false;
  flying.value = false;
  phase.value = "closed";
}

async function startOpen(): Promise<void> {
  const image = current.value;
  if (!image) {
    open.value = false;
    return;
  }
  const id = ++sequence;
  const active = document.activeElement;
  if (active instanceof HTMLElement && !contentElement()?.contains(active)) {
    returnFocus = active;
  }
  const reduced = prefersReducedMotion();
  // Read before anything below writes to the DOM.
  const sourceRect = reduced ? undefined : visibleSourceRect(image.element);
  const safe = readSafeAreaInsets();
  fitInsets.value = {
    top: FIT_TOP + safe.top,
    right: FIT_SIDE,
    bottom: FIT_BOTTOM + safe.bottom,
    left: FIT_SIDE,
  };
  revealed.value = false;
  stageVisible.value = false;
  flightVisible.value = false;
  phase.value = "opening";

  await nextTick();
  if (id !== sequence) return;
  // The stage fitted from the known natural size as it mounted.
  const stageImg = stageImage();
  const targetRect = stageImg ? rectOf(stageImg) : undefined;
  const flightImg = flight.value;
  const fly = !reduced && Boolean(targetRect && flightImg);
  if (fly && targetRect && flightImg) {
    flightRect.value = targetRect;
    await Promise.race([
      typeof flightImg.decode === "function"
        ? flightImg.decode().catch(() => undefined)
        : Promise.resolve(),
      delay(DECODE_WAIT_MS),
    ]);
  }
  // Scroll lock, hidden siblings and focus land before the first frame.
  await nextFrame();
  if (id !== sequence) return;

  if (fly && targetRect) {
    if (sourceRect) hideSource(image.element);
    flightVisible.value = true;
    flying.value = true;
    play(
      flight.value,
      sourceRect
        ? { transform: [flipTransform(sourceRect, targetRect), "none"] }
        : { transform: [shrunk(targetRect), "none"], opacity: [0, 1] },
      { duration: OPEN_MS, easing: EASE_OUT_EXPO },
    );
    play(
      overlayLayer.value,
      { opacity: [0, 1] },
      {
        duration: 300,
        easing: "ease-out",
      },
    );
    fadeControls(0, 1, CONTROLS_MS);
  } else {
    for (const element of [
      stageArea.value,
      overlayLayer.value,
      topBar.value,
      bottomBar.value,
    ]) {
      play(
        element,
        { opacity: [0, 1] },
        {
          duration: FADE_MS,
          easing: "linear",
        },
      );
    }
  }

  await settled();
  if (id !== sequence) return;
  const finished = running;
  running = [];
  commitOpen();
  await nextTick();
  for (const animation of finished) animation.cancel();
}

async function requestClose(): Promise<void> {
  if (phase.value === "closed" || phase.value === "closing") return;
  const id = ++sequence;
  if (phase.value === "opening") {
    cancelRunning();
    commitOpen();
  }
  open.value = false;
  phase.value = "closing";

  const image = current.value;
  const reduced = prefersReducedMotion();
  const stageImg = stageImage();
  const fromRect = !reduced && stageImg ? rectOf(stageImg) : undefined;
  const toRect =
    fromRect && image ? visibleSourceRect(image.element) : undefined;

  if (fromRect && flight.value) {
    flightRect.value = fromRect;
    flightVisible.value = true;
    flying.value = true;
    stageVisible.value = false;
    // The copy replaces the stage in the same frame.
    await nextTick();
    if (id !== sequence) return;
    if (toRect && image) {
      hideSource(image.element);
      play(
        flight.value,
        { transform: ["none", flipTransform(toRect, fromRect)] },
        { duration: CLOSE_MS, easing: EASE_OUT_EXPO },
      );
      play(
        overlayLayer.value,
        { opacity: [1, 0] },
        {
          duration: 260,
          easing: "ease-out",
        },
      );
    } else {
      play(
        flight.value,
        { transform: ["none", shrunk(fromRect)], opacity: [1, 0] },
        { duration: 200, easing: "ease-out" },
      );
      play(
        overlayLayer.value,
        { opacity: [1, 0] },
        {
          duration: 200,
          easing: "ease-out",
        },
      );
    }
    fadeControls(1, 0, FADE_MS);
  } else {
    for (const element of [
      stageArea.value,
      overlayLayer.value,
      topBar.value,
      bottomBar.value,
    ]) {
      play(
        element,
        { opacity: [1, 0] },
        {
          duration: FADE_MS,
          easing: "linear",
        },
      );
    }
  }

  await settled();
  if (id !== sequence) return;
  commitClosed();
}

watch(
  open,
  (value) => {
    if (value) {
      if (phase.value === "opening" || phase.value === "open") return;
      if (phase.value === "closing") {
        sequence++;
        commitClosed();
      }
      void startOpen();
    } else if (phase.value === "opening" || phase.value === "open") {
      void requestClose();
    }
  },
  { immediate: true },
);

// The document outlives a flight cut short by the view unmounting.
onBeforeUnmount(() => {
  sequence++;
  cancelRunning();
  restoreSource();
});

function handleOpenChange(value: boolean): void {
  if (!value) void requestClose();
}

function clampZoom(value: number): number {
  return Math.round(Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, value)));
}

function stepZoom(direction: -1 | 1): void {
  const value = zoom.value;
  zoom.value =
    direction > 0
      ? (ZOOM_STEPS.find((step) => step > value) ?? ZOOM_MAX)
      : ([...ZOOM_STEPS].reverse().find((step) => step < value) ?? ZOOM_MIN);
}

function move(step: -1 | 1): void {
  if (count.value < 2) return;
  index.value = (index.value + step + count.value) % count.value;
}

function handleKeydown(event: KeyboardEvent): void {
  if (phase.value !== "open" || event.altKey) return;
  const modified = event.metaKey || event.ctrlKey;
  if (!modified && event.key === "ArrowLeft") move(-1);
  else if (!modified && event.key === "ArrowRight") move(1);
  else if (modified && (event.key === "=" || event.key === "+")) stepZoom(1);
  else if (modified && (event.key === "-" || event.key === "_")) stepZoom(-1);
  else if (modified && event.key === "0") stage.value?.fit();
  else return;
  event.preventDefault();
}

/** ⌘ or Ctrl with the wheel, or a trackpad pinch, zooms the image. */
function handleWheel(event: WheelEvent): void {
  if (!event.ctrlKey && !event.metaKey) return;
  event.preventDefault();
  zoom.value = clampZoom(zoom.value * Math.exp(-event.deltaY * 0.005));
}

/** A click beside the image closes the view; one on the image does not. */
function handleStageClick(event: MouseEvent): void {
  if (phase.value !== "open") return;
  const target = event.target;
  if (!(target instanceof Element) || target.closest("img")) return;
  const viewport = stageArea.value?.querySelector<HTMLElement>(
    '[data-slot="image-preview"]',
  );
  // A click on the stage's scrollbars.
  if (
    viewport &&
    target === viewport &&
    viewport.clientWidth > 0 &&
    (event.offsetX >= viewport.clientWidth ||
      event.offsetY >= viewport.clientHeight)
  ) {
    return;
  }
  void requestClose();
}

/** Keyboard shortcuts work at once and no button shows a focus ring. */
function handleOpenAutoFocus(event: Event): void {
  event.preventDefault();
  const content =
    contentElement() ??
    (event.target instanceof HTMLElement ? event.target : null);
  content?.focus({ preventScroll: true });
}

/** Focus returns to the image now shown, else to where it was. */
function handleCloseAutoFocus(event: Event): void {
  event.preventDefault();
  const element = current.value?.element;
  if (element?.isConnected && element.tabIndex >= 0) {
    element.focus({ preventScroll: true });
  } else if (returnFocus?.isConnected) {
    returnFocus.focus({ preventScroll: true });
  }
  returnFocus = null;
}

const pill =
  "bg-popover/90 text-popover-foreground shadow-lg ring-1 ring-foreground/5 dark:ring-foreground/10 rounded-full";
</script>

<template>
  <DialogRoot :open="phase !== 'closed'" @update:open="handleOpenChange">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-50">
        <div
          ref="overlayLayer"
          class="absolute inset-0 bg-background/80 supports-backdrop-filter:bg-background/55 supports-backdrop-filter:backdrop-blur-xl"
          :style="{ opacity: revealed ? 1 : 0 }"
        />
      </DialogOverlay>
      <DialogContent
        data-slot="markdown-image-viewer"
        tabindex="-1"
        class="window-no-drag fixed inset-0 z-50 outline-none"
        @keydown="handleKeydown"
        @open-auto-focus="handleOpenAutoFocus"
        @close-auto-focus="handleCloseAutoFocus"
      >
        <DialogDescription class="sr-only">
          {{ t("markdown.imageViewer.description") }}
        </DialogDescription>
        <div
          ref="stageArea"
          class="absolute inset-0"
          :style="{ opacity: stageVisible ? 1 : 0 }"
          @click="handleStageClick"
          @wheel="handleWheel"
        >
          <ZoomableImage
            v-if="current"
            ref="stage"
            :key="current.src"
            :src="current.src"
            :alt="current.name"
            :zoom="zoom"
            :checkerboard="false"
            :fit-insets="fitInsets"
            :natural-size="naturalSize"
            @zoom-change="zoom = $event"
          />
        </div>
        <img
          v-show="flightVisible"
          ref="flight"
          data-slot="markdown-image-flight"
          :src="current?.src"
          alt=""
          aria-hidden="true"
          draggable="false"
          class="pointer-events-none fixed max-w-none origin-top-left"
          :style="flightStyle"
        />
        <div
          ref="topBar"
          class="pointer-events-none absolute inset-x-0 top-0 flex justify-center px-4 pt-[calc(var(--safe-area-top)+0.75rem)]"
          :style="controlsStyle"
        >
          <DialogTitle
            as="h2"
            :class="[
              pill,
              'pointer-events-auto max-w-[min(40rem,calc(100vw-7rem))] truncate px-3.5 py-1.5 text-sm font-medium',
            ]"
            :title="current?.name"
          >
            {{ current?.name }}
          </DialogTitle>
          <DialogClose as-child>
            <Button
              variant="ghost"
              size="icon"
              :class="[
                pill,
                'pointer-events-auto absolute top-[calc(var(--safe-area-top)+0.75rem)] right-[calc(var(--safe-area-right)+0.75rem)]',
              ]"
              :aria-label="t('markdown.imageViewer.close')"
              data-testid="markdown-image-close"
            >
              <X />
            </Button>
          </DialogClose>
        </div>
        <div
          ref="bottomBar"
          class="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center px-4 pb-[calc(var(--safe-area-bottom)+1rem)]"
          :style="controlsStyle"
        >
          <div
            role="toolbar"
            :aria-label="t('markdown.imageViewer.controls')"
            :class="[
              pill,
              'pointer-events-auto flex h-10 max-w-[calc(100vw-2rem)] items-center gap-0.5 px-1.5 text-sm text-muted-foreground',
            ]"
          >
            <template v-if="count > 1">
              <Button
                variant="ghost"
                size="icon-sm"
                class="rounded-full"
                :aria-label="t('markdown.imageViewer.previous')"
                data-testid="markdown-image-previous"
                @click="move(-1)"
              >
                <ChevronLeft />
              </Button>
              <span class="px-1 tabular-nums">{{
                t("markdown.imageViewer.position", {
                  index: index + 1,
                  count,
                })
              }}</span>
              <Button
                variant="ghost"
                size="icon-sm"
                class="rounded-full"
                :aria-label="t('markdown.imageViewer.next')"
                data-testid="markdown-image-next"
                @click="move(1)"
              >
                <ChevronRight />
              </Button>
              <Separator orientation="vertical" class="mx-1 h-4 self-center" />
            </template>
            <Button
              variant="ghost"
              size="sm"
              class="rounded-full max-sm:size-7 max-sm:px-0"
              :aria-label="t('markdown.imageViewer.fit')"
              :title="t('markdown.imageViewer.fit')"
              data-testid="markdown-image-fit"
              @click="stage?.fit()"
            >
              <Maximize data-icon="inline-start" />
              <span class="max-sm:hidden">{{
                t("markdown.imageViewer.fit")
              }}</span>
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              class="rounded-full"
              :aria-label="t('project.preview.zoomOut')"
              :disabled="zoom <= ZOOM_MIN"
              data-testid="markdown-image-zoom-out"
              @click="stepZoom(-1)"
            >
              <ZoomOut />
            </Button>
            <span
              class="w-12 text-center tabular-nums"
              data-testid="markdown-image-zoom-value"
              :title="t('project.preview.zoomValue', { value: zoom })"
              >{{ zoom }}%</span
            >
            <Button
              variant="ghost"
              size="icon-sm"
              class="rounded-full"
              :aria-label="t('project.preview.zoomIn')"
              :disabled="zoom >= ZOOM_MAX"
              data-testid="markdown-image-zoom-in"
              @click="stepZoom(1)"
            >
              <ZoomIn />
            </Button>
          </div>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
