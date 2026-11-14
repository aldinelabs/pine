<script setup lang="ts">
import { MessageSquareTextIcon } from "@lucide/vue";
import { useEventListener } from "@vueuse/core";
import {
  computed,
  nextTick,
  ref,
  shallowRef,
  useTemplateRef,
  watch,
} from "vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { rectInTopWindow } from "@/composables/usePreviewAnnotationHighlights";
import { annotationPosition } from "@/lib/annotationLocation";
import type {
  AnnotationCellSelection,
  AnnotationCells,
  AnnotationComposeRequest,
  AnnotationSurface,
} from "./file-preview/previewRenderer";

/**
 * Floats under text or cells selected in a preview and offers to comment on
 * them; the menu then becomes the comment box. A selection may lie in a
 * page's frame, so it is read from each surface's own document. Areas and
 * time spans skip the menu: their own controls open the box with `compose`.
 */
const props = defineProps<{
  surfaces: readonly AnnotationSurface[];
  /** The cells selected in a grid, when the renderer has one. */
  readCells?: () => AnnotationCellSelection | undefined;
  cellRects?: (cells: AnnotationCells) => readonly DOMRect[];
  /** Element the popover keeps within; the preview around the renderer. */
  container: HTMLElement | null;
  /** The preview is the visible tab. */
  active: boolean;
  /** No more comments fit on this file. */
  full: boolean;
}>();
const emit = defineEmits<{
  save: [range: Range, comment: string];
  saveShape: [request: AnnotationComposeRequest, comment: string];
  /** The passage being commented on, to show it marked while typing. */
  draftChange: [range: Range | undefined];
  /** The cells, area or time span being commented on. */
  shapeDraftChange: [request: AnnotationComposeRequest | undefined];
  full: [];
}>();
const { t } = useI18n();

type Candidate =
  | { kind: "text"; range: Range }
  | { kind: "shape"; request: AnnotationComposeRequest };

const MENU_GAP = 8;
const selection = shallowRef<Candidate>();
const editing = ref(false);
const comment = ref("");
const textarea = useTemplateRef<InstanceType<typeof Textarea>>("textarea");

function unionRect(rects: readonly DOMRect[]): DOMRect {
  const left = Math.min(...rects.map((rect) => rect.left));
  const top = Math.min(...rects.map((rect) => rect.top));
  const right = Math.max(...rects.map((rect) => rect.right));
  const bottom = Math.max(...rects.map((rect) => rect.bottom));
  return new DOMRect(left, top, right - left, bottom - top);
}

/** Follows the selection's last line, so the menu stays under it on scroll. */
const anchor = computed(() => {
  const candidate = selection.value;
  if (!candidate) return undefined;
  let bottom: () => DOMRect;
  if (candidate.kind === "shape") {
    bottom = candidate.request.rect;
  } else {
    const range = candidate.range;
    const document = range.startContainer.ownerDocument;
    if (!document) return undefined;
    bottom = () =>
      rectInTopWindow(
        [...range.getClientRects()].at(-1) ?? range.getBoundingClientRect(),
        document,
      );
  }
  return {
    getBoundingClientRect: bottom,
    getClientRects: () => [bottom()],
    contextElement: props.container ?? undefined,
  };
});

function readTextSelection(): Candidate | undefined {
  for (const document of new Set(
    props.surfaces.map((surface) => surface.root.ownerDocument),
  )) {
    const current = document.getSelection();
    if (!current || current.isCollapsed || !current.rangeCount) continue;
    const range = current.getRangeAt(0).cloneRange();
    // One passage lies in one surface: a page, a slide or a chapter. A
    // selection running on into the next page keeps the part on the first.
    const surface = props.surfaces.find((candidate) =>
      candidate.root.contains(range.startContainer),
    );
    if (!surface) continue;
    if (!surface.root.contains(range.endContainer))
      range.setEnd(surface.root, surface.root.childNodes.length);
    if (range.toString().trim()) return { kind: "text", range };
  }
  return undefined;
}

function readCellSelection(): Candidate | undefined {
  const cells = props.readCells?.();
  if (!cells?.text.trim()) return undefined;
  const sheet = cells.cells.sheet;
  return {
    kind: "shape",
    request: {
      shape: { kind: "cells", cells: cells.cells },
      text: cells.text,
      ...(sheet ? { place: { kind: "sheet" as const, name: sheet } } : {}),
      rect: () => {
        const rects = props.cellRects?.(cells.cells) ?? [];
        return rects.length
          ? unionRect(rects)
          : (props.container?.getBoundingClientRect() ?? new DOMRect());
      },
    },
  };
}

function readSelection(): Candidate | undefined {
  if (!props.active) return undefined;
  return readTextSelection() ?? readCellSelection();
}

function hide(): void {
  selection.value = undefined;
  editing.value = false;
  comment.value = "";
  emit("draftChange", undefined);
  emit("shapeDraftChange", undefined);
}

function update(): void {
  if (!editing.value) selection.value = readSelection();
}

function schedule(event?: Event): void {
  if (
    (event?.target as Element | null)?.closest?.(
      "[data-slot=preview-annotation-menu]",
    )
  )
    return;
  // The selection settles after the mouse or key event that changed it.
  requestAnimationFrame(update);
}

async function startEditing(candidate = selection.value ?? readSelection()) {
  if (!candidate) return;
  if (props.full) {
    emit("full");
    return;
  }
  selection.value = candidate;
  editing.value = true;
  if (candidate.kind === "text") {
    emit("draftChange", candidate.range);
    candidate.range.startContainer.ownerDocument
      ?.getSelection()
      ?.removeAllRanges();
  } else {
    emit("shapeDraftChange", candidate.request);
  }
  await nextTick();
  (textarea.value?.$el as HTMLTextAreaElement | undefined)?.focus();
}

