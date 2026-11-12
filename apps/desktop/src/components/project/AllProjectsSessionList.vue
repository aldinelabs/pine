<script setup lang="ts">
import {
  Blocks,
  Ellipsis,
  Folder,
  FolderKanban,
  FolderOpen,
  FolderPlus,
  Library,
  Pencil,
  Plus,
  Search,
  Trash2,
  Workflow,
} from "@lucide/vue";
import { useDebounceFn, useEventListener } from "@vueuse/core";
import { storeToRefs } from "pinia";
import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  watch,
} from "vue";
import { useI18n } from "vue-i18n";
import { handleError } from "@/app/errors/errorHandler";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import ProjectDeleteDialog from "@/components/project/ProjectDeleteDialog.vue";
import ProjectDialog from "@/components/project/ProjectDialog.vue";
import SessionHistoryItem from "@/components/project/SessionHistoryItem.vue";
import SessionDeleteDialog from "@/components/sessions/SessionDeleteDialog.vue";
import SessionGroupDeleteDialog from "@/components/sessions/SessionGroupDeleteDialog.vue";
import SessionGroupDialog from "@/components/sessions/SessionGroupDialog.vue";
import SessionRenameDialog from "@/components/sessions/SessionRenameDialog.vue";
import ModifierShortcut from "@/components/window/ModifierShortcut.vue";
import { useContentTabNavigation } from "@/composables/useContentTabNavigation";
import { useDraftProjectOpener } from "@/composables/useDraftProjectOpener";
import { useProjectDisplayName } from "@/composables/useProjectDisplayName";
import { useSessionExport } from "@/composables/useSessionExport";
import { DURATION_MS, EASE_OUT_EXPO } from "@/lib/motion";
import { projectIconComponent } from "@/lib/projectIcons";
import { randomId } from "@/lib/randomId";
import { writeSessionDrag } from "@/lib/sessionDrag";
import {
  isTemporaryWorkspace,
  TEMPORARY_WORKSPACE_PROJECT_ID,
  type PineLibraryChange,
  type PineProject,
  type PineSessionGroup,
} from "@/shared/projects";
import type { ProjectSessionSearchResult } from "@/shared/sessions";
import { withoutRelayPrefix } from "@/shared/sessions";
import { useAutomationsStore } from "@/stores/automations";
import { useProjectStore } from "@/stores/project";
import { useSessionHistoryStore } from "@/stores/sessionHistory";
import { useSessionStore } from "@/stores/session";

/**
 * Project history composed from the native collapsible sidebar menu, with
 * each project's session folders nested above its loose sessions.
 * Sessions open in their own project, regardless of the active tab.
 */
const emit = defineEmits<{
  search: [];
  manageProjects: [];
  manageAutomations: [];
  manageSkills: [];
  manageMcp: [];
}>();
const { t } = useI18n();
const tabNavigation = useContentTabNavigation();

// The managers live behind "More", so their count stays visible on it while
// the submenu is closed.
const automations = useAutomationsStore();
const moreOpen = ref(false);
const unreadAutomations = computed(
  () => automations.unread + automations.approvals.length,
);

/** Picking a manager closes the menu it came from before the dialog opens. */
function pick(open: () => void): void {
  moreOpen.value = false;
  open();
}
const { activeSessionTab } = tabNavigation;
const projectStore = useProjectStore();
const sessionStore = useSessionStore();
const { allRecentSessions, isLoadingAllRecent } = storeToRefs(sessionStore);
const openProject = useDraftProjectOpener();
const displayName = useProjectDisplayName();
const { exportSession } = useSessionExport();

