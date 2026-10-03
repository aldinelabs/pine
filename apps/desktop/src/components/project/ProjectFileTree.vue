<script setup lang="ts">
import {
  ChevronRight,
  Folder,
  FolderOpen,
  FolderPlus,
  Pencil,
  Trash2,
} from "@lucide/vue";
import { TreeItem, TreeRoot, TreeVirtualizer } from "reka-ui";
import {
  computed,
  nextTick,
  onUnmounted,
  ref,
  useTemplateRef,
  watch,
} from "vue";
import { useI18n } from "vue-i18n";
import { isValidProjectEntryName } from "@/shared/fileNames";
import { handleError } from "@/app/errors/errorHandler";
import { fileIcon } from "@/lib/fileIcon";
import { projectFileDirectory } from "@/lib/filePreviewTarget";
import { Badge } from "@/components/ui/badge";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import type {
  ProjectEntry,
  ProjectEntryReference,
  ProjectFileOperation,
  ProjectFilesChangedEvent,
} from "@/shared/projectFiles";
import {
  containsFileDrag,
  externalFilePaths,
  PROJECT_ENTRY_DRAG_TYPE,
  readProjectEntryDrag,
} from "@/lib/projectFileDrag";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useProjectSidebarStore } from "@/stores/projectSidebar";
import { useProjectStore } from "@/stores/project";
import { useContentTabsStore } from "@/stores/contentTabs";
import { useContentTabNavigation } from "@/composables/useContentTabNavigation";
import { useScopedProject } from "@/composables/useScopedProject";
import { useProjectFileChanges } from "@/composables/useProjectFileChanges";

interface ProjectTreeNode extends ProjectEntry {
  children?: ProjectTreeNode[];
  folderId: string;
  isPlaceholder?: boolean;
  isRoot?: boolean;
  isUnavailable?: boolean;
}

const { t } = useI18n();
const projectStore = useProjectStore();
const contentTabsStore = useContentTabsStore();
const tabNavigation = useContentTabNavigation();
// Retained per project: always show this panel's project.
const activeProject = useScopedProject();
/** Only the visible project's tree keeps directory watchers in main. */
const isCurrentProject = computed(
  () =>
    activeProject.value !== null &&
    activeProject.value.id === projectStore.currentProjectId,
);
const { onProjectFilesChanged } = useProjectFileChanges();
const unsubscribeLocalProjectFilesChanged = onProjectFilesChanged(() => {
  void refresh()
    .catch((error) =>
      handleError(error, {
        id: "project.files.menu-refresh",
        title: t("errors.projectFiles.title"),
      }),
    )
    .finally(scheduleWatchSync);
});

const items = ref<ProjectTreeNode[]>([]);
const loadingDirectories = new Map<string, Promise<void>>();
const sidebarStore = useProjectSidebarStore();
const expanded = computed<string[]>({
  get: () =>
    activeProject.value
      ? sidebarStore.stateFor(activeProject.value.id).expanded
      : [],
  set: (keys) => {
    if (activeProject.value)
      sidebarStore.setExpanded(activeProject.value.id, keys);
  },
});
const TREE_DISCLOSURE_DURATION_MS = 500;
const disclosureAnimationsEnabled = ref(false);
const treeRoot = useTemplateRef<{ $el: HTMLElement }>("treeRoot");
const activeRowAnimations = new Set<Animation>();
const subtreeClipAnimations = new Map<string, Animation>();
const dropTarget = ref<string>();
const contextTarget = ref<string>();
const busy = ref(false);
const dialog = ref<{
  mode: "newFolder" | "rename" | "trash";
  node: ProjectTreeNode;
}>();
const entryName = ref("");
const operationError = ref("");
const validName = computed(
  () =>
    entryName.value.trim().length > 0 &&
    isValidProjectEntryName(entryName.value, window.pine.platform) &&
    ![".", ".."].includes(entryName.value),
);
let generation = 0;

function nodeKey(node: ProjectTreeNode): string {
  return `${node.folderId}:${node.relativePath}`;
}

interface RowPosition {
  element: HTMLElement;
  top: number;
  left: number;
  width: number;
  height: number;
}

