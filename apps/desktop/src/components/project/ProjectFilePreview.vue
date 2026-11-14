<script setup lang="ts">
import { isWebClient } from "@/lib/clientRuntime";
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  provide,
  ref,
  shallowRef,
  useId,
  useTemplateRef,
  watch,
} from "vue";
import { useI18n } from "vue-i18n";
import {
  Download,
  ExternalLink,
  FileQuestion,
  FileWarning,
  MessageSquareTextIcon,
  MoveHorizontal,
  Plus,
  Send,
  SquareDashedMousePointer,
  SquareTerminal,
} from "@lucide/vue";
import { toast } from "vue-sonner";
import { handleError } from "@/app/errors/errorHandler";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useContentTabsStore } from "@/stores/contentTabs";
import { useAppearanceStore } from "@/stores/appearance";
import { useAttentionFlashStore } from "@/stores/attentionFlash";
import { useFileToSession } from "@/composables/useFileToSession";
import {
  surfaceOf,
  usePreviewAnnotationHighlights,
} from "@/composables/usePreviewAnnotationHighlights";
import { createTextAnchor } from "@/lib/annotationAnchors";
import { annotationPosition, regionText } from "@/lib/annotationLocation";
import {
  MAX_ANNOTATIONS,
  annotationFileKey,
  annotationQuotes,
  usePreviewAnnotationsStore,
} from "@/stores/previewAnnotations";
import { Skeleton } from "@/components/ui/skeleton";
import {
  fileName as pathBaseName,
  fileTargetPath,
  operateFileTarget,
} from "@/lib/filePreviewTarget";
import { formatBytes } from "@/lib/formatBytes";
import { formatDuration } from "@/lib/formatDuration";
import type { AttachmentSelection } from "@/shared/attachments";
import type {
  ProjectFilePreview,
  FilePreviewTarget,
  FilePreviewChangedEvent,
} from "@/shared/projectFiles";
import { parseFileReveal } from "@/shared/projectFiles";
import type { FileContentTab } from "@/stores/contentTabs";
import {
  previewAnnotationsKey,
  previewRendererKey,
  previewToolbarKey,
  resolvePreviewRenderer,
} from "./file-preview/previewRenderer";
import type {
  AnnotationCellSelection,
  AnnotationCells,
  AnnotationComposeRequest,
  AnnotationPlace,
  AnnotationShape,
  AnnotationSurface,
  AnnotationTarget,
  PreviewRendererCapabilities,
  PreviewRendererHandle,
  PreviewRendererMetadata,
} from "./file-preview/previewRenderer";
import { previewRenderers } from "./file-preview/previewRenderers";
import ProjectPreviewAnnotationMenu from "./ProjectPreviewAnnotationMenu.vue";
import ProjectPreviewAnnotationOverlay from "./ProjectPreviewAnnotationOverlay.vue";
import ProjectPreviewAnnotationPanel from "./ProjectPreviewAnnotationPanel.vue";

const props = withDefaults(
  defineProps<{ file: FileContentTab; active?: boolean }>(),
  { active: true },
);
const { t, locale } = useI18n();
const isWeb = isWebClient();
// Presented files live outside the project, so they cannot be sent to a
// session as a project entry; opening with the default app still works.
const projectTarget = computed(() =>
  props.file.source === "project" ? props.file : null,
);
const filePath = computed(() => fileTargetPath(props.file));
const preview = ref<ProjectFilePreview>();
const viewMode = ref<"code" | "rendered">("rendered");
const reveal = computed(() =>
  preview.value?.kind === "text" && viewMode.value === "code"
    ? parseFileReveal(props.file.reveal)
    : undefined,
);
watch(
  () => props.file.reveal,
  (location) => {
    if (parseFileReveal(location)) viewMode.value = "code";
  },
  { immediate: true },
);
const renderSwitchId = useId();
const invertSwitchId = useId();
const rendererInstance = useTemplateRef<PreviewRendererHandle>("renderer");
const toolbar = useTemplateRef<HTMLElement>("toolbar");
provide(previewToolbarKey, toolbar);
const renderer = computed(() => {
  const value = preview.value;
  return value && value.kind !== "unsupported"
    ? resolvePreviewRenderer(previewRenderers, {
        preview: value,
        filePath: filePath.value,
        mode: viewMode.value,
      })
    : undefined;
});
/** Controls the mounted renderer reported after loading its content. */
const loadedCapabilities = ref<Partial<PreviewRendererCapabilities>>({});
const capabilities = computed<PreviewRendererCapabilities>(() => {
  const value = preview.value;
  if (!renderer.value || !value || value.kind === "unsupported")
    return { zoom: false, invert: false, renderToggle: false };
  return {
    ...renderer.value.capabilities({
      preview: value,
      filePath: filePath.value,
      mode: viewMode.value,
    }),
    ...loadedCapabilities.value,
  };
});
const toolbarVisible = computed(
  () =>
    capabilities.value.zoom ||
    capabilities.value.fitWidth ||
    capabilities.value.toolbar,
);
const zoomMin = computed(() => capabilities.value.zoomMin ?? 50);
const zoomMax = computed(() => capabilities.value.zoomMax ?? 200);
// The first time the renderer can invert, follow the app's color scheme.
let inversionFollowsScheme = true;
watch(
  () => renderer.value?.id,
  () => {
    loadedCapabilities.value = {};
  },
);
const rendered = computed(
  () => capabilities.value.renderToggle && viewMode.value === "rendered",
);
const selectedRange = ref<AttachmentSelection>();
const menuOpen = ref(false);
const menuSelection = ref<AttachmentSelection>();

