<script setup lang="ts">
import FirstUseHint from "@/components/help/FirstUseHint.vue";
import {
  AppWindowIcon,
  ChevronRightIcon,
  EyeIcon,
  FilesIcon,
  FolderIcon,
  FolderOpenIcon,
  HistoryIcon,
  PencilIcon,
  Trash2Icon,
} from "@lucide/vue";
import { storeToRefs } from "pinia";
import { computed, ref, watch } from "vue";
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
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useContentTabNavigation } from "@/composables/useContentTabNavigation";
import { useListFold } from "@/composables/useListFold";
import { useProjectFileChanges } from "@/composables/useProjectFileChanges";
import { messageArtifacts } from "@/composables/useSubmittedArtifacts";
import { fileIcon } from "@/lib/fileIcon";
import { dragFileTarget, startNativeFileDrag } from "@/lib/projectFileDrag";
import {
  fileName,
  fileTargetKey,
  fileTargetPath,
  operateFileTarget,
  projectFileDirectory,
} from "@/lib/filePreviewTarget";
import {
  artifactKey,
  artifactTree,
  collectArtifacts,
  type ArtifactFolderNode,
  type SessionArtifact,
} from "@/shared/artifacts";
import { isValidProjectEntryName } from "@/shared/fileNames";
import type { FilePreviewTarget } from "@/shared/projectFiles";
import { useArtifactFoldersStore } from "@/stores/artifactFolders";
import {
  useArtifactVersionStore,
  workbenchVersionKey,
} from "@/stores/artifactVersions";
import { useContentTabsStore } from "@/stores/contentTabs";
import { useProjectStore } from "@/stores/project";
import { useSessionStore } from "@/stores/session";
import { useWorkbenchStore } from "@/stores/workbench";

/** A listed artifact and the key its targets and removal are stored under. */
type Artifact = SessionArtifact & { key: string };

type ProjectTarget = Extract<FilePreviewTarget, { source: "project" }>;

/** One visible row of the Artifacts tree, indented by its depth. */
type Row =
  | {
      kind: "folder";
      key: string;
      depth: number;
      folder: ArtifactFolderNode<Artifact>;
      expanded: boolean;
    }
  | { kind: "file"; key: string; depth: number; artifact: Artifact };

const { t } = useI18n();
const sessionStore = useSessionStore();
const projectStore = useProjectStore();
const contentTabs = useContentTabsStore();
const workbench = useWorkbenchStore();
const navigation = useContentTabNavigation();
const { emitProjectFilesChanged } = useProjectFileChanges();
const { messages, activeSession, isLoadingMessages } =
  storeToRefs(sessionStore);

/**
 * The session's artifacts, newest first, each path once: the files the agent
 * submitted, or the files it presented in a session from before submitting.
 */
const artifacts = computed<Artifact[]>((previous) => {
  const next = collectArtifacts(messages.value.map(messageArtifacts))
    .map((artifact) => ({
      ...artifact,
      key: artifact.submitted
        ? artifactKey(artifact.toolCallId, artifact.path)
        : artifact.toolCallId,
    }))
    .filter((artifact) => !contentTabs.isPresentationRemoved(artifact.key));
  // Keep the list (and its rows) when a stream update changed nothing here.
  return previous &&
    previous.length === next.length &&
    next.every(
      (artifact, index) =>
        previous[index].key === artifact.key &&
        previous[index].path === artifact.path &&
        previous[index].title === artifact.title &&
        previous[index].description === artifact.description &&
        previous[index].folder === artifact.folder,
    )
    ? previous
    : next;
});

const folders = useArtifactFoldersStore();

function folderExpanded(path: string): boolean {
  const sessionId = activeSession.value?.id;
  return !sessionId || folders.isExpanded(sessionId, path);
}

function toggleFolder(path: string): void {
  const sessionId = activeSession.value?.id;
  if (sessionId)
    folders.setExpanded(sessionId, path, !folders.isExpanded(sessionId, path));
}

/** The tree's visible rows: a collapsed folder hides what it holds. */
const rows = computed<Row[]>(() => {
  const list: Row[] = [];
  function add(node: ArtifactFolderNode<Artifact>, depth: number): void {
    for (const folder of node.folders) {
      const expanded = folderExpanded(folder.path);
      list.push({
        kind: "folder",
        key: `folder:${folder.path}`,
        depth,
        folder,
        expanded,
      });
      if (expanded) add(folder, depth + 1);
    }
    for (const artifact of node.files)
      list.push({
        kind: "file",
        key: `file:${artifact.path}`,
        depth,
        artifact,
      });
  }
  add(artifactTree(artifacts.value), 0);
  return list;
});