const historyStore = useSessionHistoryStore();
// A project that was deleted elsewhere drops out with its sessions.
const sessions = computed(() =>
  allRecentSessions.value.filter((session) =>
    projectStore.projectById(session.projectId),
  ),
);
const activeSessionId = computed(() =>
  activeSessionTab.value?.state === "bound"
    ? activeSessionTab.value.sessionId
    : null,
);
const projectGroups = computed(() => {
  const byProject = new Map<string, ProjectSessionSearchResult[]>();
  for (const session of sessions.value) {
    const list = byProject.get(session.projectId) ?? [];
    list.push(session);
    byProject.set(session.projectId, list);
  }
  // Keep the project's existing order stable as sessions receive updates.
  return projectStore.projects.map((project) => {
    const all = byProject.get(project.id) ?? [];
    const parents = project.sessionParents ?? {};
    const listed = new Set(all.map((session) => session.id));
    // A sub-session sits under its parent while the parent is listed too.
    const subSessions = new Map<string, ProjectSessionSearchResult[]>();
    for (const session of all) {
      const parent = parents[session.id];
      if (!parent || !listed.has(parent)) continue;
      subSessions.set(parent, [...(subSessions.get(parent) ?? []), session]);
    }
    const recent = all.filter(
      (session) => !listed.has(parents[session.id] ?? ""),
    );
    const rowsOf = (list: ProjectSessionSearchResult[]): SessionRow[] =>
      list.flatMap((session) => {
        const children = subSessions.get(session.id) ?? [];
        const row = {
          session,
          depth: 0,
          subSessionCount: children.length,
        };
        if (!children.length || !historyStore.isOpen(session.id)) return [row];
        return [
          row,
          ...children.map((child) => ({
            session: child,
            depth: 1,
            subSessionCount: 0,
          })),
        ];
      });
    const groups = project.sessionGroups ?? [];
    const folders = groups.map((group) => {
      const sessionIds = new Set(group.sessionIds);
      return {
        group,
        rows: rowsOf(recent.filter((session) => sessionIds.has(session.id))),
      };
    });
    const filed = new Set(groups.flatMap((group) => group.sessionIds));
    const loose = recent.filter((session) => !filed.has(session.id));
    const limit = historyStore.visibleCount(project.id);
    const activeParent = activeSessionId.value
      ? parents[activeSessionId.value]
      : undefined;
    const visible = loose.filter(
      (session, index) =>
        index < limit ||
        session.id === activeSessionId.value ||
        session.id === activeParent,
    );
    return {
      project,
      groups,
      folders,
      visible: rowsOf(visible),
      hasMore: visible.length < loose.length,
    };
  });
});

/*
 * Rows fold in when they appear in a list and fold out when they leave it.
 * Web Animations on each row, not TransitionGroup: TransitionGroup reads every
 * row's position during each update, and each forced style pass here costs
 * about 20ms, which made every expand or collapse in the sidebar lag ~200ms.
 */
type RowMotion = "enter" | "leave";
type DisplayRow = SessionRow & { motion?: RowMotion };

const prefersReducedMotion = () =>
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
/** Rows that left a list, kept at their old place while they fold out. */
interface LeavingRow {
  row: SessionRow;
  index: number;
}
const leavingRows = shallowRef(new Map<string, LeavingRow[]>());
const enteringIds = shallowRef(new Set<string>());
let previousRows = new Map<string, SessionRow[]>();

watch(projectGroups, (groups) => {
  const next = new Map<string, SessionRow[]>();
  for (const group of groups) {
    next.set(group.project.id, group.visible);
    for (const folder of group.folders) next.set(folder.group.id, folder.rows);
  }
  const animate = !prefersReducedMotion();
  for (const [listId, rows] of animate ? next : []) {
    const before = previousRows.get(listId);
    if (!before) continue;
    const now = new Set(rows.map((row) => row.session.id));
    const then = new Set(before.map((row) => row.session.id));
    before.forEach((row, index) => {
      if (!now.has(row.session.id)) foldOut(listId, row, index);
    });
    for (const row of rows)
      if (!then.has(row.session.id)) foldIn(row.session.id);
  }
  previousRows = next;
});

function foldOut(listId: string, row: SessionRow, index: number) {
  const entry = { row, index };
  const sessionId = row.session.id;
  const others = (list: LeavingRow[] = []) =>
    list.filter((item) => item.row.session.id !== sessionId);
  const map = new Map(leavingRows.value);
  map.set(listId, [...others(map.get(listId)), entry]);
  leavingRows.value = map;
  setTimeout(() => {
    const after = new Map(leavingRows.value);
    // A later fold-out of the same row restarted the clock; it ends that one.
    if (!after.get(listId)?.includes(entry)) return;
    const rest = others(after.get(listId));
    if (rest.length) after.set(listId, rest);
    else after.delete(listId);
    leavingRows.value = after;
  }, DURATION_MS);
}

function foldIn(sessionId: string) {
  enteringIds.value = new Set(enteringIds.value).add(sessionId);
  setTimeout(() => {
    const after = new Set(enteringIds.value);
    after.delete(sessionId);
    enteringIds.value = after;
  }, DURATION_MS);
}

