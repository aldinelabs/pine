<script setup lang="ts">
import {
  MessageCircleQuestionMarkIcon,
  MessageSquareQuoteIcon,
} from "@lucide/vue";
import { useEventListener } from "@vueuse/core";
import { computed, shallowRef } from "vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
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
const followUpState = computed(() =>
  selection.value && props.followUpAvailability
    ? props.followUpAvailability(selection.value)
    : undefined,
);

/**
 * The selection's last line, read live so the popover opens below it and
 * follows the text as the transcript scrolls.
 */
const anchor = computed(() => {
  const range = selection.value?.range;
  if (!range) return undefined;
  const lastLine = () =>
    [...range.getClientRects()].at(-1) ?? range.getBoundingClientRect();
  return {
    getBoundingClientRect: lastLine,
    getClientRects: () => [lastLine()],
    contextElement: props.container ?? undefined,
  };
});

function hide(): void {
  selection.value = undefined;
}

function update(): void {
  const container = props.container;
  selection.value = container
    ? transcriptSelection(window.getSelection(), container)
    : undefined;
}

function schedule(): void {
  // The selection settles after the mouse or key event that changed it.
  requestAnimationFrame(update);
}

useEventListener(document, "mouseup", (event: MouseEvent) => {
  if (
    (event.target as Element | null)?.closest?.(
      "[data-slot=transcript-selection-menu]",
    )
  )
    return;
  schedule();
});
useEventListener(document, "keyup", (event: KeyboardEvent) => {
  if (event.shiftKey || event.key === "Shift" || event.key === "a") schedule();
});
useEventListener(document, "selectionchange", () => {
  if (selection.value && window.getSelection()?.isCollapsed) hide();
});
useEventListener(window, "resize", hide);

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
  <Popover :open="Boolean(anchor)" @update:open="(open) => !open && hide()">
    <PopoverAnchor v-if="anchor" :reference="anchor" />
    <PopoverContent
      data-slot="transcript-selection-menu"
      side="bottom"
      :side-offset="MENU_GAP"
      :aria-label="t('project.selection.label')"
      class="w-auto flex-row items-center gap-0.5 p-1"
      @open-auto-focus.prevent
      @close-auto-focus.prevent
      @mousedown.prevent
    >
      <Button
        type="button"
        variant="ghost"
        size="sm"
        class="font-normal"
        @click="quote"
      >
        <MessageSquareQuoteIcon />
        {{ t("project.selection.quote") }}
      </Button>
      <template v-if="followUpState">
        <Tooltip v-if="!followUpState.enabled && followUpState.reason">
          <TooltipTrigger as-child>
            <span tabindex="0">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                class="font-normal"
                disabled
              >
                <MessageCircleQuestionMarkIcon />
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
          class="font-normal"
          :disabled="!followUpState.enabled"
          @click="startFollowUp"
        >
          <MessageCircleQuestionMarkIcon />
          {{ t("project.selection.followUp") }}
        </Button>
      </template>
    </PopoverContent>
  </Popover>
</template>