/*
 * Rows fold in and out like the session list's, except for the rows a
 * session switch or a transcript page brings: those show as they are.
 */
let rowsSessionId: string | undefined;
let pageLoaded = false;
watch(
  isLoadingMessages,
  (loading) => {
    if (loading) pageLoaded = true;
    // The page's rows are listed in the flush before this timer fires.
    else setTimeout(() => (pageLoaded = false), 0);
  },
  { flush: "sync" },
);
const { displayRows, setElement } = useListFold(rows, {
  canAnimate: () => {
    const sessionId = activeSession.value?.id;
    const sameSession = sessionId === rowsSessionId;
    rowsSessionId = sessionId;
    return sameSession && !pageLoaded && !isLoadingMessages.value;
  },
});

/** Indents a row by its depth in the tree. */
function indent(depth: number): Record<string, string> | undefined {
  return depth
    ? { paddingInlineStart: `calc(0.5rem + ${depth} * 1rem)` }
    : undefined;
}

const previewedKey = computed(() => {
  const preview = workbench.activeLayout.preview;
  return preview?.toolCallId
    ? artifactKey(preview.toolCallId, preview.artifactPath)
    : undefined;
});
const previewedFileKey = computed(() => {
  const preview = workbench.activeLayout.preview;
  return preview ? fileTargetKey(preview.target) : undefined;
});
const previewedPath = computed(() => workbench.activeLayout.preview?.path);

/**
 * The preview shows this artifact: opened from here, presented by the agent
 * (matched by the absolute path, as a parallel presentation has its own tool
 * call), or resolved here earlier.
 */
function isPreviewed(artifact: Artifact): boolean {
  if (artifact.key === previewedKey.value) return true;
  if (previewedPath.value && previewedPath.value === artifact.path) return true;
  const target = contentTabs.presentedTargetFor(artifact.key);
  return !!target && fileTargetKey(target) === previewedFileKey.value;
}

/** The file's current location, following a rename made from this list. */
function displayPath(artifact: Artifact): string {
  const target = contentTabs.presentedTargetFor(artifact.key);
  return target ? fileTargetPath(target) : artifact.path;
}

function sessionProjectId(): string {
  const sessionId = activeSession.value?.id;
  return sessionId
    ? (sessionStore.projectOf(sessionId) ?? projectStore.currentProjectId)
    : projectStore.currentProjectId;
}

/** Resolutions in flight, so a press and the click after it share one. */
const resolving = new Map<string, Promise<FilePreviewTarget>>();

function resolve(artifact: Artifact): Promise<FilePreviewTarget> {
  const pending = resolving.get(artifact.key);
  if (pending) return pending;
  const next = resolveTarget(artifact).finally(() =>
    resolving.delete(artifact.key),
  );
  resolving.set(artifact.key, next);
  return next;
}

async function resolveTarget(artifact: Artifact): Promise<FilePreviewTarget> {
  const sessionId = activeSession.value?.id;
  // Files resolved in this window are remembered; others are resolved again
  // from the tool call, which re-grants read access.
  const target =
    contentTabs.presentedTargetFor(artifact.key) ??
    (sessionId
      ? await window.pine.reopenPresentedToolFile({
          projectId: sessionProjectId(),
          sessionId,
          toolCallId: artifact.toolCallId,
          ...(artifact.submitted ? { path: artifact.path } : {}),
        })
      : null);
  if (!target) throw new Error(artifact.path);
  contentTabs.rememberPresentedTarget(artifact.key, target);
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
    workbench.preview({
      target,
      toolCallId: artifact.toolCallId,
      path: artifact.path,
      ...(artifact.submitted ? { artifactPath: artifact.path } : {}),
    }),
  );
}

function openInTab(artifact: Artifact): Promise<void> {
  return withTarget(artifact, (target) => {
    navigation.activate(
      contentTabs.presentFile(
        target,
        sessionProjectId(),
        artifact.key,
        undefined,
        artifact.submitted && activeSession.value
          ? { sessionId: activeSession.value.id, path: artifact.path }
          : undefined,
      ).id,
    );
    if (isPreviewed(artifact)) workbench.clearPreview();
  });
}

