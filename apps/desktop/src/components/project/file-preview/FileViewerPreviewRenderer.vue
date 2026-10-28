<script setup lang="ts">
import {
  computed,
  inject,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  useTemplateRef,
  watch,
} from "vue";
import { useI18n } from "vue-i18n";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Presentation,
  Search,
} from "@lucide/vue";
import type {
  FileViewerEvent,
  FileViewerInstance,
  FileViewerOptions,
  FileViewerSearchState,
  FileViewerSource,
  FileViewerViewState,
  FileViewerZoomState,
} from "@file-viewer/core";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { documentPreviewSelection } from "@/lib/filePreviewSelection";
import { skinFileViewerStyles } from "@/lib/fileViewerSkin";
import { themeSpreadsheets } from "@/lib/spreadsheetTheme";
import {
  isSpreadsheetPreview,
  spreadsheetPreviewSelection,
} from "@/lib/spreadsheetSelection";
import { cn } from "@/lib/utils";
import type { AttachmentSelection } from "@/shared/attachments";
import { useAppearanceStore } from "@/stores/appearance";
import {
  previewToolbarKey,
  type PreviewRendererEvents,
  type PreviewRendererProps,
} from "./previewRenderer";

/**
 * Renderers that draw fixed white pages even in dark mode, so they offer
 * inversion. Word, spreadsheet and most other renderers theme their pages.
 */
const invertibleRenderers = new Set([
  "pdf",
  "ofd",
  "office-presentation",
  "office-presentation-binary",
  "apple-keynote",
]);

/** Renderers whose content has text to search. */
const searchableRenderers = new Set([
  ...invertibleRenderers,
  "office-word-openxml",
  "office-word-binary",
  "office-wordperfect",
  "office-hangul",
  "open-document",
  "apple-pages",
  "typst",
  "spreadsheet-openxml",
  "spreadsheet-dbf",
  "apple-numbers",
  "code",
  "markdown",
  "email",
  "epub",
  "ebook-fb2",
  "umd",
  "chm",
  "archive",
]);

const props = defineProps<PreviewRendererProps>();
const emit = defineEmits<PreviewRendererEvents>();
const { t, locale } = useI18n();
const appearance = useAppearanceStore();
const host = useTemplateRef<HTMLDivElement>("host");

let viewer: FileViewerInstance | undefined;
let disposed = false;
let stopSkin: (() => void) | undefined;
let applyingZoom = false;
let searchTimer: ReturnType<typeof setTimeout> | undefined;
/** The loaded source, kept to render again when the theme changes. */
let loadedSource: FileViewerSource | undefined;
const reading = new AbortController();
const loading = ref(true);
const zoomState = shallowRef<FileViewerZoomState>();
const zoomable = ref(false);
const viewState = shallowRef<FileViewerViewState | null>(null);
const searchState = shallowRef<FileViewerSearchState>();
const rendererId = ref("");
const searchable = computed(() => searchableRenderers.has(rendererId.value));
const searchQuery = ref("");

// Inverting a light page reads as dark, so the chrome around it stays light.
const theme = computed(() =>
  props.inverted ? "light" : appearance.colorScheme,
);
const pageCount = computed(() => viewState.value?.pageCount ?? 0);
const page = computed(() => viewState.value?.page ?? 1);
const searchTotal = computed(() => searchState.value?.total ?? 0);
const searchPosition = computed(() =>
  t("project.preview.searchCount", {
    current: searchTotal.value ? (searchState.value?.currentIndex ?? 0) + 1 : 0,
    total: searchTotal.value,
  }),
);
const toolbar = inject(previewToolbarKey, undefined);
const toolbarTarget = computed(() => toolbar?.value ?? null);
/**
 * Controls the renderers draw inside their own chrome, which Pine hides and
 * repeats in the top bar: the spreadsheet's sheet tabs and the slideshow.
 */
const sheets = ref<string[]>([]);
const activeSheet = ref("0");
const slideshow = ref(false);
/**
 * Loading screens the renderers draw while they parse, which Pine hides and
 * replaces with its own spinner, as in its other previews.
 */