/** A list's rows plus the ones still folding out of it. */
function displayRows(listId: string, rows: SessionRow[]): DisplayRow[] {
  const shown: DisplayRow[] = rows.map((row) =>
    enteringIds.value.has(row.session.id) ? { ...row, motion: "enter" } : row,
  );
  const present = new Set(rows.map((row) => row.session.id));
  for (const { row, index } of leavingRows.value.get(listId) ?? [])
    if (!present.has(row.session.id))
      shown.splice(Math.min(index, shown.length), 0, {
        ...row,
        motion: "leave",
      });
  return shown;
}

interface SessionRow {
  session: ProjectSessionSearchResult;
  /** 1 for a sub-session under the session that started it. */
  depth: number;
  subSessionCount: number;
}

function parentOfSession(
  projectId: string,
  sessionId: string,
): string | undefined {
  return projectStore.projectById(projectId)?.sessionParents?.[sessionId];
}

/** Sub-sessions deleted together with the session. */
function subSessionIdsOf(session: ProjectSessionSearchResult | null): string[] {
  if (!session) return [];
  return Object.entries(
    projectStore.projectById(session.projectId)?.sessionParents ?? {},
  )
    .filter(([, parent]) => parent === session.id)
    .map(([child]) => child);
}

function groupsOf(projectId: string): PineSessionGroup[] {
  return projectStore.projectById(projectId)?.sessionGroups ?? [];
}

function groupOfSession(
  projectId: string,
  sessionId: string,
): PineSessionGroup | undefined {
  return groupsOf(projectId).find((group) =>
    group.sessionIds.includes(sessionId),
  );
}

// Returning to a conversation through another tab reveals its project and
// the folder it was filed in.
watch(
  [() => activeSessionTab.value?.id, () => activeSessionTab.value?.projectId],
  () => {
    const projectId = activeSessionTab.value?.projectId;
    if (!projectId) return;
    historyStore.setOpen(projectId, true);
    const sessionId = activeSessionId.value;
    const parent = sessionId && parentOfSession(projectId, sessionId);
    if (parent) historyStore.setOpen(parent, true);
    const filedId = parent || sessionId;
    const group = filedId && groupOfSession(projectId, filedId);
    if (group) historyStore.setOpen(group.id, true);
  },
  { immediate: true },
);
const projectPendingEdit = ref<PineProject | null>(null);
const isProjectDialogOpen = ref(false);
const projectPendingDelete = ref<PineProject | null>(null);
const isProjectDeleteDialogOpen = ref(false);
const sessionPendingDelete = ref<ProjectSessionSearchResult | null>(null);
const isDeleteDialogOpen = ref(false);
const sessionPendingRename = ref<ProjectSessionSearchResult | null>(null);
const isRenameDialogOpen = ref(false);
const groupDialogMode = ref<"create" | "rename">("create");
const groupDialogProjectId = ref<string | null>(null);
const groupPendingRename = ref<PineSessionGroup | null>(null);
const isGroupDialogOpen = ref(false);
const isSavingGroup = ref(false);
const groupPendingDelete = ref<{
  projectId: string;
  group: PineSessionGroup;
} | null>(null);
const isGroupDeleteDialogOpen = ref(false);
const isDeletingGroup = ref(false);

watch(isDeleteDialogOpen, (open) => {
  if (!open) sessionPendingDelete.value = null;
});
watch(isRenameDialogOpen, (open) => {
  if (!open) sessionPendingRename.value = null;
});
watch(isGroupDialogOpen, (open) => {
  if (!open) groupPendingRename.value = null;
});
watch(isGroupDeleteDialogOpen, (open) => {
  if (!open) groupPendingDelete.value = null;
});

function sessionTitle(session: ProjectSessionSearchResult): string {
  return (
    session.name ||
    session.automationRun?.name ||
    (session.preview && withoutRelayPrefix(session.preview)) ||
    t("sessions.newSession")
  );
}

async function load(): Promise<void> {
  try {
    await sessionStore.loadAllRecent();
  } catch (error) {
    handleError(error, {
      id: "sessions.sidebar.loadAll",
      title: t("errors.sessionSearch.title"),
      description: t("errors.sessionSearch.description"),
    });
  }
}

