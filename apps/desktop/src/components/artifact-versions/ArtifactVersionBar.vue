<script setup lang="ts">
import { GitCompareIcon, RotateCcwIcon, XIcon } from "@lucide/vue";
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { toast } from "vue-sonner";
import { handleError } from "@/app/errors/errorHandler";
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
import { useProjectFileChanges } from "@/composables/useProjectFileChanges";
import { useArtifactVersionStore } from "@/stores/artifactVersions";
import { versionTimeFormat } from "./versionFormat";

/**
 * Shown above a preview while it shows a kept version: which version it is,
 * and Compare with current, Restore and Back to current.
 */
const props = defineProps<{
  viewKey: string;
  /** The file's name, for the restore confirmation. */
  name: string;
  /** Narrow layout: icon buttons only. */
  compact?: boolean;
}>();

const { t, locale } = useI18n();
const versions = useArtifactVersionStore();
const { emitProjectFilesChanged } = useProjectFileChanges();
const view = computed(() => versions.viewOf(props.viewKey));
const time = computed(() => versionTimeFormat(locale.value));
const confirming = ref(false);

const canRestore = computed(
  () => !!view.value?.history?.restorable && !view.value.viewing?.current,
);

async function toggleCompare(): Promise<void> {
  try {
    await versions.setComparing(props.viewKey, !view.value?.comparing);
  } catch (error) {
    handleError(error, {
      id: "artifact-versions.compare",
      title: t("project.workbench.artifacts.versions.compareFailed"),
    });
  }
}

async function restore(): Promise<void> {
  try {
    await versions.restore(props.viewKey);
    confirming.value = false;
    toast.success(t("project.workbench.artifacts.versions.restored"), {
      description: props.name,
    });
    emitProjectFilesChanged();
  } catch (error) {
    handleError(error, {
      id: "artifact-versions.restore",
      title: t("project.workbench.artifacts.versions.restoreFailed"),
    });
  }
}
</script>

<template>
  <div
    v-if="view?.viewing"
    data-testid="artifact-version-bar"
    role="status"
    class="sticky top-0 z-10 flex min-h-10 shrink-0 items-center gap-1 border-b bg-muted px-3 py-1 text-sm"
  >
    <span class="min-w-0 flex-1 truncate text-muted-foreground">
      {{
        t("project.workbench.artifacts.versions.viewing", {
          time: time.format(view.viewing.time),
        })
      }}
    </span>
    <Button
      data-testid="artifact-version-compare"
      variant="ghost"
      :size="compact ? 'icon-sm' : 'sm'"
      :aria-pressed="view.comparing"
      :class="view.comparing && 'bg-background text-foreground'"
      :disabled="view.history?.missing"
      :aria-label="t('project.workbench.artifacts.versions.compare')"
      :title="t('project.workbench.artifacts.versions.compare')"
      @click="toggleCompare"
    >
      <GitCompareIcon :data-icon="compact ? undefined : 'inline-start'" />
      <template v-if="!compact">
        {{ t("project.workbench.artifacts.versions.compare") }}
      </template>
    </Button>
    <Button
      data-testid="artifact-version-restore"
      variant="ghost"
      :size="compact ? 'icon-sm' : 'sm'"
      :disabled="!canRestore || view.busy"
      :aria-label="t('project.workbench.artifacts.versions.restore')"
      :title="
        view.history && !view.history.restorable
          ? t('project.workbench.artifacts.versions.readOnly')
          : t('project.workbench.artifacts.versions.restore')
      "
      @click="confirming = true"
    >
      <RotateCcwIcon :data-icon="compact ? undefined : 'inline-start'" />
      <template v-if="!compact">
        {{ t("project.workbench.artifacts.versions.restore") }}
      </template>
    </Button>
    <!-- The X glyph sits further inside its box than the icons before it;
         pulling the button in keeps the gaps between glyphs even. -->
    <Button
      data-testid="artifact-version-back"
      variant="ghost"
      size="icon-sm"
      class="-ml-0.5"
      :aria-label="t('project.workbench.artifacts.versions.backToCurrent')"
      :title="t('project.workbench.artifacts.versions.backToCurrent')"
      @click="versions.showCurrent(viewKey)"
    >
      <XIcon />
    </Button>
  </div>

  <AlertDialog
    :open="confirming"
    @update:open="
      (value) => {
        if (!value && !view?.busy) confirming = false;
      }
    "
  >
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{{
          t("project.workbench.artifacts.versions.restoreTitle")
        }}</AlertDialogTitle>
        <AlertDialogDescription>
          {{
            t("project.workbench.artifacts.versions.restoreDescription", {
              name,
              time: view?.viewing ? time.format(view.viewing.time) : "",
            })
          }}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel :disabled="view?.busy">{{
          t("common.cancel")
        }}</AlertDialogCancel>
        <Button
          data-testid="artifact-version-restore-confirm"
          :disabled="view?.busy"
          @click="restore"
        >
          {{ t("project.workbench.artifacts.versions.restore") }}
        </Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