const BUSY_SELECTOR = [
  ".excel-wrapper[data-file-viewer-spreadsheet-root] > .loading:not(.hidden)",
  ".pdf-state:not([hidden]):not(.pdf-state--error)",
  ".pptx-loading:not([hidden])",
  ".ppt-binary-loading:not([hidden])",
].join(", ");
const busy = ref(false);
const toolbarVisible = computed(
  () =>
    !props.compact &&
    !loading.value &&
    (searchable.value ||
      pageCount.value > 1 ||
      sheets.value.length > 1 ||
      slideshow.value),
);
let chromeObserver: MutationObserver | undefined;

function readViewerChrome(): void {
  const element = host.value;
  if (!element) return;
  const tabs = [
    ...element.querySelectorAll<HTMLButtonElement>(".excel-wrapper .sheet-tab"),
  ];
  const names = tabs.map((tab) => tab.title || tab.textContent?.trim() || "");
  const active = tabs.findIndex((tab) => tab.classList.contains("active"));
  activeSheet.value = String(Math.max(0, active));
  busy.value = Boolean(element.querySelector(BUSY_SELECTOR));
  const presents = Boolean(element.querySelector(".pptx-slideshow-button"));
  if (
    names.join("\n") === sheets.value.join("\n") &&
    presents === slideshow.value
  )
    return;
  sheets.value = names;
  slideshow.value = presents;
  syncViewerState();
}

/**
 * Grids re-render on scroll, so the chrome is read at most once per frame's
 * worth of time. A timer, unlike an animation frame, also runs while the
 * window is hidden, where a loading screen can still finish.
 */
let chromeTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleChromeRead(): void {
  chromeTimer ??= setTimeout(() => {
    chromeTimer = undefined;
    readViewerChrome();
  }, 16);
}

function selectSheet(value: unknown): void {
  const tab = host.value?.querySelectorAll<HTMLButtonElement>(
    ".excel-wrapper .sheet-tab",
  )[Number(value)];
  tab?.click();
}

function startSlideshow(): void {
  host.value
    ?.querySelector<HTMLButtonElement>(".pptx-slideshow-button")
    ?.click();
}

function percent(scale: number): number {
  return Math.round(scale * 100);
}

function viewerOptions(
  preset: NonNullable<FileViewerOptions["preset"]>,
): FileViewerOptions {
  return {
    preset,
    rendererMode: "replace",
    autoRenderers: false,
    theme: theme.value,
    locale: locale.value.startsWith("zh") ? "zh-CN" : "en-US",
    // Pine draws its own controls; trackpad pinch and Ctrl/⌘ + wheel use
    // the viewer's continuous zoom, except in the fixed-size workbench card.
    toolbar: false,
    zoomGestures: !props.compact,
    search: { enabled: true },
    pdf: { toolbar: false, navigation: false },
    image: { rotation: false },
    text: { toolbar: false },
    ui: { surfaceBackground: "transparent" },
  };
}

/**
 * file-viewer renders from bytes, so a document is read whole through the
 * project media protocol before it loads.
 */
async function viewerSource(signal: AbortSignal): Promise<FileViewerSource> {
  const preview = props.preview;
  const source = { filename: props.fileName, size: preview.size };
  if (preview.kind === "text")
    return {
      ...source,
      buffer: new TextEncoder().encode(preview.text).buffer,
    };
  const response = await fetch(preview.url, { signal });
  if (!response.ok)
    throw new Error(`Failed to read the document (${response.status}).`);
  return { ...source, buffer: await response.arrayBuffer() };
}

/** Renderers may hand the bytes to a worker, which detaches the buffer. */
function sourceCopy(source: FileViewerSource): FileViewerSource {
  return { ...source, buffer: source.buffer?.slice(0) };
}

function handleViewerEvent(event: FileViewerEvent): void {
  if (event.type === "search-change") searchState.value = event.payload;
  else if (event.type === "view-state-change")
    viewState.value = event.payload.state;
  // Renderers finish layout after load() resolves, so zoom support, the
  // fitted zoom and the page count can arrive later.
  if (
    event.type === "zoom-change" ||
    event.type === "fit-change" ||
    event.type === "view-state-change" ||
    event.type === "operation-availability-change"
  )
    syncViewerState();
}