function rowPositions(): Map<string, RowPosition> {
  const positions = new Map<string, RowPosition>();
  treeRoot.value?.$el
    .querySelectorAll<HTMLElement>("[data-tree-key]")
    .forEach((element) => {
      const key = element.dataset.treeKey;
      if (!key) return;
      const rect = element.getBoundingClientRect();
      positions.set(key, {
        element,
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      });
    });
  return positions;
}

function animateRow(
  element: HTMLElement,
  frames: Keyframe[],
): Animation | undefined {
  if (!element.animate) return;
  const animation = element.animate(frames, {
    duration: TREE_DISCLOSURE_DURATION_MS,
    easing: "cubic-bezier(0.16, 1, 0.3, 1)",
  });
  void animation.finished.catch(() => {});
  activeRowAnimations.add(animation);
  animation.addEventListener(
    "finish",
    () => activeRowAnimations.delete(animation),
    {
      once: true,
    },
  );
  animation.addEventListener(
    "cancel",
    () => activeRowAnimations.delete(animation),
    {
      once: true,
    },
  );
  return animation;
}

function isDescendantKey(key: string, ancestorKey: string): boolean {
  return key.startsWith(
    ancestorKey.endsWith(":") ? ancestorKey : `${ancestorKey}/`,
  );
}

async function animateExpansion(
  previous: Map<string, RowPosition>,
  toggledKey: string,
  opening: boolean,
): Promise<void> {
  await nextTick();
  const root = treeRoot.value?.$el;
  if (!root || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches)
    return;
  const current = rowPositions();
  const parent = current.get(toggledKey) ?? previous.get(toggledKey);
  const parentBottom = parent ? parent.top + parent.height : undefined;

  for (const [key, row] of current) {
    const old = previous.get(key);
    if (old) {
      const offset = old.top - row.top;
      if (Math.abs(offset) > 0.5)
        animateRow(row.element, [
          { translate: `0 ${offset}px` },
          { translate: "0 0" },
        ]);
    }
  }

  if (parentBottom === undefined) return;
  const rootRect = root.getBoundingClientRect();
  const subtreeRows = opening
    ? [...current].filter(
        ([key]) => !previous.has(key) && isDescendantKey(key, toggledKey),
      )
    : [...previous].filter(
        ([key]) => !current.has(key) && isDescendantKey(key, toggledKey),
      );
  if (!subtreeRows.length) return;
  const height = Math.max(
    0,
    ...subtreeRows.map(([, row]) => row.top + row.height - parentBottom),
  );
  const clip = document.createElement("div");
  clip.setAttribute("aria-hidden", "true");
  clip.className = "bg-sidebar";
  clip.style.position = "absolute";
  clip.style.top = `${parentBottom - rootRect.top + root.scrollTop}px`;
  clip.style.left = "0";
  clip.style.width = `${root.clientWidth}px`;
  clip.style.height = `${height}px`;
  clip.style.overflow = "hidden";
  clip.style.pointerEvents = "none";
  const content = document.createElement("div");
  content.style.position = "relative";
  content.style.height = `${height}px`;
  clip.appendChild(content);
  for (const [, row] of subtreeRows) {
    const ghost = row.element.cloneNode(true) as HTMLElement;
    ghost.removeAttribute("id");
    ghost.removeAttribute("data-path");
    ghost.removeAttribute("data-tree-key");
    ghost.removeAttribute("data-index");
    ghost.removeAttribute("tabindex");
    ghost
      .querySelectorAll("[id]")
      .forEach((element) => element.removeAttribute("id"));
    ghost.style.position = "absolute";
    ghost.style.top = `${row.top - parentBottom}px`;
    ghost.style.left = `${row.left - rootRect.left}px`;
    ghost.style.width = `${row.width}px`;
    ghost.style.height = `${row.height}px`;
    ghost.style.transform = "none";
    ghost.style.visibility = "visible";
    content.appendChild(ghost);
    if (opening) row.element.style.visibility = "hidden";
  }
  root.appendChild(clip);
  const animation = animateRow(
    clip,
    opening
      ? [{ height: "0px" }, { height: `${height}px` }]
      : [{ height: `${height}px` }, { height: "0px" }],
  );
  const opacityAnimation = animation
    ? animateRow(
        content,
        opening
          ? [{ opacity: 0 }, { opacity: 1 }]
          : [{ opacity: 1 }, { opacity: 0 }],
      )
    : undefined;
  const cleanup = () => {
    opacityAnimation?.cancel();
    clip.remove();
    if (subtreeClipAnimations.get(toggledKey) === animation)
      subtreeClipAnimations.delete(toggledKey);
    if (opening)
      subtreeRows.forEach(([, row]) => (row.element.style.visibility = ""));
  };
  if (!animation) cleanup();
  else {
    subtreeClipAnimations.set(toggledKey, animation);
    animation.addEventListener("finish", cleanup, { once: true });
    animation.addEventListener("cancel", cleanup, { once: true });
  }
}

