<script setup lang="ts">
import { Trash2Icon } from "@lucide/vue";
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
import { useLiveContextTarget } from "@/composables/useLiveContextTarget";
import { useLiveContextStore } from "@/stores/liveContext";

/**
 * Deletes the conversation's Live Context, from the card's header as the
 * side chat card deletes its chat: only once there is a transcript, and
 * after a confirmation. A capture into it stops first.
 */
const { t } = useI18n();
const liveContext = useLiveContextStore();
const target = useLiveContextTarget();
const isConfirming = ref(false);
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

async function remove(): Promise<void> {
  const current = target.value;
  isConfirming.value = false;
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
  <Button
    v-if="hasTranscript"
    variant="ghost"
    size="icon"
    data-testid="live-context-delete"
    :disabled="isDeleting"
    :aria-label="t('project.workbench.liveContext.delete.action')"
    :title="t('project.workbench.liveContext.delete.action')"
    @click="isConfirming = true"
  >
    <Trash2Icon aria-hidden="true" />
  </Button>
  <AlertDialog v-model:open="isConfirming">
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
