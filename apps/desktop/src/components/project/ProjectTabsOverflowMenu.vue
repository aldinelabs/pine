<script setup lang="ts">
import {
  CopyIcon,
  DownloadIcon,
  EllipsisIcon,
  ExternalLinkIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  PencilIcon,
  RefreshCwIcon,
  Trash2Icon,
} from "@lucide/vue";
import { storeToRefs } from "pinia";
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { isValidProjectEntryName } from "@/shared/fileNames";
import { handleError } from "@/app/errors/errorHandler";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import SessionDeleteDialog from "@/components/sessions/SessionDeleteDialog.vue";
import SessionRenameDialog from "@/components/sessions/SessionRenameDialog.vue";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useContentTabNavigation } from "@/composables/useContentTabNavigation";
import { useProjectFileChanges } from "@/composables/useProjectFileChanges";
import { useSessionExport } from "@/composables/useSessionExport";
import { fileTargetPath } from "@/lib/filePreviewTarget";
import type { ProjectFileOperation } from "@/shared/projectFiles";
import type { PineSessionSummary } from "@/shared/sessions";
import { useProjectStore } from "@/stores/project";
import { useSessionStore } from "@/stores/session";

const { t } = useI18n();
const tabNavigation = useContentTabNavigation();
const { activeTab } = tabNavigation;
const sessionStore = useSessionStore();
const projectStore = useProjectStore();
const { activeProject } = storeToRefs(projectStore);
const { emitProjectFilesChanged } = useProjectFileChanges();
const { exportSession } = useSessionExport();

// Shortcuts for the active tab's context menu: session actions target the
// active session tab, file actions target the active file tab, and tree-wide
// actions fall back to the project's default folder. The menu shows only the
// group matching the active tab's kind.
const isActiveSession = computed(() => activeTab.value?.kind === "session");
const activeSessionTab = computed(() =>
  activeTab.value?.kind === "session" && activeTab.value.state === "bound"
    ? activeTab.value
    : null,
);
const targetSession = computed<PineSessionSummary | null>(() => {
  const tab = activeSessionTab.value;
  if (!tab) return null;
  return (
    sessionStore
      .recentSessionsFor(tab.projectId)
      .find((session) => session.id === tab.sessionId) ??
    (sessionStore.activeSession?.id === tab.sessionId
      ? sessionStore.activeSession
      : null)
  );
});

const activeFileTab = computed(() =>
  activeTab.value?.kind === "file" ? activeTab.value : null,
);
// Project-entry actions only apply to files inside the project. A presented
// file lives outside every folder, so the whole menu group is unavailable.
const fileTarget = computed(() =>
  activeFileTab.value?.source === "project"
    ? {
        folderId: activeFileTab.value.folderId,
        projectId: activeFileTab.value.projectId,
        relativePath: activeFileTab.value.relativePath,
      }
    : null,
);
const fileTabName = computed(() =>
  activeFileTab.value ? fileTargetPath(activeFileTab.value) : "",
);

const isSessionRenameOpen = ref(false);
const isSessionDeleteOpen = ref(false);

type FileDialogMode = "newFolder" | "rename";
const fileDialog = ref<FileDialogMode | null>(null);
const entryName = ref("");
const isTrashConfirmOpen = ref(false);
const validName = computed(
  () =>
    entryName.value.trim().length > 0 &&
    isValidProjectEntryName(entryName.value, window.pine.platform),
);

function requestSessionRename(): void {
  if (!targetSession.value) return;
  isSessionRenameOpen.value = true;
}

function requestSessionDelete(): void {
  if (!targetSession.value) return;
  isSessionDeleteOpen.value = true;
}

async function operateProjectFile(
  operation: ProjectFileOperation,
): Promise<boolean> {
  try {
    await window.pine.operateProjectFile(operation);
    return true;
  } catch (error) {
    handleError(error, {
      id: "project.files.menu",
      title: t("project.files.operationFailed"),
    });
    return false;
  }
}

function runFileOperation(
  action: "open" | "reveal" | "copy-path",
): Promise<void> {
  const target = fileTarget.value;
  if (!target) return Promise.resolve();
  return operateProjectFile({ action, target }).then(() => undefined);
}

function requestNewFolder(): void {
  if (!activeProject.value) return;
  entryName.value = "";
  fileDialog.value = "newFolder";
}

function requestFileRename(): void {
  if (!activeFileTab.value) return;
  entryName.value = activeFileTab.value.label;
  fileDialog.value = "rename";
}

function refreshFileTree(): void {
  emitProjectFilesChanged();
}

async function submitFileDialog(): Promise<void> {
  const mode = fileDialog.value;
  const name = entryName.value.trim();
  if (!mode || !validName.value) return;

  let succeeded = false;
  if (mode === "rename") {
    const target = fileTarget.value;
    const tabId = activeFileTab.value?.id;
    if (!target || !tabId) return;
    succeeded = await operateProjectFile({
      action: "rename",
      target,
      name,
    });
    // The tab is keyed by path, so a renamed file needs a fresh preview.
    if (succeeded) tabNavigation.close(tabId);
  } else {
    const project = activeProject.value;
    if (!project) return;
    succeeded = await operateProjectFile({
      action: "create",
      target: {
        folderId: project.defaultFolderId,
        projectId: project.id,
        relativePath: "",
      },
      name,
      kind: "directory",
    });
  }

  if (succeeded) {
    fileDialog.value = null;
    refreshFileTree();
  }
}