let reportedCapabilities = "";
let reportedPageCount: number | undefined;
let reportedScale: number | undefined;
function syncViewerState(): void {
  const instance = viewer;
  if (!instance || loading.value) return;
  if (host.value) themeSpreadsheets(host.value);
  const zoom = instance.getZoomState();
  zoomState.value = zoom;
  zoomable.value = instance.getCapabilities().zoom;
  const capabilities = {
    zoom: zoomable.value,
    invert: invertibleRenderers.has(rendererId.value),
    ...(zoomable.value && zoom.minScale
      ? { zoomMin: Math.max(10, percent(zoom.minScale)) }
      : {}),
    ...(zoomable.value && zoom.maxScale
      ? { zoomMax: Math.min(800, percent(zoom.maxScale)) }
      : {}),
    ...(zoomable.value && !props.compact
      ? { gestureZoom: true, fitWidth: true }
      : {}),
    ...(toolbarVisible.value ? { toolbar: true } : {}),
  };
  const serialized = JSON.stringify(capabilities);
  if (serialized !== reportedCapabilities) {
    reportedCapabilities = serialized;
    emit("capabilitiesChange", capabilities);
  }
  const scale = percent(zoom.scale);
  if (zoomable.value && !applyingZoom && scale !== reportedScale) {
    reportedScale = scale;
    emit("zoomChange", scale);
  }
  const count = viewState.value?.pageCount;
  if (count && count !== reportedPageCount) {
    reportedPageCount = count;
    emit("metadataChange", { pageCount: count });
  }
}

function mediaElements(): HTMLMediaElement[] {
  return [
    ...(host.value?.querySelectorAll<HTMLMediaElement>("video, audio") ?? []),
  ];
}

function reportMediaMetadata(): void {
  const element = host.value;
  if (!element) return;
  const media = mediaElements()[0];
  if (media) {
    const report = (): void => {
      emit("metadataChange", {
        ...(media instanceof HTMLVideoElement && media.videoWidth
          ? { width: media.videoWidth, height: media.videoHeight }
          : {}),
        duration: media.duration,
      });
    };
    if (media.readyState >= HTMLMediaElement.HAVE_METADATA) report();
    else media.addEventListener("loadedmetadata", report, { once: true });
    return;
  }
  const image =
    viewer?.getRenderer()?.id === "image"
      ? element.querySelector<HTMLImageElement>("img")
      : null;
  if (!image) return;
  const report = (): void => {
    if (image.naturalWidth)
      emit("metadataChange", {
        width: image.naturalWidth,
        height: image.naturalHeight,
      });
  };
  if (image.complete) report();
  else image.addEventListener("load", report, { once: true });
}

onMounted(async () => {
  const element = host.value;
  if (!element) return;
  // Renderers inject their stylesheets while they render.
  stopSkin = skinFileViewerStyles(element);
  try {
    const [{ createViewer, setDefaultFileViewerAssetBaseUrl }, preset] =
      await Promise.all([
        import("@file-viewer/core"),
        import("@file-viewer/preset-all"),
      ]);
    if (disposed) return;
    // Workers, WASM and fonts are published next to index.html, which loads
    // from the dev server or from a file:// URL in packaged builds.
    const assetBase = new URL("file-viewer/", document.baseURI).href;
    setDefaultFileViewerAssetBaseUrl(assetBase);
    preset.setDefaultFullAssetBaseUrl(assetBase);
    const { allRenderers } = preset;
    const instance = createViewer(element, {
      options: viewerOptions(allRenderers),
      onEvent: handleViewerEvent,
    });
    viewer = instance;
    loadedSource = await viewerSource(reading.signal);
    await instance.load(sourceCopy(loadedSource));
    if (disposed) return;
    // A format without a renderer loads into a placeholder instead of failing.
    if (!instance.getRenderer()?.load) throw new Error("No renderer.");
    rendererId.value = instance.getRenderer()?.id ?? "";
    viewState.value = instance.getViewState();
    loading.value = false;
    syncViewerState();
    readViewerChrome();
    chromeObserver = new MutationObserver(scheduleChromeRead);
    chromeObserver.observe(element, {
      childList: true,
      subtree: true,
      attributeFilter: ["class", "hidden"],
    });
    reportMediaMetadata();
  } catch (error) {
    if (disposed) return;
    console.error("Failed to render the file preview.", error);
    emit("failed");
  } finally {
    loading.value = false;
  }
});