// Reload when projects are added or removed.
watch(
  () => projectStore.projects.map((project) => project.id).join(),
  () => void load(),
  { immediate: true },
);

// Sessions started, renamed or deleted in another window show here too. A
// burst of changes, such as a run's updates, reloads once.
const pendingChanges = new Set<PineLibraryChange>();
const reloadChanged = useDebounceFn(async () => {
  const projectsChanged = pendingChanges.has("projects");
  pendingChanges.clear();
  if (projectsChanged) await projectStore.loadProjects().catch(() => undefined);
  await load();
}, 250);
onMounted(() => {
  const stop = window.pine.onLibraryChanged?.((change) => {
    pendingChanges.add(change);
    void reloadChanged();
  });
  // Sessions deleted elsewhere, such as by the agent, close their tabs here.
  const stopDeleted = window.pine.onSessionsDeleted?.((sessionIds) => {
    for (const sessionId of sessionIds) {
      tabNavigation.removeSession(sessionId);
      sessionStore.forgetDeletedSession(sessionId);
    }
  });
  onBeforeUnmount(() => {
    stop?.();
    stopDeleted?.();
  });
});

async function openSession(session: ProjectSessionSearchResult) {
  if (await openProject(session.projectId))
    tabNavigation.openSession(session, session.projectId, {
      preview: true,
    });
}

/** Session actions run in the session's project, so open it first. */
async function withProject(
  session: ProjectSessionSearchResult,
  action: () => void,
): Promise<void> {
  if (await openProject(session.projectId)) action();
}

function requestCreateGroup(projectId: string): void {
  groupDialogMode.value = "create";
  groupDialogProjectId.value = projectId;
  groupPendingRename.value = null;
  isGroupDialogOpen.value = true;
}

function requestProjectEdit(project: PineProject): void {
  projectPendingEdit.value = project;
  isProjectDialogOpen.value = true;
}

function requestProjectDeletion(project: PineProject): void {
  projectPendingDelete.value = project;
  isProjectDeleteDialogOpen.value = true;
}

function requestGroupRename(projectId: string, group: PineSessionGroup): void {
  groupDialogMode.value = "rename";
  groupDialogProjectId.value = projectId;
  groupPendingRename.value = group;
  isGroupDialogOpen.value = true;
}

function requestGroupDeletion(projectId: string, group: PineSessionGroup) {
  groupPendingDelete.value = { projectId, group };
  isGroupDeleteDialogOpen.value = true;
}

async function saveGroup(name: string): Promise<void> {
  const projectId = groupDialogProjectId.value;
  if (!projectId || isSavingGroup.value) return;

  const current = groupsOf(projectId);
  const groups =
    groupDialogMode.value === "create"
      ? [...current, { id: randomId(), name, sessionIds: [] }]
      : current.map((group) =>
          group.id === groupPendingRename.value?.id
            ? { ...group, name }
            : group,
        );

  isSavingGroup.value = true;
  try {
    await projectStore.updateSessionGroups(projectId, groups);
    // A new folder shows inside its project.
    historyStore.setOpen(projectId, true);
    isGroupDialogOpen.value = false;
  } catch (error) {
    handleError(error, {
      id: "sessions.group.save",
      title: t("errors.sessionRename.title"),
      description: t("errors.sessionRename.description"),
    });
  } finally {
    isSavingGroup.value = false;
  }
}

async function deleteGroup(): Promise<void> {
  const pending = groupPendingDelete.value;
  if (!pending || isDeletingGroup.value) return;

  isDeletingGroup.value = true;
  try {
    await projectStore.updateSessionGroups(
      pending.projectId,
      groupsOf(pending.projectId).filter(
        (group) => group.id !== pending.group.id,
      ),
    );
    isGroupDeleteDialogOpen.value = false;
  } catch (error) {
    handleError(error, {
      id: "sessions.group.delete",
      title: t("errors.sessionDelete.title"),
      description: t("errors.sessionDelete.description"),
    });
  } finally {
    isDeletingGroup.value = false;
  }
}