function updateSelection(): void {
  if (menuOpen.value) return;
  if (rendererInstance.value?.readSelection)
    selectedRange.value = props.active
      ? rendererInstance.value.readSelection()
      : undefined;
}

function handleSelectionChange(
  selection: AttachmentSelection | undefined,
): void {
  if (!menuOpen.value)
    selectedRange.value = props.active ? selection : undefined;
}

function handleMetadataChange(metadata: PreviewRendererMetadata): void {
  contentMetadata.value = { ...contentMetadata.value, ...metadata };
}

function handleCapabilitiesChange(
  next: Partial<PreviewRendererCapabilities>,
): void {
  loadedCapabilities.value = next;
  if (next.invert && inversionFollowsScheme) {
    inversionFollowsScheme = false;
    previewInverted.value = appearanceStore.invertsDocuments;
  }
}

/** The renderer fitted or zoomed by itself; show its level without re-applying it. */
function handleZoomChange(value: number): void {
  if (zoomCommitTimer) clearTimeout(zoomCommitTimer);
  if (zoomFrame !== undefined) {
    cancelAnimationFrame(zoomFrame);
    zoomFrame = undefined;
  }
  pendingZoom = value;
  previewZoom.value = [value];
  appliedZoom.value = value;
}

function updateMenu(open: boolean): void {
  if (open) {
    updateSelection();
    menuSelection.value = selectedRange.value;
  }
  menuOpen.value = open;
  if (!open) updateSelection();
}

watch(viewMode, () => {
  selectedRange.value = undefined;
  menuSelection.value = undefined;
});
const tabsStore = useContentTabsStore();
const appearanceStore = useAppearanceStore();
const attentionFlash = useAttentionFlashStore();
// Only sessions of the file's own project can read it from their sandbox.
const sessionTabs = computed(() =>
  tabsStore.tabs.filter(
    (tab) => tab.kind === "session" && tab.projectId === props.file.projectId,
  ),
);
const { isSending, sendFile, sendQuotes } = useFileToSession();
const sessionTargets = computed(() =>
  sessionTabs.value.map((tab) => ({
    id: tab.id,
    label:
      "label" in tab && tab.label
        ? tab.label
        : t("project.contentTabs.newSession"),
  })),
);
const failed = ref(false);
const revision = ref(0);
const stale = ref(false);
const fileName = computed(() => pathBaseName(filePath.value));
const contentMetadata = ref<PreviewRendererMetadata>();
const previewInverted = ref(false);
const previewZoom = ref([100]);
const appliedZoom = ref(100);
const zoom = computed(() => previewZoom.value[0] ?? 100);
let zoomFrame: number | undefined;
let zoomCommitTimer: ReturnType<typeof setTimeout> | undefined;
let pendingZoom = 100;
const fileType = computed(() => {
  const name = fileName.value;
  const extension = name.includes(".") ? name.split(".").at(-1) : undefined;
  return (
    extension?.toUpperCase() ||
    t(`project.preview.${preview.value?.kind === "text" ? "text" : "file"}`)
  );
});
const fileSize = computed(() =>
  formatBytes(preview.value?.size ?? 0, locale.value),
);
const lineCount = computed(() =>
  preview.value?.kind === "text"
    ? preview.value.text.split(/\r\n|\r|\n/).length
    : 0,
);
const duration = computed(() => {
  const seconds = contentMetadata.value?.duration;
  if (seconds === undefined || !Number.isFinite(seconds)) return "";
  return formatDuration(seconds);
});