onBeforeUnmount(() => {
  disposed = true;
  stopSkin?.();
  chromeObserver?.disconnect();
  clearTimeout(chromeTimer);
  reading.abort();
  if (searchTimer) clearTimeout(searchTimer);
  for (const media of mediaElements()) media.pause();
  void viewer?.destroy().catch(() => {});
  viewer = undefined;
});

// Renderers style their content for the theme they load with, so a theme
// change renders the document again.
watch(theme, async (value) => {
  const instance = viewer;
  if (!instance) return;
  instance.updateOptions({ theme: value });
  if (loading.value || !loadedSource) return;
  try {
    await instance.load(sourceCopy(loadedSource));
    if (disposed) return;
    viewState.value = instance.getViewState();
    syncViewerState();
  } catch (error) {
    if (disposed) return;
    console.error("Failed to render the file preview.", error);
    emit("failed");
  }
});

watch(
  () => props.active,
  (active) => {
    if (!active) for (const media of mediaElements()) media.pause();
  },
);

/**
 * Follows the footer slider while it moves. A zoom renders asynchronously, so
 * levels that arrive meanwhile collapse into the latest one, as the viewer's
 * own gestures do.
 */
let requestedScale: number | undefined;
async function applyRequestedZoom(): Promise<void> {
  const instance = viewer;
  if (applyingZoom || !instance) return;
  applyingZoom = true;
  try {
    while (requestedScale !== undefined && !disposed) {
      const value = requestedScale;
      requestedScale = undefined;
      // Its own zoom events report this level, which the slider already shows.
      reportedScale = value;
      await instance.applyViewState({ scale: value / 100 }, { notify: false });
      zoomState.value = { ...instance.getZoomState(), scale: value / 100 };
    }
  } finally {
    applyingZoom = false;
  }
}
watch(
  () => props.zoom,
  (value) => {
    if (!viewer || !zoomable.value || loading.value) return;
    if (zoomState.value && percent(zoomState.value.scale) === value) return;
    requestedScale = value;
    void applyRequestedZoom();
  },
);

async function fitWidth(): Promise<void> {
  const instance = viewer;
  if (!instance) return;
  await instance.fitToView("width");
  syncViewerState();
}

async function goToPage(target: number): Promise<void> {
  const instance = viewer;
  if (!instance || !pageCount.value) return;
  const next = Math.min(pageCount.value, Math.max(1, Math.round(target)));
  if (next === page.value) return;
  viewState.value =
    (await instance.applyViewState(
      { page: next },
      { action: "page-step", source: "user" },
    )) ?? instance.getViewState();
}

function commitPage(event: Event): void {
  const input = event.target as HTMLInputElement;
  const value = Number(input.value);
  if (Number.isFinite(value)) void goToPage(value);
  input.value = String(page.value);
}

watch(searchQuery, (query) => {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    const instance = viewer;
    if (!instance) return;
    void (query.trim() ? instance.search(query) : instance.clearSearch()).then(
      (state) => {
        searchState.value = state;
      },
    );
  }, 200);
});

async function stepSearch(direction: 1 | -1): Promise<void> {
  const instance = viewer;
  if (!instance || !searchTotal.value) return;
  searchState.value = await (direction > 0
    ? instance.nextSearchResult()
    : instance.previousSearchResult());
}

function readSelection(): AttachmentSelection | undefined {
  const element = host.value;
  if (!props.active || !element) return undefined;
  return isSpreadsheetPreview(element)
    ? spreadsheetPreviewSelection(element, props.selectionLabel)
    : documentPreviewSelection(element, props.selectionLabel);
}

function updateSelection(): void {
  emit("selectionChange", readSelection());
}