/** Files a session into one of its project's folders, or back out of them. */
async function moveSession(
  session: Pick<ProjectSessionSearchResult, "id" | "projectId">,
  groupId: string | null,
): Promise<void> {
  const groups = groupsOf(session.projectId).map((group) => ({
    ...group,
    sessionIds: group.sessionIds.filter((id) => id !== session.id),
  }));
  const target = groups.find((group) => group.id === groupId);
  if (target) target.sessionIds.push(session.id);

  try {
    await projectStore.updateSessionGroups(session.projectId, groups);
    if (target) historyStore.setOpen(target.id, true);
  } catch (error) {
    handleError(error, {
      id: "sessions.group.move",
      title: t("errors.sessionRename.title"),
      description: t("errors.sessionRename.description"),
    });
  }
}

// The payload is unreadable until drop, so the dragged row is kept here.
const draggingSession = ref<ProjectSessionSearchResult | null>(null);
/** The folder or project row a dragged session would land in. */
const dropTargetId = ref<string | null>(null);
useEventListener(window, "dragend", () => {
  draggingSession.value = null;
  dropTargetId.value = null;
});

function startDrag(event: DragEvent, session: ProjectSessionSearchResult) {
  if (!event.dataTransfer) return;
  writeSessionDrag(event.dataTransfer, session);
  draggingSession.value = session;
}

/** Sessions stay in their project: a folder or project row of another one ignores them. */
function canDrop(projectId: string, groupId: string | null): boolean {
  const session = draggingSession.value;
  if (session?.projectId !== projectId) return false;
  return groupOfSession(projectId, session.id)?.id !== (groupId ?? undefined);
}

function dragOver(
  event: DragEvent,
  projectId: string,
  groupId: string | null,
): void {
  if (!canDrop(projectId, groupId)) return;
  event.preventDefault();
  event.stopPropagation();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  dropTargetId.value = groupId ?? projectId;
}

function dragLeave(event: DragEvent): void {
  if (
    event.relatedTarget instanceof Node &&
    (event.currentTarget as HTMLElement).contains(event.relatedTarget)
  )
    return;
  dropTargetId.value = null;
}