function handleExpandedChange(nextKeys: string[]): void {
  const before = new Set(expanded.value);
  const next = [...new Set(nextKeys)];
  const toggledKey =
    next.find((key) => !before.has(key)) ??
    [...before].find((key) => !next.includes(key));
  if (toggledKey) {
    for (const [key, animation] of subtreeClipAnimations) {
      if (key === toggledKey || isDescendantKey(key, toggledKey))
        animation.cancel();
    }
  }
  const previous = rowPositions();
  expanded.value = next;
  if (toggledKey && disclosureAnimationsEnabled.value)
    void animateExpansion(previous, toggledKey, next.includes(toggledKey));
}

function loadingPlaceholder(
  folderId: string,
  relativePath: string,
): ProjectTreeNode {
  return {
    folderId,
    kind: "file",
    name: t("project.files.loading"),
    relativePath: `${relativePath}/.__pine_loading__`,
    isPlaceholder: true,
  };
}

function toTreeNode(folderId: string, entry: ProjectEntry): ProjectTreeNode {
  return {
    ...entry,
    folderId,
    ...(entry.kind === "directory"
      ? { children: [loadingPlaceholder(folderId, entry.relativePath)] }
      : {}),
  };
}

function resetRoots(): void {
  generation += 1;
  const currentGeneration = generation;
  disclosureAnimationsEnabled.value = false;
  loadingDirectories.clear();
  pendingWatchedChanges.clear();
  dialog.value = undefined;
  contextTarget.value = undefined;
  dropTarget.value = undefined;
  items.value =
    activeProject.value?.folders.map((folder) => ({
      children: folder.isAvailable
        ? [loadingPlaceholder(folder.id, "")]
        : undefined,
      folderId: folder.id,
      isRoot: true,
      isUnavailable: !folder.isAvailable,
      kind: "directory",
      name: folder.name,
      relativePath: "",
    })) ?? [];
  void refresh()
    .catch((error) =>
      handleError(error, {
        id: "project.files.restore",
        title: t("errors.projectFiles.title"),
      }),
    )
    .finally(() => {
      if (currentGeneration !== generation) return;
      disclosureAnimationsEnabled.value = true;
      scheduleWatchSync();
    });
}

async function readDirectory(
  folderId: string,
  relativePath: string,
): Promise<ProjectTreeNode[]> {
  const projectId = activeProject.value?.id;
  if (!projectId) return [];
  const result = await window.pine.listProjectDirectory({
    folderId,
    projectId,
    relativePath,
  });
  return result.entries
    .filter((entry) =>
      entry.kind === "directory"
        ? !entry.name.startsWith(".")
        : ![".ds_store", "thumbs.db", "desktop.ini"].includes(
            entry.name.toLowerCase(),
          ) && !entry.name.startsWith("._"),
    )
    .map((entry) => toTreeNode(folderId, entry));
}

async function loadChildren(node: ProjectTreeNode): Promise<void> {
  const key = nodeKey(node);
  const pending = loadingDirectories.get(key);
  if (pending) return pending;
  if (
    node.kind !== "directory" ||
    node.isUnavailable ||
    !node.children?.some((child) => child.isPlaceholder)
  ) {
    return;
  }

  const currentGeneration = generation;
  const task = (async () => {
    try {
      const children = await readDirectory(node.folderId, node.relativePath);
      if (currentGeneration !== generation) return;
      node.children = children;
      // Recurse through Vue's proxies so nested loads update the rendered tree.
      await Promise.all(
        node.children
          .filter((child) => expanded.value.includes(nodeKey(child)))
          .map(loadChildren),
      );
    } catch (error) {
      handleError(error, {
        id: `project.files.${key}`,
        title: t("errors.projectFiles.title"),
        description: t("errors.projectFiles.description"),
      });
    }
  })();
  loadingDirectories.set(key, task);
  const clearPending = () => {
    if (loadingDirectories.get(key) === task) loadingDirectories.delete(key);
  };
  void task.then(clearPending, clearPending);
  return task;
}

