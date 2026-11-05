<script setup lang="ts">
import { MessagesSquareIcon, TextQuoteIcon } from "@lucide/vue";
import { useEventListener } from "@vueuse/core";
import { computed, ref, shallowRef } from "vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  transcriptSelection,
  type TranscriptSelection,
} from "@/lib/transcriptSelection";

/**
 * Floats above text selected in the transcript and offers what can be done
 * with it: quote it into the composer, or ask about it in a side chat.
 */
const props = defineProps<{
  /** The transcript content the selection must lie in. */
  container: HTMLElement | null;
  /** Shows the follow-up action; absent where side chats are unavailable. */
  followUpAvailability?: (selection: TranscriptSelection) => {
    enabled: boolean;
    reason?: string;
  };
}>();
const emit = defineEmits<{
  quote: [selection: TranscriptSelection];
  followUp: [selection: TranscriptSelection];
}>();
const { t } = useI18n();

const MENU_GAP = 8;
const selection = shallowRef<TranscriptSelection>();
const position = ref({ x: 0, y: 0, below: false });
const menu = ref<HTMLElement | null>(null);
const followUpState = computed(() =>
  selection.value && props.followUpAvailability
    ? props.followUpAvailability(selection.value)
    : undefined,
);

function hide(): void {
  selection.value = undefined;
}

function update(): void {
  const container = props.container;
  const next = container
    ? transcriptSelection(window.getSelection(), container)
    : undefined;
  selection.value = next;
  if (!next) return;
  const rects = [...next.range.getClientRects()];
  const first = rects[0] ?? next.range.getBoundingClientRect();
  const bounds = next.range.getBoundingClientRect();
  // Above the selection's first line; below it when that would leave the
  // window.
  const below = first.top < 56;
  position.value = {
    x: Math.min(
      Math.max(first.left + Math.min(first.width, bounds.width) / 2, 80),
      window.innerWidth - 80,
    ),
    y: below ? bounds.bottom + MENU_GAP : first.top - MENU_GAP,
    below,
  };
}

function schedule(): void {
  // The selection settles after the mouse or key event that changed it.
  requestAnimationFrame(update);
}

useEventListener(document, "mouseup", (event: MouseEvent) => {
  if (menu.value?.contains(event.target as Node)) return;
  schedule();
});
useEventListener(document, "keyup", (event: KeyboardEvent) => {
  if (event.shiftKey || event.key === "Shift" || event.key === "a") schedule();
});
useEventListener(document, "selectionchange", () => {
  if (selection.value && window.getSelection()?.isCollapsed) hide();
});
useEventListener(document, "keydown", (event: KeyboardEvent) => {
  if (event.key === "Escape" && selection.value) hide();
});
useEventListener(window, "resize", hide);
useEventListener(
  () => props.container,
  "scroll",
  () => selection.value && schedule(),
  { capture: true, passive: true },
);

function quote(): void {
  if (!selection.value) return;
  emit("quote", selection.value);
  window.getSelection()?.removeAllRanges();
  hide();
}

function startFollowUp(): void {
  if (!selection.value || !followUpState.value?.enabled) return;
  emit("followUp", selection.value);
  window.getSelection()?.removeAllRanges();
  hide();
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="selection"
      ref="menu"
      data-slot="transcript-selection-menu"
      role="toolbar"
      :aria-label="t('project.selection.label')"
      class="fixed z-50 flex -translate-x-1/2 items-center gap-0.5 rounded-lg border bg-popover p-0.5 text-popover-foreground shadow-md"
      :class="position.below ? '' : '-translate-y-full'"
      :style="{ left: `${position.x}px`, top: `${position.y}px` }"
      @mousedown.prevent
    >
      <Button type="button" variant="ghost" size="sm" @click="quote">
        <TextQuoteIcon />
        {{ t("project.selection.quote") }}
      </Button>
      <template v-if="followUpState">
        <Tooltip v-if="!followUpState.enabled && followUpState.reason">
          <TooltipTrigger as-child>
            <span tabindex="0">
              <Button type="button" variant="ghost" size="sm" disabled>
                <MessagesSquareIcon />
                {{ t("project.selection.followUp") }}
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>{{ followUpState.reason }}</TooltipContent>
        </Tooltip>
        <Button
          v-else
          type="button"
          variant="ghost"
          size="sm"
          :disabled="!followUpState.enabled"
          @click="startFollowUp"
        >
          <MessagesSquareIcon />
          {{ t("project.selection.followUp") }}
        </Button>
      </template>
    </div>
  </Teleport>
</template>