async function trashActiveFile(): Promise<void> {
  const target = fileTarget.value;
  const tabId = activeFileTab.value?.id;
  if (!target || !tabId) return;
  const succeeded = await operateProjectFile({ action: "trash", target });
  if (succeeded) {
    isTrashConfirmOpen.value = false;
    tabNavigation.close(tabId);
    refreshFileTree();
  }
}
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <Button
        class="window-no-drag pointer-events-auto"
        variant="ghost"
        size="icon-sm"
        :aria-label="t('project.contentTabs.moreActions')"
        :title="t('project.contentTabs.moreActions')"
      >
        <EllipsisIcon />
      </Button>
    </DropdownMenuTrigger>

    <DropdownMenuContent align="end" class="w-56">
      <DropdownMenuGroup v-if="activeFileTab">
        <DropdownMenuItem
          :disabled="!fileTarget"
          @select="runFileOperation('open')"
        >
          <ExternalLinkIcon aria-hidden="true" />
          {{ t("project.files.open") }}
        </DropdownMenuItem>
        <DropdownMenuItem
          :disabled="!fileTarget"
          @select="runFileOperation('reveal')"
        >
          <FolderOpenIcon aria-hidden="true" />
          {{ t("project.files.reveal") }}
        </DropdownMenuItem>
        <DropdownMenuItem
          :disabled="!fileTarget"
          @select="runFileOperation('copy-path')"
        >
          <CopyIcon aria-hidden="true" />
          {{ t("project.files.copyPath") }}
        </DropdownMenuItem>
        <DropdownMenuItem :disabled="!activeProject" @select="requestNewFolder">
          <FolderPlusIcon aria-hidden="true" />
          {{ t("project.files.newFolder") }}
        </DropdownMenuItem>
        <DropdownMenuItem :disabled="!fileTarget" @select="requestFileRename">
          <PencilIcon aria-hidden="true" />
          {{ t("project.files.rename") }}
        </DropdownMenuItem>
        <DropdownMenuItem @select="refreshFileTree">
          <RefreshCwIcon aria-hidden="true" />
          {{ t("project.files.refresh") }}
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          :disabled="!fileTarget"
          @select="isTrashConfirmOpen = true"
        >
          <Trash2Icon aria-hidden="true" />
          {{ t("project.files.trash") }}
        </DropdownMenuItem>
      </DropdownMenuGroup>

      <DropdownMenuGroup v-else-if="isActiveSession">
        <DropdownMenuItem
          :disabled="!targetSession"
          @select="requestSessionRename"
        >
          <PencilIcon aria-hidden="true" />
          {{ t("sessions.renameAction") }}
        </DropdownMenuItem>
        <DropdownMenuItem
          :disabled="!targetSession"
          @select="targetSession && exportSession(targetSession.id)"
        >
          <DownloadIcon aria-hidden="true" />
          {{ t("sessions.exportAction") }}
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          :disabled="!targetSession"
          @select="requestSessionDelete"
        >
          <Trash2Icon aria-hidden="true" />
          {{ t("sessions.deleteAction") }}
        </DropdownMenuItem>
      </DropdownMenuGroup>
    </DropdownMenuContent>
  </DropdownMenu>

  <SessionRenameDialog
    v-model:open="isSessionRenameOpen"
    :session="targetSession"
  />
  <SessionDeleteDialog
    v-model:open="isSessionDeleteOpen"
    :session="targetSession"
  />

  <Dialog
    :open="fileDialog !== null"
    @update:open="
      (value) => {
        if (!value) fileDialog = null;
      }
    "
  >
    <DialogContent>
      <form class="flex flex-col gap-4" @submit.prevent="submitFileDialog">
        <DialogHeader>
          <DialogTitle>{{
            fileDialog ? t(`project.files.${fileDialog}`) : ""
          }}</DialogTitle>
          <DialogDescription>
            {{ t("project.files.nameDescription") }}
          </DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel for="content-tabs-entry-name">
            {{ t("project.files.name") }}
          </FieldLabel>
          <Input
            id="content-tabs-entry-name"
            v-model="entryName"
            autocomplete="off"
          />
        </Field>
        <DialogFooter>
          <Button type="button" variant="outline" @click="fileDialog = null">
            {{ t("common.cancel") }}
          </Button>
          <Button type="submit" :disabled="!validName">
            {{ t("common.save") }}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>

  <AlertDialog v-model:open="isTrashConfirmOpen">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{{ t("project.files.trash") }}</AlertDialogTitle>
        <AlertDialogDescription>
          {{ t("project.files.trashDescription", { name: fileTabName }) }}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>{{ t("common.cancel") }}</AlertDialogCancel>
        <AlertDialogAction variant="destructive" @click="trashActiveFile">
          {{ t("project.files.trash") }}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