function scheduleZoom(value: number): void {
  pendingZoom = value;
  if (zoomFrame !== undefined) return;
  zoomFrame = requestAnimationFrame(() => {
    appliedZoom.value = pendingZoom;
    zoomFrame = undefined;
  });
}

function commitZoom(value: number[]): void {
  if (zoomCommitTimer) clearTimeout(zoomCommitTimer);
  const committed = value[0] ?? 100;
  pendingZoom = committed;
  if (zoomFrame !== undefined) {
    cancelAnimationFrame(zoomFrame);
    zoomFrame = undefined;
  }
  appliedZoom.value = committed;
}

function handlePreviewWheel(event: WheelEvent): void {
  if (
    !capabilities.value.zoom ||
    // The renderer zooms continuously under the pointer by itself.
    capabilities.value.gestureZoom ||
    !(event.ctrlKey || event.metaKey)
  )
    return;
  event.preventDefault();
  const next = Math.max(
    zoomMin.value,
    Math.min(zoomMax.value, zoom.value - event.deltaY * 0.5),
  );
  previewZoom.value = [Math.round(next)];
  scheduleZoom(Math.round(next));
  if (zoomCommitTimer) clearTimeout(zoomCommitTimer);
  zoomCommitTimer = setTimeout(() => commitZoom(previewZoom.value), 180);
}

/** The levels a browser's ⌘ + and ⌘ − step through. */
const ZOOM_STEPS = [
  25, 33, 50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300, 400, 500,
];

function stepZoom(direction: -1 | 0 | 1): void {
  const current = zoom.value;
  const target =
    direction === 0
      ? 100
      : direction > 0
        ? (ZOOM_STEPS.find((step) => step > current) ?? zoomMax.value)
        : ([...ZOOM_STEPS].reverse().find((step) => step < current) ??
          zoomMin.value);
  const next = Math.max(zoomMin.value, Math.min(zoomMax.value, target));
  previewZoom.value = [next];
  commitZoom([next]);
}

/**
 * ⌘ + / ⌘ − / ⌘ 0 zoom the preview, as they zoom a page in a browser,
 * instead of the whole window.
 */
function handleZoomKey(event: KeyboardEvent): void {
  if (!capabilities.value.zoom || !(event.metaKey || event.ctrlKey)) return;
  if (event.altKey) return;
  const direction =
    event.key === "=" || event.key === "+"
      ? 1
      : event.key === "-" || event.key === "_"
        ? -1
        : event.key === "0"
          ? 0
          : undefined;
  if (direction === undefined) return;
  event.preventDefault();
  stepZoom(direction);
}

/** With nothing focused, the shortcuts belong to the visible preview. */
function handleWindowZoomKey(event: KeyboardEvent): void {
  if (props.active && event.target === document.body) handleZoomKey(event);
}
onMounted(() => window.addEventListener("keydown", handleWindowZoomKey));

async function openWithDefaultApplication(): Promise<void> {
  try {
    await operateFileTarget(props.file, "open");
  } catch (error) {
    handleError(error, {
      id: "project.preview.open-default",
      title: t("project.preview.openDefaultFailed"),
    });
  }
}

const watchId = useId();
const previewTarget = computed<FilePreviewTarget>(() => {
  const file = props.file;
  return file.source === "project"
    ? {
        source: "project",
        projectId: file.projectId,
        folderId: file.folderId,
        relativePath: file.relativePath,
      }
    : { source: "presented", path: file.path };
});
const previewKey = computed(() => JSON.stringify(previewTarget.value));
let watchReady: Promise<void> = Promise.resolve();

function handleFilePreviewChanged(event: FilePreviewChangedEvent): void {
  if (event.watchId !== watchId) return;
  attentionFlash.flashOnce(props.file.id);
  if (props.active) revision.value += 1;
  else stale.value = true;
}

const unsubscribeFileWatcher = window.pine.onFilePreviewChanged?.(
  handleFilePreviewChanged,
);
watch(
  previewKey,
  (_key, _previous, onCleanup) => {
    watchReady =
      window.pine
        .setWatchedFilePreview?.({
          watchId,
          target: previewTarget.value,
        })
        .catch((error: unknown) => {
          console.error("Failed to watch file preview.", error);
        }) ?? Promise.resolve();
    onCleanup(() => {
      void window.pine
        .setWatchedFilePreview?.({ watchId, target: null })
        .catch(() => {});
    });
  },
  { immediate: true },
);

