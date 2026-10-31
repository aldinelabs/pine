<script setup lang="ts">
import {
  AppWindowIcon,
  CopyIcon,
  ExternalLinkIcon,
  EyeIcon,
  FilesIcon,
  FolderOpenIcon,
  PencilIcon,
  Trash2Icon,
} from "@lucide/vue";
import { storeToRefs } from "pinia";
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
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
} from "@/components/ui/empty";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useContentTabNavigation } from "@/composables/useContentTabNavigation";
import { useProjectFileChanges } from "@/composables/useProjectFileChanges";
import { fileIcon } from "@/lib/fileIcon";
import {
  fileName,
  fileTargetKey,
  fileTargetPath,
  operateFileTarget,
  projectFileDirectory,
} from "@/lib/filePreviewTarget";
import { UI_PRESENT_FILE_TOOL_NAME } from "@/shared/agent";
import { isValidProjectEntryName } from "@/shared/fileNames";
import type { FilePreviewTarget } from "@/shared/projectFiles";
import { useContentTabsStore } from "@/stores/contentTabs";
import { useProjectStore } from "@/stores/project";
import { useSessionStore } from "@/stores/session";
import { useWorkbenchStore } from "@/stores/workbench";

interface Artifact {
  toolCallId: string;
  path: string;
}

type ProjectTarget = Extract<FilePreviewTarget, { source: "project" }>;

const { t } = useI18n();
const sessionStore = useSessionStore();
const projectStore = useProjectStore();
const contentTabs = useContentTabsStore();
const workbench = useWorkbenchStore();
const navigation = useContentTabNavigation();
const { emitProjectFilesChanged } = useProjectFileChanges();
const { messages, activeSession } = storeToRefs(sessionStore);

function presentedPath(input: unknown): string | null {
  if (typeof input !== "object" || input === null || !("path" in input))
    return null;
  return typeof input.path === "string" && input.path.trim()
    ? input.path.trim()
    : null;
}

/** Files the session presented, newest first, each path once. */
const artifacts = computed<Artifact[]>(() => {
  const byPath = new Map<string, Artifact>();
  for (const message of messages.value) {
    for (const block of message.blocks) {
      if (block.type !== "toolCall") continue;
      const { toolCall } = block;
      if (
        toolCall.name !== UI_PRESENT_FILE_TOOL_NAME ||
        toolCall.status === "error"
      )
        continue;
      const path = presentedPath(toolCall.input);
      if (!path) continue;
      byPath.delete(path);
      byPath.set(path, { toolCallId: toolCall.id, path });
    }
  }
  return [...byPath.values()]
    .filter(
      (artifact) => !contentTabs.isPresentationRemoved(artifact.toolCallId),
    )
    .reverse();
});

const previewedToolCallId = computed(
  () => workbench.activeLayout.preview?.toolCallId,
);

/** The file's current location, following a rename made from this list. */
function displayPath(artifact: Artifact): string {
  const target = contentTabs.presentedTargetFor(artifact.toolCallId);
  return target ? fileTargetPath(target) : artifact.path;
}

function sessionProjectId(): string {
  const sessionId = activeSession.value?.id;
  return sessionId
    ? (sessionStore.projectOf(sessionId) ?? projectStore.currentProjectId)
    : projectStore.currentProjectId;
}

async function resolve(artifact: Artifact): Promise<FilePreviewTarget> {
  const sessionId = activeSession.value?.id;
  // Files presented in this window were resolved already; older ones are
  // resolved again from the tool call, which re-grants read access.
  const target =
    contentTabs.presentedTargetFor(artifact.toolCallId) ??
    (sessionId
      ? await window.pine.reopenPresentedToolFile({
          projectId: sessionProjectId(),
          sessionId,
          toolCallId: artifact.toolCallId,
        })
      : null);
  if (!target) throw new Error(artifact.path);
  contentTabs.rememberPresentedTarget(artifact.toolCallId, target);
  return target;
}

async function withTarget(
  artifact: Artifact,
  action: (target: FilePreviewTarget) => void | Promise<void>,
): Promise<void> {
  let target: FilePreviewTarget;
  try {
    target = await resolve(artifact);
  } catch {
    toast.error(t("project.workbench.artifacts.openFailed"), {
      description: displayPath(artifact),
    });
    return;
  }
  try {
    await action(target);
  } catch (error) {
    handleError(error, {
      id: "project.workbench.artifacts.operation",
      title: t("project.files.operationFailed"),
    });
  }
}

