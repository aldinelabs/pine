<script setup lang="ts">
import { EllipsisIcon, Trash2Icon, UsersRoundIcon } from "@lucide/vue";
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { errorReason, handleError } from "@/app/errors/errorHandler";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
} from "@/components/ui/popover";
import LiveContextSpeakersList from "@/components/workbench/LiveContextSpeakersList.vue";
import { useLiveContextSpeakers } from "@/composables/useLiveContextSpeakers";
import { useLiveContextTarget } from "@/composables/useLiveContextTarget";
import { useLiveContextStore } from "@/stores/liveContext";

/**
 * The Live Context card's header menu, once the conversation has a
 * transcript: Speakers (every speaker, to rename or merge, in a popover
 * under the menu button) and Delete live context (after a confirmation;
 * a capture into the conversation stops first).
 */
const { t } = useI18n();
const liveContext = useLiveContextStore();
const target = useLiveContextTarget();
const { rows } = useLiveContextSpeakers();

const isManagingSpeakers = ref(false);
const isConfirmingDelete = ref(false);
const isDeleting = ref(false);

const hasTranscript = computed(
  () =>
    target.value !== undefined &&
    liveContext.segmentsOf(target.value.sessionId).length > 0,
);
const capturingHere = computed(
  () =>
    liveContext.isCapturing &&
    liveContext.status.sessionId === target.value?.sessionId,
);

let openingSpeakers = false;
function showSpeakers(): void {
  openingSpeakers = true;
  // After the menu has closed, so its closing does not dismiss the popover.
  setTimeout(() => (isManagingSpeakers.value = true), 0);
}

/** The popover takes focus from the closing menu, not its button. */
function onMenuCloseAutoFocus(event: Event): void {
  if (!openingSpeakers) return;
  openingSpeakers = false;
  event.preventDefault();
}

async function remove(): Promise<void> {
  const current = target.value;
  isConfirmingDelete.value = false;
  if (!current || isDeleting.value) return;
  isDeleting.value = true;
  try {
    await liveContext.deleteTranscript(current);
  } catch (error) {
    handleError(error, {
      id: "live-context.delete",
      title: t("project.workbench.liveContext.delete.failed"),
      description: errorReason(error),
    });
  } finally {
    isDeleting.value = false;
  }
}
</script>

<template>
  <Popover v-if="hasTranscript" v-model:open="isManagingSpeakers">
    <!-- Outside the menu: inside it, the anchor would place the menu, not
         the popover, which then stays off-screen. -->
    <PopoverAnchor as="span" class="inline-flex shrink-0">
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button
            variant="ghost"
            size="icon"
            data-testid="live-context-menu"
            :disabled="isDeleting"
            :aria-label="t('project.workbench.liveContext.menu')"
            :title="t('project.workbench.liveContext.menu')"
          >
            <EllipsisIcon aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          @close-auto-focus="onMenuCloseAutoFocus"
        >
          <DropdownMenuItem
            v-if="rows.length"
            data-testid="live-context-speakers"
            @select="showSpeakers"
          >
            <UsersRoundIcon aria-hidden="true" />
            {{ t("project.workbench.liveContext.speakers.manage") }}
          </DropdownMenuItem>
          <DropdownMenuSeparator v-if="rows.length" />
          <DropdownMenuItem
            variant="destructive"
            data-testid="live-context-delete"
            @select="isConfirmingDelete = true"
          >
            <Trash2Icon aria-hidden="true" />
            {{ t("project.workbench.liveContext.delete.action") }}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </PopoverAnchor>
    <PopoverContent
      align="end"
      class="w-72 gap-2 p-2"
      data-testid="live-context-speakers-popover"
      @open-auto-focus.prevent
    >
      <PopoverHeader class="px-2 pt-1">
        <PopoverTitle class="text-sm">
          {{ t("project.workbench.liveContext.speakers.title") }}
        </PopoverTitle>
      </PopoverHeader>
      <LiveContextSpeakersList />
    </PopoverContent>
  </Popover>
  <AlertDialog v-model:open="isConfirmingDelete">
    <AlertDialogContent data-testid="live-context-delete-dialog">
      <AlertDialogHeader>
        <AlertDialogTitle>
          {{ t("project.workbench.liveContext.delete.title") }}
        </AlertDialogTitle>
        <AlertDialogDescription>
          {{ t("project.workbench.liveContext.delete.description") }}
          <template v-if="capturingHere">
            {{ t("project.workbench.liveContext.delete.stopsCapture") }}
          </template>
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>{{ t("common.cancel") }}</AlertDialogCancel>
        <Button
          variant="destructive"
          data-testid="live-context-delete-confirm"
          @click="remove"
        >
          {{ t("project.workbench.liveContext.delete.confirm") }}
        </Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