watch(
  () => [previewKey.value, revision.value] as const,
  async ([key], previous, onCleanup) => {
    let active = true;
    onCleanup(() => {
      active = false;
    });
    const fileChanged = key !== previous?.[0];
    if (fileChanged) {
      preview.value = undefined;
      viewMode.value = parseFileReveal(props.file.reveal) ? "code" : "rendered";
      contentMetadata.value = undefined;
      previewInverted.value = false;
      inversionFollowsScheme = true;
      loadedCapabilities.value = {};
      previewZoom.value = [100];
      if (zoomCommitTimer) clearTimeout(zoomCommitTimer);
      appliedZoom.value = 100;
      pendingZoom = 100;
      stale.value = false;
    }
    selectedRange.value = undefined;
    menuSelection.value = undefined;
    failed.value = false;
    try {
      // Subscribe before the first read so a write during loading cannot fall
      // between the content snapshot and installation of the watcher.
      await watchReady;
      if (!active) return;
      const target = previewTarget.value;
      const result =
        target.source === "project"
          ? await window.pine.readProjectFilePreview({
              projectId: target.projectId,
              folderId: target.folderId,
              relativePath: target.relativePath,
            })
          : await window.pine.readPresentedFilePreview({ path: target.path });
      if (active) {
        if (!fileChanged && "url" in result && result.url) {
          const url = new URL(result.url);
          url.searchParams.set("revision", String(revision.value));
          result.url = url.href;
        }
        preview.value = result;
        if (fileChanged)
          previewInverted.value =
            capabilities.value.invert && appearanceStore.invertsDocuments;
      }
    } catch {
      if (active) failed.value = true;
    }
  },
  { immediate: true },
);

watch(
  () => props.active,
  (active) => {
    if (!active) selectedRange.value = undefined;
    else if (stale.value) {
      stale.value = false;
      revision.value += 1;
    }
  },
);

watch(
  () => appearanceStore.invertsDocuments,
  (inverts) => {
    if (capabilities.value.invert) previewInverted.value = inverts;
  },
);
watch(zoom, scheduleZoom);
onBeforeUnmount(() => {
  window.removeEventListener("keydown", handleWindowZoomKey);
  unsubscribeFileWatcher?.();
  if (zoomFrame !== undefined) cancelAnimationFrame(zoomFrame);
  if (zoomCommitTimer) clearTimeout(zoomCommitTimer);
});

// Comments on passages, cells, areas and time spans of a project file,
// collected here and sent together.
const annotationsStore = usePreviewAnnotationsStore();
const annotationKey = computed(() =>
  projectTarget.value ? annotationFileKey(projectTarget.value) : undefined,
);
const annotations = computed(() =>
  annotationKey.value
    ? annotationsStore.annotationsFor(annotationKey.value)
    : [],
);
const canAnnotate = computed(
  () =>
    Boolean(projectTarget.value) &&
    !failed.value &&
    Boolean(
      capabilities.value.annotate ||
      capabilities.value.annotateRegions ||
      capabilities.value.annotateCells ||
      capabilities.value.annotateTime,
    ),
);
const canAnnotateRegions = computed(
  () => canAnnotate.value && Boolean(capabilities.value.annotateRegions),
);
const annotationsOpen = ref(false);
const activeAnnotationId = ref<string>();
const annotationDraft = shallowRef<Range>();
const shapeDraft = shallowRef<AnnotationComposeRequest>();
/** Drawing a box for a new area comment. */
const drawingRegion = ref(false);
const rendererHost = useTemplateRef<HTMLElement>("rendererHost");
const annotationMenu =
  useTemplateRef<InstanceType<typeof ProjectPreviewAnnotationMenu>>(
    "annotationMenu",
  );
const annotationOverlay =
  useTemplateRef<InstanceType<typeof ProjectPreviewAnnotationOverlay>>(
    "annotationOverlay",
  );
const annotationsFull = computed(
  () => annotations.value.length >= MAX_ANNOTATIONS,
);

function annotationSurfaces(): readonly AnnotationSurface[] {
  const handle = rendererInstance.value;
  if (!capabilities.value.annotate || !handle) return [];
  if (handle.annotationSurfaces) return handle.annotationSurfaces();
  const surface = handle.annotationSurface?.();
  return surface ? [surface] : [];
}

function annotationTargets(): readonly AnnotationTarget[] {
  return capabilities.value.annotateRegions
    ? (rendererInstance.value?.annotationTargets?.() ?? [])
    : [];
}

function annotationCellRects(cells: AnnotationCells): readonly DOMRect[] {
  return capabilities.value.annotateCells
    ? (rendererInstance.value?.annotationCellRects?.(cells) ?? [])
    : [];
}