function show(artifact: Artifact): Promise<void> {
  return withTarget(artifact, (target) =>
    workbench.preview({ target, toolCallId: artifact.toolCallId }),
  );
}

function openInTab(artifact: Artifact): Promise<void> {
  return withTarget(artifact, (target) => {
    navigation.activate(
      contentTabs.presentFile(target, sessionProjectId(), artifact.toolCallId)
        .id,
    );
    if (previewedToolCallId.value === artifact.toolCallId)
      workbench.clearPreview();
  });
}

function runNative(
  artifact: Artifact,
  action: "open" | "reveal" | "copy-path",
): Promise<void> {
  return withTarget(artifact, (target) => operateFileTarget(target, action));
}

// Changing a file (rename, trash) only applies inside a writable project
// folder. A file presented from outside the project stays read-only.
const menuTarget = ref<{ toolCallId: string; target: ProjectTarget | null }>();

async function loadMenuTarget(
  artifact: Artifact,
  open: boolean,
): Promise<void> {
  if (!open) return;
  menuTarget.value = { toolCallId: artifact.toolCallId, target: null };
  const target = await resolve(artifact).catch(() => null);
  if (menuTarget.value?.toolCallId !== artifact.toolCallId) return;
  menuTarget.value.target =
    target?.source === "project" && writable(target) ? target : null;
}

function writable(target: ProjectTarget): boolean {
  return (
    projectStore
      .projectById(target.projectId)
      ?.folders.find((folder) => folder.id === target.folderId)?.access ===
    "read-write"
  );
}

function editableTarget(artifact: Artifact): ProjectTarget | null {
  return menuTarget.value?.toolCallId === artifact.toolCallId
    ? menuTarget.value.target
    : null;
}

const busy = ref(false);
const dialog = ref<{
  mode: "rename" | "trash";
  artifact: Artifact;
  target: ProjectTarget;
}>();
const entryName = ref("");
const validName = computed(
  () =>
    entryName.value.trim().length > 0 &&
    isValidProjectEntryName(entryName.value, window.pine.platform) &&
    ![".", ".."].includes(entryName.value.trim()),
);

function showDialog(mode: "rename" | "trash", artifact: Artifact): void {
  const target = editableTarget(artifact);
  if (!target) return;
  entryName.value = mode === "rename" ? fileName(target.relativePath) : "";
  dialog.value = { mode, artifact, target };
}

/** Closes the tab and preview that still point at the file's old path. */
function dropViewsOf(artifact: Artifact, target: FilePreviewTarget): void {
  const key = fileTargetKey(target);
  const tab = contentTabs.tabs.find(
    (candidate) =>
      candidate.kind === "file" && fileTargetKey(candidate) === key,
  );
  if (tab) navigation.close(tab.id);
  if (previewedToolCallId.value === artifact.toolCallId)
    workbench.clearPreview();
}

