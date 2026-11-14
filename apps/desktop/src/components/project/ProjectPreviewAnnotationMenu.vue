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
import type { AnnotationSurface } from "./file-preview/previewRenderer";

/**
 * Floats under text selected in a preview and offers to comment on it; the
 * menu then becomes the comment box. The selection may lie in a page's frame,
 * so it is read from the surface's own document.
 */
const props = defineProps<{
  surface: AnnotationSurface | undefined;
  /** Element the popover keeps within; the preview around the renderer. */
  container: HTMLElement | null;
  /** The preview is the visible tab. */
  active: boolean;
  /** No more comments fit on this file. */
  full: boolean;
}>();
const emit = defineEmits<{
  save: [range: Range, comment: string];
  /** The passage being commented on, to show it marked while typing. */
  draftChange: [range: Range | undefined];
  full: [];
}>();
const { t } = useI18n();

const MENU_GAP = 8;
const selection = shallowRef<Range>();
const editing = ref(false);
const comment = ref("");
const textarea = useTemplateRef<InstanceType<typeof Textarea>>("textarea");

/** Follows the selection's last line, so the menu stays under it on scroll. */
const anchor = computed(() => {
  const range = selection.value;
  if (!range) return undefined;
  const document = range.startContainer.ownerDocument;
  if (!document) return undefined;
  const lastLine = () =>
    rectInTopWindow(
      [...range.getClientRects()].at(-1) ?? range.getBoundingClientRect(),
      document,
    );
  return {
    getBoundingClientRect: lastLine,
    getClientRects: () => [lastLine()],
    contextElement: props.container ?? undefined,
  };
});

function readSelection(): Range | undefined {
  const root = props.surface?.root;
  if (!root || !props.active) return undefined;
  const current = root.ownerDocument.getSelection();
  if (!current || current.isCollapsed || !current.rangeCount) return undefined;
  const range = current.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer) || !range.toString().trim())
    return undefined;
  return range.cloneRange();
}

function hide(): void {
  selection.value = undefined;
  editing.value = false;
  comment.value = "";
  emit("draftChange", undefined);
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

async function startEditing(): Promise<void> {
  const range = selection.value ?? readSelection();
  if (!range) return;
  if (props.full) {
    emit("full");
    return;
  }
  selection.value = range;
  editing.value = true;
  emit("draftChange", range);
  range.startContainer.ownerDocument?.getSelection()?.removeAllRanges();
  await nextTick();
  (textarea.value?.$el as HTMLTextAreaElement | undefined)?.focus();
}

function save(): void {
  const range = selection.value;
  const text = comment.value.trim();
  if (!range || !text) return;
  emit("save", range, text);
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

const surfaceDocument = computed(
  () => props.surface?.root.ownerDocument ?? null,
);
// A frame's document gets its own listeners; the app's document covers the rest.
const frameDocument = computed(() =>
  surfaceDocument.value && surfaceDocument.value !== document
    ? surfaceDocument.value
    : null,
);
for (const target of [() => document, () => frameDocument.value]) {
  useEventListener(target, "mouseup", schedule);
  useEventListener(target, "keyup", (event: KeyboardEvent) => {
    if (event.shiftKey || event.key === "Shift" || event.key === "a")
      schedule(event);
  });
  useEventListener(target, "keydown", handleKey);
}
useEventListener(surfaceDocument, "selectionchange", () => {
  if (
    selection.value &&
    !editing.value &&
    surfaceDocument.value?.getSelection()?.isCollapsed
  )
    selection.value = undefined;
});
useEventListener(window, "resize", () => {
  if (!editing.value) hide();
});
watch(
  () => [props.surface?.root, props.active] as const,
  () => hide(),
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
        @click="startEditing"
      >
        <MessageSquareTextIcon />
        {{ t("project.preview.annotations.comment") }}
      </Button>
    </PopoverContent>
  </Popover>
</template>