function runNative(
  artifact: Artifact,
  action: "open" | "reveal" | "copy-path",
): Promise<void> {
  return withTarget(artifact, (target) => operateFileTarget(target, action));
}

/** Resolves the file on press, so a drag that follows already knows it. */
function prepareDrag(event: PointerEvent, artifact: Artifact): void {
  if (event.button !== 0 || contentTabs.presentedTargetFor(artifact.key))
    return;
  void resolve(artifact).catch(() => undefined);
}

/**
 * Drags the file out like one from the file tree: a real file for Finder and
 * other apps, a project entry for Pine's composer and file tree.
 */
function startDrag(event: DragEvent, artifact: Artifact): void {
  const target = contentTabs.presentedTargetFor(artifact.key);
  if (target) {
    dragFileTarget(event, target);
    return;
  }
  // Still resolving: the browser drag cannot wait, so hand the file to the
  // OS as soon as it is known.
  event.preventDefault();
  void resolve(artifact).then(startNativeFileDrag, () => undefined);
}

const versions = useArtifactVersionStore();

/** Kept versions per submitted path: its submissions that recorded a copy. */
const versionCounts = computed(() => {
  const counts = new Map<string, number>();
  for (const message of messages.value)
    for (const artifact of messageArtifacts(message).submitted)
      if (artifact.snapshot)
        counts.set(artifact.path, (counts.get(artifact.path) ?? 0) + 1);
  return counts;
});

function versionCount(artifact: Artifact): number {
  return artifact.submitted ? (versionCounts.value.get(artifact.path) ?? 0) : 0;
}

/** Previews the file with its version menu open. */
async function showVersions(artifact: Artifact): Promise<void> {
  const session = activeSession.value;
  if (!artifact.submitted || !session) return;
  await show(artifact);
  const key = workbenchVersionKey(session.id);
  versions.bind(key, {
    projectId: sessionProjectId(),
    sessionId: session.id,
    path: artifact.path,
  });
  versions.requestMenu(key);
}

// Changing a file (rename, trash) only applies inside a writable project
// folder. A file presented from outside the project stays read-only.
const menuTarget = ref<{ key: string; target: ProjectTarget | null }>();