defineExpose({ readSelection, fitWidth });
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <Teleport v-if="toolbarTarget && toolbarVisible" :to="toolbarTarget">
      <Select
        v-if="sheets.length > 1"
        :model-value="activeSheet"
        @update:model-value="selectSheet"
      >
        <SelectTrigger
          size="sm"
          class="w-48"
          :aria-label="t('project.preview.worksheet')"
        >
          <SelectValue>{{ sheets[Number(activeSheet)] }}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem
            v-for="(name, index) in sheets"
            :key="index"
            :value="String(index)"
          >
            <span class="truncate">{{ name }}</span>
          </SelectItem>
        </SelectContent>
      </Select>
      <Button
        v-if="slideshow"
        variant="ghost"
        size="sm"
        @click="startSlideshow"
      >
        <Presentation />
        {{ t("project.preview.slideshow") }}
      </Button>
      <InputGroup v-if="searchable" class="h-8 w-60">
        <InputGroupAddon>
          <Search />
        </InputGroupAddon>
        <InputGroupInput
          v-model="searchQuery"
          type="search"
          :placeholder="t('project.preview.search')"
          :aria-label="t('project.preview.search')"
          @keydown.enter.prevent="stepSearch($event.shiftKey ? -1 : 1)"
        />
        <InputGroupAddon align="inline-end">
          <InputGroupText v-if="searchQuery" class="tabular-nums">
            {{ searchPosition }}
          </InputGroupText>
          <InputGroupButton
            size="icon-xs"
            :aria-label="t('project.preview.searchPrevious')"
            :disabled="!searchTotal"
            @click="stepSearch(-1)"
          >
            <ChevronUp />
          </InputGroupButton>
          <InputGroupButton
            size="icon-xs"
            :aria-label="t('project.preview.searchNext')"
            :disabled="!searchTotal"
            @click="stepSearch(1)"
          >
            <ChevronDown />
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      <div
        v-if="pageCount > 1"
        class="flex items-center gap-1 text-sm text-muted-foreground"
      >
        <Button
          variant="ghost"
          size="icon-sm"
          :aria-label="t('project.preview.previousPage')"
          :disabled="page <= 1"
          @click="goToPage(page - 1)"
        >
          <ChevronLeft />
        </Button>
        <InputGroup class="h-7 w-auto">
          <InputGroupInput
            :key="page"
            class="w-10 text-center tabular-nums"
            inputmode="numeric"
            :model-value="String(page)"
            :aria-label="t('project.preview.page')"
            @change="commitPage"
            @keydown.enter.prevent="commitPage"
          />
          <InputGroupAddon align="inline-end">
            <InputGroupText class="tabular-nums"
              >/ {{ pageCount }}</InputGroupText
            >
          </InputGroupAddon>
        </InputGroup>
        <Button
          variant="ghost"
          size="icon-sm"
          :aria-label="t('project.preview.nextPage')"
          :disabled="page >= pageCount"
          @click="goToPage(page + 1)"
        >
          <ChevronRight />
        </Button>
      </div>
    </Teleport>
    <div class="relative min-h-0 flex-1">
      <div
        ref="host"
        data-slot="file-viewer"
        :data-viewer-theme="theme"
        :class="
          cn(
            'pine-file-viewer absolute inset-0 overflow-hidden',
            inverted && 'pine-file-viewer-inverted',
          )
        "
        @pointerup="updateSelection"
        @keyup="updateSelection"
      />
      <div
        v-if="loading || busy"
        class="absolute inset-0 grid place-items-center bg-background"
        role="status"
      >
        <Spinner class="size-5 text-muted-foreground" />
      </div>
    </div>
  </div>
</template>

<style>
/*
 * file-viewer renders plain DOM styled through these variables. Mapping them
 * to Pine's tokens keeps its panels, toolbars and states in the app theme.
 */