function isProjectTreeNode(node: unknown): node is ProjectTreeNode {
  return (
    typeof node === "object" &&
    node !== null &&
    "folderId" in node &&
    typeof node.folderId === "string" &&
    "relativePath" in node &&
    typeof node.relativePath === "string"
  );
}

function handleTreeToggle(
  event: { detail: { isExpanded: boolean }; preventDefault(): void },
  node: ProjectTreeNode,
): void {
  disclosureAnimationsEnabled.value = true;
  if (
    event.detail.isExpanded ||
    node.kind !== "directory" ||
    !node.children?.some((child) => child.isPlaceholder)
  )
    return;
  event.preventDefault();
  const currentGeneration = generation;
  void loadChildren(node).then(() => {
    const key = nodeKey(node);
    if (
      currentGeneration !== generation ||
      node.children?.some((child) => child.isPlaceholder) ||
      expanded.value.includes(key)
    )
      return;
    handleExpandedChange([...expanded.value, key]);
  });
}

function previewFile(node: ProjectTreeNode): void {
  if (
    node.kind !== "file" ||
    node.isPlaceholder ||
    node.isUnavailable ||
    !activeProject.value
  )
    return;
  tabNavigation.openFile(reference(node));
}

function reference(node: unknown): ProjectEntryReference {
  if (!isProjectTreeNode(node)) throw new Error("Invalid tree entry.");
  return {
    folderId: node.folderId,
    projectId: requireProjectId(),
    relativePath: node.relativePath,
  };
}

function writable(node: ProjectTreeNode): boolean {
  return (
    !node.isUnavailable &&
    !node.isPlaceholder &&
    activeProject.value?.folders.find((folder) => folder.id === node.folderId)
      ?.access === "read-write"
  );
}

function requireProjectId(): string {
  const projectId = activeProject.value?.id;
  if (!projectId) throw new Error("No project is shown.");
  return projectId;
}

function parentReference(node: ProjectTreeNode): ProjectEntryReference {
  return {
    folderId: node.folderId,
    projectId: requireProjectId(),
    relativePath: node.relativePath.split("/").slice(0, -1).join("/"),
  };
}

async function refresh(): Promise<void> {
  const currentGeneration = generation;
  async function reload(node: ProjectTreeNode): Promise<void> {
    if (
      node.kind !== "directory" ||
      node.isUnavailable ||
      !expanded.value.includes(nodeKey(node))
    )
      return;
    if (node.children?.some((child) => child.isPlaceholder)) {
      await loadChildren(node);
      return;
    }
    const children = await readDirectory(node.folderId, node.relativePath);
    if (currentGeneration !== generation) return;
    node.children = children;
    await Promise.all(node.children.map(reload));
  }
  await Promise.all(items.value.map(reload));
}

async function runOperation(operation: ProjectFileOperation): Promise<boolean> {
  if (busy.value) return false;
  busy.value = true;
  operationError.value = "";
  try {
    await window.pine.operateProjectFile(operation);
    return true;
  } catch (error) {
    operationError.value =
      error instanceof Error ? error.message : String(error);
    handleError(error, {
      id: "project.files.operation",
      title: t("project.files.operationFailed"),
      description: operationError.value,
    });
    return false;
  } finally {
    // Also refresh after partial failures (for example a multi-file cross-volume move).
    try {
      await refresh();
    } catch (error) {
      handleError(error, {
        id: "project.files.refresh",
        title: t("errors.projectFiles.title"),
      });
    }
    busy.value = false;
  }
}

function showDialog(
  mode: "newFolder" | "rename" | "trash",
  node: ProjectTreeNode,
): void {
  entryName.value = mode === "rename" ? node.name : "";
  operationError.value = "";
  dialog.value = { mode, node };
}