function drop(event: DragEvent, projectId: string, groupId: string | null) {
  const session = draggingSession.value;
  if (!session || !canDrop(projectId, groupId)) return;
  event.preventDefault();
  event.stopPropagation();
  dropTargetId.value = null;
  draggingSession.value = null;
  void moveSession(session, groupId);
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <SidebarGroup class="shrink-0 pt-0.5">
      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton @click="emit('search')">
              <Search aria-hidden="true" />
              <span>{{ t("sessions.searchAction") }}</span>
              <ModifierShortcut class="ml-auto" key-label="K" />
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              :is-active="activeSessionTab?.state === 'draft'"
              @click="
                tabNavigation.createSessionTab({
                  projectId: TEMPORARY_WORKSPACE_PROJECT_ID,
                })
              "
            >
              <Plus aria-hidden="true" />
              <span>{{ t("sessions.newSession") }}</span>
              <ModifierShortcut class="ml-auto" key-label="N" />
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              data-testid="manage-projects"
              @click="emit('manageProjects')"
            >
              <FolderKanban aria-hidden="true" />
              <span>{{ t("preferences.sections.projects") }}</span>
              <ModifierShortcut class="ml-auto" key-label="P" />
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <Popover v-model:open="moreOpen">
              <PopoverTrigger as-child>
                <SidebarMenuButton
                  data-testid="sidebar-more"
                  :aria-expanded="moreOpen"
                >
                  <Ellipsis aria-hidden="true" />
                  <span>{{ t("sessions.moreSidebarMenu") }}</span>
                  <span
                    v-if="unreadAutomations > 0 && !moreOpen"
                    data-testid="automation-unread-summary"
                    class="ms-auto flex h-5 min-w-5 items-center justify-center rounded-xl bg-sidebar-primary px-1 text-xs font-medium text-sidebar-primary-foreground tabular-nums select-none"
                    >{{ unreadAutomations }}</span
                  >
                </SidebarMenuButton>
              </PopoverTrigger>
              <PopoverContent
                side="right"
                align="start"
                :side-offset="8"
                class="w-56 gap-0 p-1.5"
              >
                <SidebarMenu class="gap-0.5">
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      data-testid="manage-automations"
                      class="rounded-2xl"
                      @click="pick(() => emit('manageAutomations'))"
                    >
                      <Workflow aria-hidden="true" />
                      <span>{{ t("automations.title") }}</span>
                      <ModifierShortcut class="ml-auto" key-label="U" />
                    </SidebarMenuButton>
                    <SidebarMenuBadge
                      v-if="unreadAutomations > 0"
                      data-testid="automation-unread"
                      >{{ unreadAutomations }}</SidebarMenuBadge
                    >
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      data-testid="manage-skills"
                      class="rounded-2xl"
                      @click="pick(() => emit('manageSkills'))"
                    >
                      <Library aria-hidden="true" />
                      <span>{{ t("project.skills") }}</span>
                      <ModifierShortcut class="ml-auto" key-label="S" />
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      data-testid="manage-mcp"
                      class="rounded-2xl"
                      @click="pick(() => emit('manageMcp'))"
                    >
                      <Blocks aria-hidden="true" />
                      <span>{{ t("mcp.title") }}</span>
                      <ModifierShortcut class="ml-auto" key-label="/" />
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </PopoverContent>
            </Popover>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>

    <SidebarGroup v-if="isLoadingAllRecent && !sessions.length" class="flex-1">
      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarMenuItem v-for="index in 5" :key="index">
            <SidebarMenuSkeleton />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>

    <SidebarGroup v-else-if="projectGroups.length === 0" class="flex-1">
      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton disabled>
              <span>{{ t("sessions.noSessions") }}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>

    <div v-else class="min-h-0 flex-1">
      <ScrollArea
        class="h-full [&_[data-slot=scroll-area-scrollbar]]:hidden [&_[data-slot=scroll-area-viewport]]:scroll-fade"
      >
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <Collapsible
                v-for="group in projectGroups"
                :key="group.project.id"
                as-child
                :open="historyStore.isOpen(group.project.id)"
                @update:open="historyStore.setOpen(group.project.id, $event)"
              >
                <SidebarMenuItem class="group/project">
                  <!-- The no-project workspace can be neither edited nor deleted. -->
                  <ContextMenu>
                    <ContextMenuTrigger
                      as-child
                      :disabled="isTemporaryWorkspace(group.project.id)"
                    >
                      <CollapsibleTrigger as-child>
                        <SidebarMenuButton
                          class="text-muted-foreground group-has-data-[sidebar=menu-action]/menu-item:pr-3"
                          :class="{
                            'bg-sidebar-accent ring-1 ring-sidebar-ring':
                              dropTargetId === group.project.id,
                          }"
                          :data-project-toggle="group.project.id"
                          :title="displayName(group.project)"
                          @dragenter="dragOver($event, group.project.id, null)"
                          @dragover="dragOver($event, group.project.id, null)"
                          @dragleave="dragLeave"
                          @drop="drop($event, group.project.id, null)"
                        >
                          <component
                            :is="projectIconComponent(group.project)"
                            aria-hidden="true"
                          />
                          <span
                            class="min-w-0 flex-1 truncate group-focus-within/project:pr-10 group-hover/project:pr-10"
                            >{{ displayName(group.project) }}</span
                          >
                        </SidebarMenuButton>
                      </CollapsibleTrigger>
                    </ContextMenuTrigger>
                    <ContextMenuContent>
                      <ContextMenuGroup>
                        <ContextMenuItem
                          data-project-action="edit"
                          @select="requestProjectEdit(group.project)"
                        >
                          <Pencil aria-hidden="true" />
                          {{ t("common.edit") }}
                        </ContextMenuItem>
                        <ContextMenuItem
                          data-project-action="delete"
                          variant="destructive"
                          @select="requestProjectDeletion(group.project)"
                        >
                          <Trash2 aria-hidden="true" />
                          {{ t("projects.deleteAction") }}
                        </ContextMenuItem>
                      </ContextMenuGroup>
                    </ContextMenuContent>
                  </ContextMenu>
                  <SidebarMenuAction
                    show-on-hover
                    class="right-8"
                    :data-project-new-group="group.project.id"
                    :aria-label="
                      t('sessions.newProjectGroup', {
                        project: displayName(group.project),
                      })
                    "
                    :title="t('sessions.createGroupAction')"
                    @click="requestCreateGroup(group.project.id)"
                  >
                    <FolderPlus aria-hidden="true" />
                  </SidebarMenuAction>
                  <SidebarMenuAction
                    show-on-hover
                    class="right-2"
                    :data-project-new-session="group.project.id"
                    :aria-label="
                      t('sessions.newProjectSession', {
                        project: displayName(group.project),
                      })
                    "
                    :title="t('sessions.newSession')"
                    @click="
                      tabNavigation.createSessionTab({
                        projectId: group.project.id,
                      })
                    "
                  >
                    <Plus aria-hidden="true" />
                  </SidebarMenuAction>
                  <CollapsibleContent
                    class="session-history-content overflow-hidden"
                    :style="{
                      animationDuration: `${DURATION_MS}ms`,
                      animationTimingFunction: EASE_OUT_EXPO,
                    }"
                  >
                    <SidebarMenuSub class="mr-0 translate-x-0 border-l-0 pr-0">
                      <Collapsible
                        v-for="folder in group.folders"
                        :key="folder.group.id"
                        as-child
                        :open="historyStore.isOpen(folder.group.id)"
                        @update:open="
                          historyStore.setOpen(folder.group.id, $event)
                        "
                      >
                        <SidebarMenuSubItem
                          :data-session-group-id="folder.group.id"
                          @dragenter="
                            dragOver($event, group.project.id, folder.group.id)
                          "
                          @dragover="
                            dragOver($event, group.project.id, folder.group.id)
                          "
                          @dragleave="dragLeave"
                          @drop="
                            drop($event, group.project.id, folder.group.id)
                          "
                        >
                          <ContextMenu>
                            <ContextMenuTrigger as-child>
                              <CollapsibleTrigger as-child>
                                <SidebarMenuSubButton
                                  as="button"
                                  class="w-full translate-x-0"
                                  :class="{
                                    'bg-sidebar-accent ring-1 ring-sidebar-ring':
                                      dropTargetId === folder.group.id,
                                  }"
                                  :data-session-group-toggle="folder.group.id"
                                  :title="folder.group.name"
                                >
                                  <FolderOpen
                                    v-if="historyStore.isOpen(folder.group.id)"
                                    aria-hidden="true"
                                  />
                                  <Folder v-else aria-hidden="true" />
                                  <span>{{ folder.group.name }}</span>
                                </SidebarMenuSubButton>
                              </CollapsibleTrigger>
                            </ContextMenuTrigger>
                            <ContextMenuContent>
                              <ContextMenuGroup>
                                <ContextMenuItem
                                  @select="
                                    requestGroupRename(
                                      group.project.id,
                                      folder.group,
                                    )
                                  "
                                >
                                  <Pencil aria-hidden="true" />
                                  {{ t("sessions.renameGroupAction") }}
                                </ContextMenuItem>
                                <ContextMenuItem
                                  variant="destructive"
                                  @select="
                                    requestGroupDeletion(
                                      group.project.id,
                                      folder.group,
                                    )
                                  "
                                >
                                  <Trash2 aria-hidden="true" />
                                  {{ t("sessions.deleteGroupAction") }}
                                </ContextMenuItem>
                              </ContextMenuGroup>
                            </ContextMenuContent>
                          </ContextMenu>
                          <CollapsibleContent
                            class="session-history-content overflow-hidden"
                            :style="{
                              animationDuration: `${DURATION_MS}ms`,
                              animationTimingFunction: EASE_OUT_EXPO,
                            }"
                          >
                            <SidebarMenuSub
                              class="mr-0 translate-x-0 border-l-0 pr-0"
                            >
                              <SessionHistoryItem
                                v-for="{
                                  session,
                                  depth,
                                  subSessionCount,
                                  motion,
                                } in displayRows(folder.group.id, folder.rows)"
                                :key="session.id"
                                :groups="depth ? [] : group.groups"
                                :depth="depth"
                                :sub-session-count="subSessionCount"
                                :motion="motion"
                                :expanded="historyStore.isOpen(session.id)"
                                @toggle="
                                  historyStore.setOpen(
                                    session.id,
                                    !historyStore.isOpen(session.id),
                                  )
                                "
                                :is-active="session.id === activeSessionId"
                                :session="session"
                                :title="sessionTitle(session)"
                                @dragstart="startDrag($event, session)"
                                @open="openSession(session)"
                                @rename="
                                  withProject(session, () => {
                                    sessionPendingRename = session;
                                    isRenameDialogOpen = true;
                                  })
                                "
                                @export="
                                  withProject(
                                    session,
                                    () => void exportSession(session.id),
                                  )
                                "
                                @move="moveSession(session, $event)"
                                @delete="
                                  withProject(session, () => {
                                    sessionPendingDelete = session;
                                    isDeleteDialogOpen = true;
                                  })
                                "
                              />
                              <SidebarMenuSubItem v-if="!folder.rows.length">
                                <SidebarMenuSubButton
                                  as="button"
                                  class="w-full translate-x-0"
                                  disabled
                                >
                                  <span>{{ t("sessions.emptyGroup") }}</span>
                                </SidebarMenuSubButton>
                              </SidebarMenuSubItem>
                            </SidebarMenuSub>
                          </CollapsibleContent>
                        </SidebarMenuSubItem>
                      </Collapsible>
                      <SessionHistoryItem
                        v-for="{
                          session,
                          depth,
                          subSessionCount,
                          motion,
                        } in displayRows(group.project.id, group.visible)"
                        :key="session.id"
                        :groups="depth ? [] : group.groups"
                        :depth="depth"
                        :sub-session-count="subSessionCount"
                        :motion="motion"
                        :expanded="historyStore.isOpen(session.id)"
                        @toggle="
                          historyStore.setOpen(
                            session.id,
                            !historyStore.isOpen(session.id),
                          )
                        "
                        :is-active="session.id === activeSessionId"
                        :session="session"
                        :title="sessionTitle(session)"
                        @dragstart="startDrag($event, session)"
                        @open="openSession(session)"
                        @rename="
                          withProject(session, () => {
                            sessionPendingRename = session;
                            isRenameDialogOpen = true;
                          })
                        "
                        @export="
                          withProject(
                            session,
                            () => void exportSession(session.id),
                          )
                        "
                        @move="moveSession(session, $event)"
                        @delete="
                          withProject(session, () => {
                            sessionPendingDelete = session;
                            isDeleteDialogOpen = true;
                          })
                        "
                      />
                      <SidebarMenuSubItem v-if="group.hasMore">
                        <SidebarMenuSubButton
                          as="button"
                          class="w-full translate-x-0 text-muted-foreground"
                          :data-project-show-more="group.project.id"
                          @click="historyStore.showMore(group.project.id)"
                        >
                          <span>{{ t("sessions.showMore") }}</span>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                      <SidebarMenuSubItem
                        v-if="!group.visible.length && !group.folders.length"
                      >
                        <SidebarMenuSubButton
                          as="button"
                          class="w-full translate-x-0"
                          disabled
                        >
                          <span>{{ t("sessions.noSessions") }}</span>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    </SidebarMenuSub>
                  </CollapsibleContent>
                </SidebarMenuItem>
              </Collapsible>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </ScrollArea>
    </div>

    <ProjectDialog
      v-model:open="isProjectDialogOpen"
      :project="projectPendingEdit"
    />
    <ProjectDeleteDialog
      v-model:open="isProjectDeleteDialogOpen"
      :project="projectPendingDelete"
    />
    <SessionDeleteDialog
      v-model:open="isDeleteDialogOpen"
      :session="sessionPendingDelete"
      :sub-session-ids="subSessionIdsOf(sessionPendingDelete)"
    />
    <SessionRenameDialog
      v-model:open="isRenameDialogOpen"
      :session="sessionPendingRename"
    />
    <SessionGroupDialog
      v-model:open="isGroupDialogOpen"
      :group="groupPendingRename"
      :mode="groupDialogMode"
      :is-saving="isSavingGroup"
      @submit="saveGroup"
    />
    <SessionGroupDeleteDialog
      v-model:open="isGroupDeleteDialogOpen"
      :group="groupPendingDelete?.group ?? null"
      :is-deleting="isDeletingGroup"
      @confirm="deleteGroup"
    />
  </div>
</template>

<style scoped>
.session-history-content[data-state="open"] {
  animation-name: session-history-expand;
}

.session-history-content[data-state="closed"] {
  animation-name: session-history-collapse;
}

@keyframes session-history-expand {
  from {
    height: 0;
    opacity: 0;
  }
  to {
    height: var(--reka-collapsible-content-height);
    opacity: 1;
  }
}

@keyframes session-history-collapse {
  from {
    height: var(--reka-collapsible-content-height);
    opacity: 1;
  }
  to {
    height: 0;
    opacity: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .session-history-content[data-state] {
    animation-name: none;
  }
}
</style>