async function loadMenuTarget(
  artifact: Artifact,
  open: boolean,
): Promise<void> {
  if (!open) return;
  menuTarget.value = { key: artifact.key, target: null };
  const target = await resolve(artifact).catch(() => null);
  if (menuTarget.value?.key !== artifact.key) return;
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
  return menuTarget.value?.key === artifact.key
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
  if (tab) void navigation.close(tab.id);
  if (isPreviewed(artifact)) workbench.clearPreview();
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
      contentTabs.rememberPresentedTarget(artifact.key, {
        ...target,
        relativePath: directory ? `${directory}/${name}` : name,
      });
    } else {
      await window.pine.operateProjectFile({
        action: "trash",
        target: reference,
      });
      dropViewsOf(artifact, target);
      contentTabs.markPresentationRemoved(artifact.key);
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
    <FirstUseHint
      v-if="artifacts.length > 0"
      id="artifacts"
      class="mx-(--workbench-inset) mb-1.5 shrink-0"
      :text="t('help.hints.artifacts')"
      :guide="{ topic: 'workbench', step: 1 }"
    />
    <SidebarMenu
      v-if="artifacts.length > 0"
      class="px-(--workbench-inset) pb-(--workbench-inset)"
    >
      <template v-for="row in displayRows" :key="row.renderKey">
        <SidebarMenuItem
          v-if="row.kind === 'folder'"
          :ref="(element) => setElement(row.renderKey, element)"
          data-testid="workbench-artifact-folder"
          :data-motion="row.motion"
          :class="row.motion && 'pointer-events-none'"
          :inert="row.motion === 'leave' || undefined"
        >
          <SidebarMenuButton
            :aria-expanded="row.expanded"
            :title="row.folder.path"
            :style="indent(row.depth)"
            @click="toggleFolder(row.folder.path)"
          >
            <ChevronRightIcon
              aria-hidden="true"
              class="transition-transform"
              :class="row.expanded && 'rotate-90'"
            />
            <component
              :is="row.expanded ? FolderOpenIcon : FolderIcon"
              aria-hidden="true"
            />
            <span
              data-testid="workbench-artifact-folder-name"
              class="min-w-0 flex-1 truncate"
              >{{ row.folder.name }}</span
            >
          </SidebarMenuButton>
        </SidebarMenuItem>
        <template v-else>
          <SidebarMenuItem
            v-for="artifact in [row.artifact]"
            :key="artifact.path"
            :ref="(element) => setElement(row.renderKey, element)"
            data-testid="workbench-artifact"
            :data-motion="row.motion"
            :class="row.motion && 'pointer-events-none'"
            :inert="row.motion === 'leave' || undefined"
          >
            <ContextMenu @update:open="loadMenuTarget(artifact, $event)">
              <ContextMenuTrigger as-child>
                <SidebarMenuButton
                  :is-active="isPreviewed(artifact)"
                  :size="artifact.description ? 'lg' : 'default'"
                  :class="versionCount(artifact) > 1 && 'pr-12'"
                  :style="indent(row.depth)"
                  :title="
                    artifact.description
                      ? `${displayPath(artifact)}\n${artifact.description}`
                      : displayPath(artifact)
                  "
                  draggable="true"
                  @pointerdown="prepareDrag($event, artifact)"
                  @dragstart="startDrag($event, artifact)"
                  @click="show(artifact)"
                  @dblclick="openInTab(artifact)"
                >
                  <component
                    :is="fileIcon(displayPath(artifact))"
                    aria-hidden="true"
                  />
                  <span
                    v-if="artifact.description"
                    class="flex min-w-0 flex-1 flex-col"
                  >
                    <span
                      data-testid="workbench-artifact-name"
                      class="truncate"
                      >{{
                        artifact.title ?? fileName(displayPath(artifact))
                      }}</span
                    >
                    <span
                      data-testid="workbench-artifact-description"
                      class="truncate text-xs font-normal text-muted-foreground"
                      >{{ artifact.description }}</span
                    >
                  </span>
                  <span
                    v-else
                    data-testid="workbench-artifact-name"
                    class="min-w-0 flex-1 truncate"
                    >{{
                      artifact.title ?? fileName(displayPath(artifact))
                    }}</span
                  >
                </SidebarMenuButton>
              </ContextMenuTrigger>
              <ContextMenuContent class="w-52 [&_[data-inset]]:pl-8">
                <ContextMenuGroup>
                  <ContextMenuItem @select="show(artifact)">
                    <EyeIcon aria-hidden="true" />
                    {{ t("project.workbench.artifacts.preview") }}
                  </ContextMenuItem>
                  <ContextMenuItem @select="openInTab(artifact)">
                    <AppWindowIcon aria-hidden="true" />
                    {{ t("project.workbench.preview.openInTab") }}
                  </ContextMenuItem>
                  <ContextMenuItem
                    v-if="artifact.submitted"
                    data-testid="workbench-artifact-versions"
                    @select="showVersions(artifact)"
                  >
                    <HistoryIcon aria-hidden="true" />
                    {{ t("project.workbench.artifacts.versions.menu") }}
                  </ContextMenuItem>
                </ContextMenuGroup>
                <ContextMenuSeparator />
                <ContextMenuGroup>
                  <ContextMenuItem inset @select="runNative(artifact, 'open')">
                    {{ t("project.files.open") }}
                  </ContextMenuItem>
                  <ContextMenuItem
                    inset
                    @select="runNative(artifact, 'reveal')"
                  >
                    {{ t("project.files.reveal") }}
                  </ContextMenuItem>
                  <ContextMenuItem
                    inset
                    @select="runNative(artifact, 'copy-path')"
                  >
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
            <SidebarMenuBadge
              v-if="versionCount(artifact) > 1"
              data-testid="workbench-artifact-version-count"
              class="gap-0.5 text-muted-foreground"
            >
              <HistoryIcon class="size-3" aria-hidden="true" />
              <span aria-hidden="true">{{ versionCount(artifact) }}</span>
              <span class="sr-only">{{
                t("project.workbench.artifacts.versions.count", {
                  count: versionCount(artifact),
                })
              }}</span>
            </SidebarMenuBadge>
          </SidebarMenuItem>
        </template>
      </template>
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