function readAnnotationCells(): AnnotationCellSelection | undefined {
  return capabilities.value.annotateCells
    ? rendererInstance.value?.annotationCellSelection?.()
    : undefined;
}

function openAnnotation(id: string): void {
  annotationsOpen.value = true;
  activeAnnotationId.value = id;
}

const highlights = usePreviewAnnotationHighlights({
  surfaces: annotationSurfaces,
  host: rendererHost,
  annotations,
  mode: viewMode,
  activeId: activeAnnotationId,
  draft: annotationDraft,
  enabled: canAnnotate,
  lines: (range) => rendererInstance.value?.annotationLines?.(range),
  onPlaced: (id, placement) => {
    if (annotationKey.value)
      annotationsStore.place(annotationKey.value, id, {
        ...placement,
        version: preview.value?.modifiedAt ?? "",
      });
  },
  onLost: (id) => {
    if (annotationKey.value)
      annotationsStore.orphan(
        annotationKey.value,
        id,
        preview.value?.modifiedAt ?? "",
      );
  },
  onHit: openAnnotation,
});

/** Places every comment again: the renderer says what they point at moved. */
function refreshAnnotations(): void {
  highlights.refresh();
  annotationOverlay.value?.refresh();
}

watch(annotationKey, () => {
  activeAnnotationId.value = undefined;
  annotationDraft.value = undefined;
  shapeDraft.value = undefined;
  drawingRegion.value = false;
});
watch(canAnnotateRegions, (can) => {
  if (!can) drawingRegion.value = false;
});
// A renderer reports its surfaces as it loads, switches view or re-renders.
watch(
  () =>
    [
      rendererInstance.value,
      capabilities.value.annotate,
      viewMode.value,
      preview.value,
    ] as const,
  () => void nextTick(highlights.refresh),
);

provide(previewAnnotationsKey, {
  annotations,
  activeId: activeAnnotationId,
  enabled: canAnnotate,
  draft: computed(() => shapeDraft.value?.shape),
  select: (id) => void revealAnnotation(id),
  compose: (request) => annotationMenu.value?.compose(request),
});

function saveAnnotation(range: Range, comment: string): void {
  const key = annotationKey.value;
  const surface = surfaceOf(
    highlights.surfaces.value,
    range.commonAncestorContainer,
  );
  if (!key || !surface) return;
  const anchor = createTextAnchor(surface.root, range, surface.excluded);
  if (!anchor) return;
  const added = annotationsStore.add(key, {
    mode: viewMode.value,
    anchor: {
      ...anchor,
      kind: "text",
      ...(surface.segment !== undefined ? { segment: surface.segment } : {}),
    },
    lines: rendererInstance.value?.annotationLines?.(range),
    ...(surface.place ? { place: surface.place } : {}),
    text: range.toString(),
    comment,
    version: preview.value?.modifiedAt ?? "",
  });
  if (!added) showAnnotationLimit();
}

function saveShapeAnnotation(
  request: AnnotationComposeRequest,
  comment: string,
): void {
  const key = annotationKey.value;
  if (!key) return;
  const added = annotationsStore.add(key, {
    mode: viewMode.value,
    anchor: request.shape,
    ...(request.place ? { place: request.place } : {}),
    text: request.text,
    comment,
    version: preview.value?.modifiedAt ?? "",
  });
  if (!added) showAnnotationLimit();
}

function startDrawingRegion(): void {
  if (annotationsFull.value) {
    showAnnotationLimit();
    return;
  }
  drawingRegion.value = !drawingRegion.value;
}

function composeRegion(input: {
  shape: Extract<AnnotationShape, { kind: "region" }>;
  place?: AnnotationPlace;
  size?: AnnotationTarget["size"];
  rect: () => DOMRect;
}): void {
  drawingRegion.value = false;
  annotationMenu.value?.compose({
    shape: input.shape,
    text: regionText(input.shape, input.size, t),
    ...(input.place ? { place: input.place } : {}),
    rect: input.rect,
  });
}

function showAnnotationLimit(): void {
  toast.error(t("project.preview.annotations.limit", { max: MAX_ANNOTATIONS }));
}