.pine-file-viewer {
  --pine-fv-background: var(--background);
  --pine-fv-card: var(--card);
  --pine-fv-muted: var(--muted);
  --pine-fv-foreground: var(--foreground);
  --pine-fv-muted-foreground: var(--muted-foreground);
  --pine-fv-border: var(--border);
  --pine-fv-accent: var(--accent);
  --pine-fv-accent-foreground: var(--accent-foreground);
  --pine-fv-ring: var(--ring);
  --pine-fv-primary: var(--primary);
  --pine-fv-primary-foreground: var(--primary-foreground);
  --file-viewer-font: var(--font-sans, inherit);
  --file-viewer-bg: var(--pine-fv-background);
  --file-viewer-content-bg: var(--pine-fv-background);
  --file-viewer-render-surface-background: var(--pine-fv-background);
  --file-viewer-panel: var(--pine-fv-card);
  --file-viewer-text: var(--pine-fv-foreground);
  --file-viewer-muted: var(--pine-fv-muted-foreground);
  --file-viewer-border: var(--pine-fv-border);
  --file-viewer-focus-ring: var(--pine-fv-ring);
  --file-viewer-toolbar-bg: var(--pine-fv-background);
  --file-viewer-toolbar-border: var(--pine-fv-border);
  --file-viewer-toolbar-shadow: none;
  --file-viewer-toolbar-radius: var(--radius);
  --file-viewer-group-bg: var(--pine-fv-muted);
  --file-viewer-group-border: transparent;
  --file-viewer-button-color: var(--pine-fv-foreground);
  --file-viewer-button-hover-bg: var(--pine-fv-accent);
  --file-viewer-button-hover-color: var(--pine-fv-accent-foreground);
  --file-viewer-button-disabled-color: var(--pine-fv-muted-foreground);
  --file-viewer-button-radius: calc(var(--radius) - 2px);
  --file-viewer-input-bg: var(--pine-fv-background);
  --file-viewer-input-color: var(--pine-fv-foreground);
  color-scheme: light;
  font-family: var(--file-viewer-font);
  color: var(--file-viewer-text);
  background: var(--file-viewer-bg);
}

.pine-file-viewer[data-viewer-theme="dark"] {
  color-scheme: dark;
}

/*
 * Inversion turns white pages dark. The tokens are pre-inverted the way the
 * filter inverts: each sRGB channel flipped, with the hue turned half way
 * round, so once the filter applies the chrome around the pages shows the
 * app theme's exact colors again.
 */
.pine-file-viewer-inverted {
  --pine-fv-background: rgb(
    from oklch(from var(--background) l c calc(h + 180)) calc(255 - r)
      calc(255 - g) calc(255 - b)
  );
  --pine-fv-card: rgb(
    from oklch(from var(--card) l c calc(h + 180)) calc(255 - r) calc(255 - g)
      calc(255 - b)
  );
  --pine-fv-muted: rgb(
    from oklch(from var(--muted) l c calc(h + 180)) calc(255 - r) calc(255 - g)
      calc(255 - b)
  );
  --pine-fv-foreground: rgb(
    from oklch(from var(--foreground) l c calc(h + 180)) calc(255 - r)
      calc(255 - g) calc(255 - b)
  );
  --pine-fv-muted-foreground: rgb(
    from oklch(from var(--muted-foreground) l c calc(h + 180)) calc(255 - r)
      calc(255 - g) calc(255 - b)
  );
  --pine-fv-border: rgb(
    from oklch(from var(--border) l c calc(h + 180)) calc(255 - r) calc(255 - g)
      calc(255 - b)
  );
  --pine-fv-accent: rgb(
    from oklch(from var(--accent) l c calc(h + 180)) calc(255 - r) calc(255 - g)
      calc(255 - b)
  );
  --pine-fv-accent-foreground: rgb(
    from oklch(from var(--accent-foreground) l c calc(h + 180)) calc(255 - r)
      calc(255 - g) calc(255 - b)
  );
  --pine-fv-ring: rgb(
    from oklch(from var(--ring) l c calc(h + 180)) calc(255 - r) calc(255 - g)
      calc(255 - b)
  );
  --pine-fv-primary: rgb(
    from oklch(from var(--primary) l c calc(h + 180)) calc(255 - r)
      calc(255 - g) calc(255 - b)
  );
  --pine-fv-primary-foreground: rgb(
    from oklch(from var(--primary-foreground) l c calc(h + 180)) calc(255 - r)
      calc(255 - g) calc(255 - b)
  );
  filter: invert(1) hue-rotate(180deg);
}
</style>

<style src="./fileViewerSkin.css"></style>