async function submitDialog(): Promise<void> {
  const current = dialog.value;
  if (!current || busy.value) return;
  const { mode, artifact, target } = current;
  if (mode === "rename" && !validName.value) return;
  const reference = {
    folderId: target.folderId,
    projectId: target.projectId,
    relativePath: target.relativePath,
  };
  const name = entryName.value.trim();
  busy.value = true;
  try {
    if (mode === "rename") {
      await window.pine.operateProjectFile({
        action: "rename",
        target: reference,
        name,
      });
      dropViewsOf(artifact, target);
      const directory = projectFileDirectory(target.relativePath);
      contentTabs.rememberPresentedTarget(artifact.toolCallId, {
        ...target,
        relativePath: directory ? `${directory}/${name}` : name,
      });
    } else {
      await window.pine.operateProjectFile({
        action: "trash",
        target: reference,
      });
      dropViewsOf(artifact, target);
      contentTabs.markPresentationRemoved(artifact.toolCallId);
    }
    dialog.value = undefined;
    emitProjectFilesChanged();
  } catch (error) {
    handleError(error, {
      id: "project.workbench.artifacts.operation",
      title: t("project.files.operationFailed"),
    });
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div data-testid="workbench-artifacts" class="flex h-full min-h-0 flex-col">
    <Empty v-if="artifacts.length === 0" class="flex-1 border-0">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FilesIcon aria-hidden="true" />
        </EmptyMedia>
        <EmptyDescription>
          {{ t("project.workbench.artifacts.empty") }}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
    <SidebarMenu v-else class="px-(--workbench-inset) pb-(--workbench-inset)">
      <SidebarMenuItem
        v-for="artifact in artifacts"
        :key="artifact.path"
        data-testid="workbench-artifact"
      >
        <ContextMenu @update:open="loadMenuTarget(artifact, $event)">
          <ContextMenuTrigger as-child>
            <SidebarMenuButton
              :is-active="artifact.toolCallId === previewedToolCallId"
              :title="displayPath(artifact)"
              @click="show(artifact)"
              @dblclick="openInTab(artifact)"
            >
              <component
                :is="fileIcon(displayPath(artifact))"
                aria-hidden="true"
              />
              <span class="min-w-0 flex-1 truncate">{{
                fileName(displayPath(artifact))
              }}</span>
            </SidebarMenuButton>
          </ContextMenuTrigger>
          <ContextMenuContent class="w-52">
            <ContextMenuGroup>
              <ContextMenuItem @select="show(artifact)">
                <EyeIcon aria-hidden="true" />
                {{ t("project.workbench.artifacts.preview") }}
              </ContextMenuItem>
              <ContextMenuItem @select="openInTab(artifact)">
                <AppWindowIcon aria-hidden="true" />
                {{ t("project.workbench.preview.openInTab") }}
              </ContextMenuItem>
            </ContextMenuGroup>
            <ContextMenuSeparator />
            <ContextMenuGroup>
              <ContextMenuItem @select="runNative(artifact, 'open')">
                <ExternalLinkIcon aria-hidden="true" />
                {{ t("project.files.open") }}
              </ContextMenuItem>
              <ContextMenuItem @select="runNative(artifact, 'reveal')">
                <FolderOpenIcon aria-hidden="true" />
                {{ t("project.files.reveal") }}
              </ContextMenuItem>
              <ContextMenuItem @select="runNative(artifact, 'copy-path')">
                <CopyIcon aria-hidden="true" />
                {{ t("project.files.copyPath") }}
              </ContextMenuItem>
            </ContextMenuGroup>
            <ContextMenuSeparator />
            <ContextMenuGroup>
              <ContextMenuItem
                :disabled="busy || !editableTarget(artifact)"
                @select="showDialog('rename', artifact)"
              >
                <PencilIcon aria-hidden="true" />
                {{ t("project.files.rename") }}
              </ContextMenuItem>
              <ContextMenuItem
                variant="destructive"
                :disabled="busy || !editableTarget(artifact)"
                @select="showDialog('trash', artifact)"
              >
                <Trash2Icon aria-hidden="true" />
                {{ t("project.files.trash") }}
              </ContextMenuItem>
            </ContextMenuGroup>
          </ContextMenuContent>
        </ContextMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  </div>

  <Dialog
    :open="dialog?.mode === 'rename'"
    @update:open="
      (open) => {
        if (!open && !busy) dialog = undefined;
      }
    "
  >
    <DialogContent>
      <form class="flex flex-col gap-4" @submit.prevent="submitDialog">
        <DialogHeader>
          <DialogTitle>{{ t("project.files.rename") }}</DialogTitle>
          <DialogDescription>
            {{ t("project.files.nameDescription") }}
          </DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel for="workbench-artifact-name">
            {{ t("project.files.name") }}
          </FieldLabel>
          <Input
            id="workbench-artifact-name"
            v-model="entryName"
            :disabled="busy"
            autocomplete="off"
          />
        </Field>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            :disabled="busy"
            @click="dialog = undefined"
          >
            {{ t("common.cancel") }}
          </Button>
          <Button type="submit" :disabled="busy || !validName">
            {{ t("common.save") }}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>

  <AlertDialog
    :open="dialog?.mode === 'trash'"
    @update:open="
      (open) => {
        if (!open && !busy) dialog = undefined;
      }
    "
  >
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{{ t("project.files.trash") }}</AlertDialogTitle>
        <AlertDialogDescription>
          {{
            t("project.files.trashDescription", {
              name: dialog ? fileName(dialog.target.relativePath) : "",
            })
          }}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel :disabled="busy">{{
          t("common.cancel")
        }}</AlertDialogCancel>
        <Button variant="destructive" :disabled="busy" @click="submitDialog">
          {{ t("project.files.trash") }}
        </Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