/** Shows a comment's passage, cells, area or time, in the view it was made in. */
async function revealAnnotation(id: string): Promise<void> {
  openAnnotation(id);
  const annotation = annotations.value.find((item) => item.id === id);
  if (!annotation) return;
  const anchor = annotation.anchor;
  if (
    anchor.kind === "text" &&
    annotation.mode !== viewMode.value &&
    capabilities.value.renderToggle
  )
    viewMode.value = annotation.mode;
  const segment = "segment" in anchor ? anchor.segment : undefined;
  if (segment !== undefined || annotation.place || anchor.kind !== "text") {
    await nextTick();
    await rendererInstance.value?.revealAnnotation?.({
      ...(segment !== undefined ? { segment } : {}),
      ...(annotation.place ? { place: annotation.place } : {}),
      ...(anchor.kind !== "text" ? { shape: anchor } : {}),
    });
  }
  if (anchor.kind !== "text" && anchor.kind !== "region") return;
  // The other view, page or chapter may still be rendering; look a while.
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await new Promise((resolve) => requestAnimationFrame(resolve));
    if (activeAnnotationId.value !== id) return;
    if (anchor.kind === "region") {
      const target =
        annotationTargets().find((item) => item.segment === anchor.segment) ??
        (annotationTargets().length === 1 ? annotationTargets()[0] : undefined);
      if (!target) continue;
      target.element.scrollIntoView({ block: "nearest", behavior: "smooth" });
      return;
    }
    const range = highlights.rangeOf(id);
    if (!range) continue;
    const node = range.startContainer;
    // The passage may be in a page's frame, whose nodes are not this
    // window's Element instances.
    const element =
      node.nodeType === Node.ELEMENT_NODE
        ? (node as Element)
        : node.parentElement;
    element?.scrollIntoView({ block: "center", behavior: "smooth" });
    return;
  }
}

async function sendAnnotations(target: string | null): Promise<void> {
  const key = annotationKey.value;
  const file = projectTarget.value;
  if (!key || !file) return;
  const sent = [...annotations.value];
  const delivered = await sendQuotes(file, target, (path) =>
    annotationQuotes(path, sent, (annotation) =>
      annotationPosition(annotation, t),
    ),
  );
  if (!delivered) return;
  for (const annotation of sent) annotationsStore.remove(key, annotation.id);
  activeAnnotationId.value = undefined;
  annotationsOpen.value = false;
}

/** The footer's send menu: the comments when there are any, else the file. */
function sendFromMenu(target: string | null): void {
  const file = projectTarget.value;
  if (!file) return;
  if (annotations.value.length) void sendAnnotations(target);
  else void sendFile(file, target, menuSelection.value);
}

function clearAnnotations(): void {
  if (annotationKey.value) annotationsStore.clear(annotationKey.value);
  activeAnnotationId.value = undefined;
}
</script>