async function submitDialog(): Promise<void> {
  const current = dialog.value;
  if (!current || busy.value || (current.mode !== "trash" && !validName.value))
    return;
  const { mode, node } = current;
  const operation: ProjectFileOperation =
    mode === "rename"
      ? { action: "rename", target: reference(node), name: entryName.value }
      : mode === "trash"
        ? { action: "trash", target: reference(node) }
        : {
            action: "create",
            target:
              node.kind === "directory"
                ? reference(node)
                : parentReference(node),
            name: entryName.value,
            kind: "directory",
          };
  if (await runOperation(operation)) dialog.value = undefined;
}

function startDrag(event: DragEvent, node: ProjectTreeNode): void {
  if (
    !event.dataTransfer ||
    node.isPlaceholder ||
    node.isUnavailable ||
    busy.value
  ) {
    event.preventDefault();
    return;
  }
  event.dataTransfer.setData(
    PROJECT_ENTRY_DRAG_TYPE,
    JSON.stringify([reference(node)]),
  );
  // Even read-only folders can be attached to a message.
  event.dataTransfer.effectAllowed = "copyMove";
  event.preventDefault();
  window.pine.startProjectFileDrag(reference(node));
}

function dragOver(event: DragEvent, node: ProjectTreeNode): void {
  if (!containsFileDrag(event.dataTransfer)) return;
  event.preventDefault();
  event.stopPropagation();
  const allowed = node.kind === "directory" && writable(node) && !busy.value;
  if (event.dataTransfer)
    event.dataTransfer.dropEffect = allowed ? "move" : "none";
  dropTarget.value = allowed ? nodeKey(node) : undefined;
}

async function drop(event: DragEvent, node: ProjectTreeNode): Promise<void> {
  if (!containsFileDrag(event.dataTransfer)) return;
  event.preventDefault();
  event.stopPropagation();
  dropTarget.value = undefined;
  if (
    !event.dataTransfer ||
    node.kind !== "directory" ||
    !writable(node) ||
    busy.value
  )
    return;
  try {
    const sources = readProjectEntryDrag(event.dataTransfer);
    const target = reference(node);
    const paths = sources ? [] : externalFilePaths(event.dataTransfer);
    if (!sources && !paths.length) return;
    if (!expanded.value.includes(nodeKey(node)))
      expanded.value = [...expanded.value, nodeKey(node)];
    await runOperation(
      sources
        ? { action: "move", target, sources }
        : { action: "move-external", target, paths },
    );
  } catch (error) {
    handleError(error, {
      id: "project.files.drop",
      title: t("project.files.operationFailed"),
    });
  }
}

// The main process owns the filesystem handles. The renderer describes visible
// directories plus parent directories of open project-file previews.
let pendingWatchedChanges = new Map<string, Set<string>>();
let isApplyingWatchedChanges = false;
let isUnmounted = false;
let syncWatchTimer: ReturnType<typeof setTimeout> | undefined;

const openFileDirectories = computed(() => {
  const projectId = activeProject.value?.id;
  if (!projectId) return [];
  return contentTabsStore.tabs.flatMap((tab) => {
    if (
      tab.kind !== "file" ||
      tab.source !== "project" ||
      tab.projectId !== projectId
    )
      return [];
    return [
      {
        folderId: tab.folderId,
        relativePath: projectFileDirectory(tab.relativePath),
      },
    ];
  });
});

function watchTargets(folderId: string): string[] {
  const directories = new Set<string>([""]);

  function collect(node: ProjectTreeNode): void {
    if (
      node.folderId !== folderId ||
      node.kind !== "directory" ||
      node.isUnavailable ||
      node.isPlaceholder
    )
      return;
    const isExpanded = expanded.value.includes(nodeKey(node));
    if (!node.isRoot && isExpanded) directories.add(node.relativePath);
    if (!isExpanded) return;
    for (const child of node.children ?? []) collect(child);
  }

  const root = items.value.find((node) => node.folderId === folderId);
  if (root) collect(root);
  return [...directories];
}

function watchedDirectories(folderId: string): string[] {
  const directories = new Set(watchTargets(folderId));
  for (const target of openFileDirectories.value) {
    if (target.folderId === folderId) directories.add(target.relativePath);
  }
  return [...directories];
}