/** Opens the comment box for cells, an area or a time span. */
function compose(request: AnnotationComposeRequest): void {
  void startEditing({ kind: "shape", request });
}

defineExpose({ compose });

/** What a comment on cells, an area or a time span is about, over the box. */
const shapeLabel = computed(() => {
  const candidate = selection.value;
  if (candidate?.kind !== "shape") return undefined;
  const { shape, place } = candidate.request;
  return annotationPosition({ anchor: shape, place }, t);
});

function save(): void {
  const candidate = selection.value;
  const text = comment.value.trim();
  if (!candidate || !text) return;
  if (candidate.kind === "text") emit("save", candidate.range, text);
  else emit("saveShape", candidate.request, text);
  hide();
}

function handleKey(event: KeyboardEvent): void {
  if (
    (event.metaKey || event.ctrlKey) &&
    event.altKey &&
    event.code === "KeyM" &&
    !editing.value &&
    readSelection()
  ) {
    event.preventDefault();
    void startEditing();
  }
}

function handleEditorKey(event: KeyboardEvent): void {
  // Enter saves and Shift+Enter starts a new line; Enter that confirms an
  // input method's composition belongs to the input method.
  if (
    event.key === "Enter" &&
    !event.shiftKey &&
    !event.isComposing &&
    event.keyCode !== 229
  ) {
    event.preventDefault();
    save();
  } else if (event.key === "Escape") {
    event.preventDefault();
    hide();
  }
}

/** A typed comment survives a stray click outside; an empty box closes. */
function handleInteractOutside(event: Event): void {
  if (editing.value && comment.value.trim()) event.preventDefault();
}

function handleKeyUp(event: KeyboardEvent): void {
  if (event.shiftKey || event.key === "Shift" || event.key === "a")
    schedule(event);
}

function handleSelectionChange(event: Event): void {
  const candidate = selection.value;
  if (
    candidate?.kind === "text" &&
    !editing.value &&
    (event.target as Document).getSelection()?.isCollapsed
  )
    selection.value = undefined;
}

// Frames' documents get their own listeners; the app's document covers the
// rest, including grids.
const documents = computed(() => [
  ...new Set([
    document,
    ...props.surfaces.map((surface) => surface.root.ownerDocument),
  ]),
]);
watch(
  documents,
  (next, _previous, onCleanup) => {
    for (const target of next) {
      target.addEventListener("mouseup", schedule);
      target.addEventListener("keyup", handleKeyUp);
      target.addEventListener("keydown", handleKey);
      target.addEventListener("selectionchange", handleSelectionChange);
    }
    onCleanup(() => {
      for (const target of next) {
        target.removeEventListener("mouseup", schedule);
        target.removeEventListener("keyup", handleKeyUp);
        target.removeEventListener("keydown", handleKey);
        target.removeEventListener("selectionchange", handleSelectionChange);
      }
    });
  },
  { immediate: true },
);
useEventListener(window, "resize", () => {
  if (!editing.value) hide();
});
watch(
  () => props.active,
  (active) => {
    if (!active) hide();
  },
);
// A re-render replaces the text a selection was in; a page scrolled into
// view only adds a surface, and keeps the box being typed in.
watch(
  () => props.surfaces,
  (surfaces) => {
    const candidate = selection.value;
    if (
      candidate?.kind === "text" &&
      !surfaces.some((surface) =>
        surface.root.contains(candidate.range.commonAncestorContainer),
      )
    )
      hide();
  },
);
</script>

<template>
  <Popover :open="Boolean(anchor)" @update:open="(open) => !open && hide()">
    <PopoverAnchor v-if="anchor" :reference="anchor" />
    <!-- The comment box replaces the menu as a popover of its own, with the
         popover's own entrance, rather than growing out of the menu. -->
    <PopoverContent
      :key="editing ? 'editor' : 'menu'"
      data-slot="preview-annotation-menu"
      side="bottom"
      align="start"
      :side-offset="MENU_GAP"
      :aria-label="t('project.preview.annotations.comment')"
      :class="
        editing ? 'w-80 gap-2 p-2' : 'w-auto flex-row items-center gap-0.5 p-1'
      "
      @open-auto-focus.prevent
      @close-auto-focus.prevent
      @interact-outside="handleInteractOutside"
      @mousedown="!editing && $event.preventDefault()"
    >
      <template v-if="editing">
        <p
          v-if="shapeLabel"
          class="truncate px-1 text-xs text-muted-foreground tabular-nums"
        >
          {{ shapeLabel }}
        </p>
        <Textarea
          ref="textarea"
          v-model="comment"
          rows="3"
          class="max-h-48 min-h-16 resize-none text-sm"
          :placeholder="t('project.preview.annotations.placeholder')"
          @keydown="handleEditorKey"
        />
        <div class="flex justify-end gap-1.5">
          <Button type="button" variant="ghost" size="sm" @click="hide">
            {{ t("project.preview.annotations.cancel") }}
          </Button>
          <Button
            type="button"
            size="sm"
            :disabled="!comment.trim()"
            @click="save"
          >
            {{ t("project.preview.annotations.comment") }}
          </Button>
        </div>
      </template>
      <Button
        v-else
        type="button"
        variant="ghost"
        size="sm"
        class="font-normal"
        @click="startEditing()"
      >
        <MessageSquareTextIcon />
        {{ t("project.preview.annotations.comment") }}
      </Button>
    </PopoverContent>
  </Popover>
</template>