<template>
  <section
    class="flex h-full min-h-0 flex-col"
    :aria-label="fileName"
    @wheel.capture="handlePreviewWheel"
    @keydown="handleZoomKey"
  >
    <Empty v-if="failed" class="flex-1" role="alert">
      <EmptyHeader>
        <EmptyMedia variant="icon"><FileWarning /></EmptyMedia>
        <EmptyTitle>{{ t("project.preview.failedTitle") }}</EmptyTitle>
        <EmptyDescription>{{
          t("project.preview.failedDescription")
        }}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent
        ><Button variant="outline" @click="revision += 1">{{
          t("project.preview.retry")
        }}</Button></EmptyContent
      >
    </Empty>
    <div
      v-else-if="!preview"
      class="flex flex-1 flex-col gap-3 p-6"
      role="status"
      :aria-label="t('project.files.loading')"
    >
      <Skeleton class="h-4 w-3/4" /><Skeleton class="h-4 w-1/2" /><Skeleton
        class="h-4 w-2/3"
      />
    </div>
    <Empty
      v-else-if="preview.kind === 'unsupported' || !renderer"
      class="flex-1"
    >
      <EmptyHeader>
        <EmptyMedia variant="icon"><FileQuestion /></EmptyMedia>
        <EmptyTitle>{{ t("project.preview.unsupportedTitle") }}</EmptyTitle>
        <EmptyDescription>{{
          t(
            preview.kind === "unsupported" && preview.reason === "too-large"
              ? "project.preview.tooLarge"
              : preview.kind === "unsupported" &&
                  preview.reason === "document-too-large"
                ? "project.preview.documentTooLarge"
                : "project.preview.unsupportedDescription",
          )
        }}</EmptyDescription>
      </EmptyHeader>
    </Empty>
    <div
      v-show="toolbarVisible && !failed"
      role="toolbar"
      :aria-label="t('project.preview.documentControls')"
      class="flex min-h-10 shrink-0 items-center gap-2 px-3 pb-1"
    >
      <div
        ref="toolbar"
        data-slot="preview-toolbar-start"
        class="flex min-w-0 flex-1 items-center gap-2"
      />
      <Button
        v-if="capabilities.fitWidth"
        variant="ghost"
        size="sm"
        @click="rendererInstance?.fitWidth?.()"
      >
        <MoveHorizontal data-icon="inline-start" />
        {{ t("project.preview.fitWidth") }}
      </Button>
      <div
        v-if="capabilities.zoom"
        class="flex items-center gap-2 text-sm text-muted-foreground"
      >
        <Slider
          v-model="previewZoom"
          class="w-20"
          :min="zoomMin"
          :max="zoomMax"
          :step="10"
          :aria-label="t('project.preview.zoom')"
          :title="t('project.preview.zoomValue', { value: zoom })"
          @value-commit="commitZoom"
        />
        <span class="w-10 text-right tabular-nums">{{ zoom }}%</span>
      </div>
    </div>
    <div
      v-if="preview && preview.kind !== 'unsupported' && renderer && !failed"
      class="@container flex min-h-0 flex-1"
    >
      <div
        ref="rendererHost"
        class="relative flex min-h-0 min-w-0 flex-1 flex-col"
      >
        <component
          :is="renderer.component"
          ref="renderer"
          :key="previewRendererKey(previewKey, renderer, preview)"
          class="min-h-0 flex-1"
          :preview="preview"
          :file-name="fileName"
          :file-path="filePath"
          :active="active"
          :mode="viewMode"
          :reveal="reveal"
          :zoom="appliedZoom"
          :inverted="previewInverted"
          :selection-label="t('project.preview.selectedContent')"
          @failed="failed = true"
          @metadata-change="handleMetadataChange"
          @capabilities-change="handleCapabilitiesChange"
          @zoom-change="handleZoomChange"
          @selection-change="handleSelectionChange"
          @zoom-wheel="handlePreviewWheel"
          @annotations-change="refreshAnnotations"
        />
        <ProjectPreviewAnnotationOverlay
          v-if="
            canAnnotate &&
            (capabilities.annotateRegions || capabilities.annotateCells)
          "
          ref="annotationOverlay"
          :container="rendererHost"
          :annotations="annotations"
          :active-id="activeAnnotationId"
          :draft="shapeDraft?.shape"
          :drawing="drawingRegion"
          :targets="annotationTargets"
          :cell-rects="annotationCellRects"
          @select="openAnnotation"
          @drawn="composeRegion"
          @cancel-drawing="drawingRegion = false"
        />
      </div>
      <Transition
        enter-active-class="transition-[width,opacity] duration-200 ease-(--ease-out-expo)"
        leave-active-class="transition-[width,opacity] duration-200 ease-(--ease-out-expo)"
        enter-from-class="w-0 opacity-0"
        leave-to-class="w-0 opacity-0"
      >
        <ProjectPreviewAnnotationPanel
          v-if="annotationsOpen && projectTarget"
          :annotations="annotations"
          :active-id="activeAnnotationId"
          :mode="viewMode"
          :has-views="capabilities.renderToggle"
          :session-tabs="sessionTargets"
          :sending="isSending"
          @select="revealAnnotation"
          @update="
            (id, comment) =>
              annotationKey &&
              annotationsStore.updateComment(annotationKey, id, comment)
          "
          @remove="
            (id) => annotationKey && annotationsStore.remove(annotationKey, id)
          "
          @clear="clearAnnotations"
          @send="sendAnnotations"
          @close="annotationsOpen = false"
        />
      </Transition>
    </div>
    <ProjectPreviewAnnotationMenu
      v-if="canAnnotate"
      ref="annotationMenu"
      :surfaces="highlights.surfaces.value"
      :read-cells="readAnnotationCells"
      :cell-rects="annotationCellRects"
      :container="rendererHost"
      :active="active"
      :full="annotationsFull"
      @save="saveAnnotation"
      @save-shape="saveShapeAnnotation"
      @draft-change="annotationDraft = $event"
      @shape-draft-change="shapeDraft = $event"
      @full="showAnnotationLimit"
    />
    <footer
      class="mt-auto flex min-h-12 shrink-0 flex-wrap items-center gap-x-4 gap-y-1 pl-5 pr-2 py-2 text-sm text-muted-foreground"
      :title="filePath"
      :aria-label="t('project.preview.metadata')"
    >
      <template v-if="preview">
        <span>{{ fileType }}</span>
        <span>{{ fileSize }}</span>
        <template v-if="preview.kind === 'text'">
          <span>{{ preview.encoding }}</span>
          <span v-if="contentMetadata?.rowCount === undefined">{{
            t("project.preview.lines", { count: lineCount })
          }}</span>
        </template>
        <span
          v-if="
            contentMetadata?.width !== undefined &&
            contentMetadata.height !== undefined
          "
          >{{ contentMetadata.width }} × {{ contentMetadata.height }}</span
        >
        <span v-if="duration">{{ duration }}</span>
        <span v-if="contentMetadata?.pageCount">{{
          t("project.preview.pages", { count: contentMetadata.pageCount })
        }}</span>
        <span v-if="contentMetadata?.rowCount !== undefined">{{
          t("project.preview.tableSize", {
            rows: contentMetadata.rowCount.toLocaleString(locale),
            columns: (contentMetadata.columnCount ?? 0).toLocaleString(locale),
          })
        }}</span>
      </template>
      <Skeleton v-else-if="!failed" class="h-3 w-40" />
      <div v-if="capabilities.invert" class="flex items-center gap-2">
        <Switch
          :id="invertSwitchId"
          size="sm"
          :model-value="previewInverted"
          @update:model-value="previewInverted = $event"
        />
        <Label :for="invertSwitchId">{{
          t("project.preview.invertColors")
        }}</Label>
      </div>
      <div v-if="capabilities.renderToggle" class="flex items-center gap-2">
        <Switch
          :id="renderSwitchId"
          size="sm"
          :model-value="rendered"
          @update:model-value="viewMode = $event ? 'rendered' : 'code'"
        />
        <Label :for="renderSwitchId">{{ t("project.preview.rendered") }}</Label>
      </div>
      <div class="ml-auto flex items-center gap-3">
        <Button
          v-if="canAnnotateRegions"
          data-action="comment-on-area"
          variant="ghost"
          size="sm"
          :aria-pressed="drawingRegion"
          :class="drawingRegion && 'bg-muted text-foreground'"
          @click="startDrawingRegion"
        >
          <SquareDashedMousePointer data-icon="inline-start" />
          {{ t("project.preview.annotations.commentOnArea") }}
        </Button>
        <Button
          v-if="projectTarget && (canAnnotate || annotations.length)"
          data-action="toggle-annotations"
          variant="ghost"
          size="sm"
          :aria-pressed="annotationsOpen"
          @click="annotationsOpen = !annotationsOpen"
        >
          <MessageSquareTextIcon data-icon="inline-start" />
          {{ t("project.preview.annotations.title") }}
          <Badge v-if="annotations.length" variant="secondary">{{
            annotations.length
          }}</Badge>
        </Button>
        <Button
          v-if="preview"
          data-action="open-default"
          variant="ghost"
          size="sm"
          @click="openWithDefaultApplication"
        >
          <Download v-if="isWeb" data-icon="inline-start" />
          <ExternalLink v-else data-icon="inline-start" />
          {{ t(isWeb ? "common.downloadFile" : "project.preview.openDefault") }}
        </Button>
        <DropdownMenu
          v-if="projectTarget"
          :open="menuOpen"
          @update:open="updateMenu"
        >
          <DropdownMenuTrigger as-child>
            <!-- With comments on the file, sending means sending them. -->
            <Button
              data-action="send-to-tab"
              :variant="annotations.length ? 'default' : 'outline'"
              :disabled="isSending"
              @pointerdown.prevent="updateSelection"
            >
              <Send data-icon="inline-start" />{{
                annotations.length
                  ? t("project.preview.annotations.sendToTab", {
                      count: annotations.length,
                    })
                  : t(
                      selectedRange
                        ? "project.preview.sendSelectionToTab"
                        : "project.preview.sendToTab",
                    )
              }}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="top"
            align="end"
            class="w-64"
            @close-auto-focus.prevent
          >
            <DropdownMenuGroup>
              <DropdownMenuItem
                v-for="tab in sessionTabs"
                :key="tab.id"
                @select="sendFromMenu(tab.id)"
              >
                <SquareTerminal />
                <span class="truncate">{{
                  "label" in tab && tab.label
                    ? tab.label
                    : t("project.contentTabs.newSession")
                }}</span>
              </DropdownMenuItem>
              <DropdownMenuItem v-if="!sessionTabs.length" disabled>{{
                t("project.preview.noSessionTabs")
              }}</DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem
                data-action="new-session"
                @select="sendFromMenu(null)"
              >
                <Plus />{{ t("project.preview.newSession") }}
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </footer>
  </section>
</template>