function syncWatchSet(): void {
  if (isUnmounted || !isCurrentProject.value) return;
  const project = activeProject.value;
  const folders =
    project?.folders
      .filter((folder) => folder.isAvailable)
      .map((folder) => ({
        folderId: folder.id,
        projectId: project.id,
        directories: watchedDirectories(folder.id),
      })) ?? [];
  void window.pine.setWatchedProjectDirectories({ folders }).catch(() => {
    // Watcher failures never break the tree; manual refresh still works.
  });
}

function scheduleWatchSync(): void {
  if (isUnmounted) return;
  clearTimeout(syncWatchTimer);
  syncWatchTimer = setTimeout(syncWatchSet, 100);
}

function onWatcherEvent(event: ProjectFilesChangedEvent): void {
  const projectId = activeProject.value?.id;
  for (const {
    folderId,
    projectId: changedProjectId,
    changedDirs,
  } of event.folders) {
    if (changedProjectId !== projectId) continue;
    const pending = pendingWatchedChanges.get(folderId) ?? new Set<string>();
    for (const dir of changedDirs) pending.add(dir);
    pendingWatchedChanges.set(folderId, pending);
  }
  void flushWatchedChanges();
}

async function flushWatchedChanges(): Promise<void> {
  if (isApplyingWatchedChanges || pendingWatchedChanges.size === 0) return;
  isApplyingWatchedChanges = true;
  try {
    while (!isUnmounted && pendingWatchedChanges.size > 0) {
      const changes = pendingWatchedChanges;
      pendingWatchedChanges = new Map();
      await applyWatchedChanges(changes);
    }
  } catch (error) {
    handleError(error, {
      id: "project.files.watcher-refresh",
      title: t("errors.projectFiles.title"),
    });
  } finally {
    isApplyingWatchedChanges = false;
    scheduleWatchSync();
    if (!isUnmounted && pendingWatchedChanges.size > 0)
      void flushWatchedChanges();
  }
}

async function applyWatchedChanges(
  changes: Map<string, Set<string>>,
): Promise<void> {
  const currentGeneration = generation;
  const targets: ProjectTreeNode[] = [];

  function collect(node: ProjectTreeNode): void {
    const pending = changes.get(node.folderId);
    if (
      node.kind === "directory" &&
      !node.isUnavailable &&
      !node.isPlaceholder &&
      pending?.has(node.relativePath) &&
      (node.isRoot || expanded.value.includes(nodeKey(node)))
    ) {
      targets.push(node);
      return;
    }
    for (const child of node.children ?? []) collect(child);
  }
  for (const root of items.value) collect(root);

  async function reload(node: ProjectTreeNode): Promise<void> {
    const children = await readDirectory(node.folderId, node.relativePath);
    if (currentGeneration !== generation) return;
    node.children = children;
    await Promise.all(
      node.children
        .filter(
          (child) =>
            child.kind === "directory" &&
            expanded.value.includes(nodeKey(child)),
        )
        .map(reload),
    );
  }

  await Promise.all(targets.map(reload));
}

const unsubscribeWatcher = window.pine.onProjectFilesChanged(onWatcherEvent);
// Reset only when the project's folders change, not on every metadata save.
watch(
  () =>
    JSON.stringify(
      activeProject.value?.folders.map(({ id, isAvailable, name, path }) => ({
        id,
        isAvailable,
        name,
        path,
      })) ?? null,
    ),
  resetRoots,
  { immediate: true },
);
// A hidden project's tree stops watching; catch up when it is shown again.
watch(isCurrentProject, (current, wasCurrent) => {
  if (!current || wasCurrent === undefined) return;
  void refresh()
    .catch(() => undefined)
    .finally(scheduleWatchSync);
});
watch(
  [() => activeProject.value, isCurrentProject, expanded, openFileDirectories],
  () => scheduleWatchSync(),
  {
    immediate: true,
    flush: "post",
  },
);
onUnmounted(() => {
  isUnmounted = true;
  generation += 1;
  unsubscribeLocalProjectFilesChanged();
  unsubscribeWatcher();
  clearTimeout(syncWatchTimer);
  activeRowAnimations.forEach((animation) => animation.cancel());
  pendingWatchedChanges.clear();
  if (!isCurrentProject.value) return;
  void window.pine.setWatchedProjectDirectories({ folders: [] }).catch(() => {
    // The renderer may already be shutting down.
  });
});
</script>

<template>
  <Empty v-if="items.length === 0" class="p-6">
    <EmptyHeader>
      <EmptyTitle>{{ t("project.files.emptyTitle") }}</EmptyTitle>
      <EmptyDescription>
        {{ t("project.files.emptyDescription") }}
      </EmptyDescription>
    </EmptyHeader>
  </Empty>

  <TreeRoot
    v-else
    ref="treeRoot"
    :expanded="expanded"
    :items="items"
    :get-key="nodeKey"
    :get-children="(item) => item.children"
    class="scroll-fade no-scrollbar relative h-full overflow-y-auto p-2 outline-none"
    @dragover="
      (event: DragEvent) => {
        const root = items.find(
          (node) => node.folderId === activeProject?.defaultFolderId,
        );
        if (root) dragOver(event, root);
      }
    "
    @drop="
      (event: DragEvent) => {
        const root = items.find(
          (node) => node.folderId === activeProject?.defaultFolderId,
        );
        if (root) drop(event, root);
      }
    "
    @dragleave="dropTarget = undefined"
    @update:expanded="handleExpandedChange"
  >
    <TreeVirtualizer
      v-slot="{ item }"
      :estimate-size="28"
      :overscan="12"
      :text-content="(node) => node.name"
      class="overflow-hidden"
      :class="{
        'transition-[height] duration-500 ease-out-expo motion-reduce:transition-none':
          disclosureAnimationsEnabled,
      }"
    >
      <TreeItem
        v-if="isProjectTreeNode(item.value)"
        v-bind="item.bind"
        v-slot="{ isExpanded }"
        class="flex h-7 w-full items-center gap-1 rounded-lg px-2 text-sm outline-none hover:bg-sidebar-accent data-[context-open]:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring data-[selected]:bg-sidebar-accent"
        :draggable="
          !item.value.isPlaceholder && !item.value.isUnavailable && !busy
        "
        :data-path="item.value.relativePath"
        :data-tree-key="nodeKey(item.value)"
        :data-context-open="
          contextTarget === nodeKey(item.value) ? '' : undefined
        "
        :class="{
          'bg-sidebar-accent ring-1 ring-sidebar-ring':
            dropTarget === nodeKey(item.value),
        }"
        :disabled="item.value.isPlaceholder || item.value.isUnavailable"
        @dragstart="startDrag($event, item.value)"
        @dragover="dragOver($event, item.value)"
        @dragleave="dropTarget = undefined"
        @dragend="dropTarget = undefined"
        @drop="drop($event, item.value)"
        :style="{ paddingInlineStart: `${(item.level - 1) * 12 + 8}px` }"
        @toggle="handleTreeToggle($event, item.value)"
        @click="previewFile(item.value)"
      >
        <ContextMenu
          @update:open="
            (open) => {
              contextTarget =
                open && isProjectTreeNode(item.value)
                  ? nodeKey(item.value)
                  : undefined;
            }
          "
        >
          <ContextMenuTrigger
            as-child
            :disabled="item.value.isPlaceholder || item.value.isUnavailable"
          >
            <div
              data-tree-item-content
              class="flex h-full min-w-0 flex-1 items-center gap-1"
            >
              <template v-if="item.value.isPlaceholder">
                <Skeleton class="h-4 w-24" />
              </template>
              <template v-else>
                <ChevronRight
                  v-if="
                    item.value.kind === 'directory' && !item.value.isUnavailable
                  "
                  class="size-4 shrink-0"
                  :class="{
                    'transition-transform duration-500 ease-out-expo motion-reduce:transition-none':
                      disclosureAnimationsEnabled,
                    'rotate-90': isExpanded,
                  }"
                />
                <span v-else class="size-4 shrink-0" />
                <FolderOpen
                  v-if="item.value.kind === 'directory' && isExpanded"
                  class="size-4 shrink-0"
                />
                <Folder
                  v-else-if="item.value.kind === 'directory'"
                  class="size-4 shrink-0"
                />
                <component
                  :is="fileIcon(item.value.name)"
                  v-else
                  class="size-4 shrink-0"
                  aria-hidden="true"
                />
                <span class="truncate">{{ item.value.name }}</span>
                <Badge
                  v-if="item.value.isUnavailable"
                  class="ml-auto"
                  variant="destructive"
                >
                  {{ t("projects.unavailable") }}
                </Badge>
              </template>
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent class="w-48 [&_[data-inset]]:pl-8">
            <ContextMenuGroup>
              <ContextMenuItem
                inset
                :disabled="busy"
                @select="
                  runOperation({
                    action: 'open',
                    target: reference(item.value),
                  })
                "
                >{{ t("project.files.open") }}</ContextMenuItem
              >
              <ContextMenuItem
                inset
                :disabled="busy"
                @select="
                  runOperation({
                    action: 'reveal',
                    target: reference(item.value),
                  })
                "
                >{{ t("project.files.reveal") }}</ContextMenuItem
              >
              <ContextMenuItem
                inset
                :disabled="busy"
                @select="
                  runOperation({
                    action: 'copy-path',
                    target: reference(item.value),
                  })
                "
                >{{ t("project.files.copyPath") }}</ContextMenuItem
              >
            </ContextMenuGroup>
            <ContextMenuSeparator />
            <ContextMenuGroup>
              <ContextMenuItem
                :disabled="busy || !writable(item.value)"
                @select="showDialog('newFolder', item.value)"
                ><FolderPlus />{{
                  t("project.files.newFolder")
                }}</ContextMenuItem
              >
              <ContextMenuItem
                :disabled="busy || !writable(item.value) || item.value.isRoot"
                @select="showDialog('rename', item.value)"
                ><Pencil />{{ t("project.files.rename") }}</ContextMenuItem
              >
            </ContextMenuGroup>
            <ContextMenuSeparator />
            <ContextMenuItem
              inset
              :disabled="busy"
              @select="
                refresh().catch((error) =>
                  handleError(error, {
                    id: 'project.files.refresh',
                    title: t('errors.projectFiles.title'),
                  }),
                )
              "
              >{{ t("project.files.refresh") }}</ContextMenuItem
            >
            <ContextMenuItem
              variant="destructive"
              :disabled="busy || !writable(item.value) || item.value.isRoot"
              @select="showDialog('trash', item.value)"
              ><Trash2 />{{ t("project.files.trash") }}</ContextMenuItem
            >
          </ContextMenuContent>
        </ContextMenu>
      </TreeItem>
    </TreeVirtualizer>
  </TreeRoot>

  <Dialog
    :open="!!dialog"
    @update:open="
      (open) => {
        if (!open && !busy) dialog = undefined;
      }
    "
  >
    <DialogContent
      :show-close-button="!busy"
      @interact-outside="
        (event) => {
          if (busy) event.preventDefault();
        }
      "
      @escape-key-down="
        (event) => {
          if (busy) event.preventDefault();
        }
      "
    >
      <DialogHeader>
        <DialogTitle>{{
          dialog ? t(`project.files.${dialog.mode}`) : ""
        }}</DialogTitle>
        <DialogDescription>{{
          dialog?.mode === "trash"
            ? t("project.files.trashDescription", { name: dialog.node.name })
            : t("project.files.nameDescription")
        }}</DialogDescription>
      </DialogHeader>
      <form class="flex flex-col gap-4" @submit.prevent="submitDialog">
        <Field v-if="dialog?.mode !== 'trash'">
          <FieldLabel for="project-entry-name">{{
            t("project.files.name")
          }}</FieldLabel>
          <Input
            id="project-entry-name"
            v-model="entryName"
            :disabled="busy"
            autocomplete="off"
          />
        </Field>
        <p v-if="operationError" role="alert" class="text-sm text-destructive">
          {{ operationError }}
        </p>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            :disabled="busy"
            @click="dialog = undefined"
            >{{ t("common.cancel") }}</Button
          >
          <Button
            type="submit"
            :variant="dialog?.mode === 'trash' ? 'destructive' : 'default'"
            :disabled="busy || (dialog?.mode !== 'trash' && !validName)"
            >{{
              dialog?.mode === "trash"
                ? t("project.files.trash")
                : t("common.save")
            }}</Button
          >
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
