<script setup lang="ts">
import {
  Folder,
  FolderKanban,
  FolderOpen,
  FolderPlus,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "@lucide/vue";
import { useEventListener } from "@vueuse/core";
import { storeToRefs } from "pinia";
import { computed, ref, watch } from "vue";
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
import { Separator } from "@/components/ui/separator";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuAction,
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
import { useContentTabNavigation } from "@/composables/useContentTabNavigation";
import { useDraftProjectOpener } from "@/composables/useDraftProjectOpener";
import { useProjectDisplayName } from "@/composables/useProjectDisplayName";
import { useSessionExport } from "@/composables/useSessionExport";
import { DURATION_MS, EASE_OUT_EXPO } from "@/lib/motion";
import { projectIconComponent } from "@/lib/projectIcons";
import { writeSessionDrag } from "@/lib/sessionDrag";
import {
  isTemporaryWorkspace,
  TEMPORARY_WORKSPACE_PROJECT_ID,
  type PineProject,
  type PineSessionGroup,
} from "@/shared/projects";
import type { ProjectSessionSearchResult } from "@/shared/sessions";
import { useProjectStore } from "@/stores/project";
import { useSessionHistoryStore } from "@/stores/sessionHistory";
import { useSessionStore } from "@/stores/session";

/**
 * Project history composed from the native collapsible sidebar menu, with
 * each project's session folders nested above its loose sessions.
 * Sessions open in their own project, regardless of the active tab.
 */
const emit = defineEmits<{ search: []; manageProjects: [] }>();
const { t } = useI18n();
const tabNavigation = useContentTabNavigation();
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
    const recent = byProject.get(project.id) ?? [];
    const groups = project.sessionGroups ?? [];
    const folders = groups.map((group) => {
      const sessionIds = new Set(group.sessionIds);
      return {
        group,
        sessions: recent.filter((session) => sessionIds.has(session.id)),
      };
    });
    const filed = new Set(groups.flatMap((group) => group.sessionIds));
    const loose = recent.filter((session) => !filed.has(session.id));
    const limit = historyStore.visibleCount(project.id);
    const visible = loose.filter(
      (session, index) => index < limit || session.id === activeSessionId.value,
    );
    return {
      project,
      groups,
      folders,
      visible,
      hasMore: visible.length < loose.length,
    };
  });
});

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
    const group = sessionId && groupOfSession(projectId, sessionId);
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
  return session.name || session.preview || t("sessions.newSession");
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

async function openSession(session: ProjectSessionSearchResult) {
  if (await openProject(session.projectId))
    tabNavigation.openSession(session, session.projectId);
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
      ? [...current, { id: crypto.randomUUID(), name, sessionIds: [] }]
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
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              data-testid="manage-projects"
              @click="emit('manageProjects')"
            >
              <FolderKanban aria-hidden="true" />
              <span>{{ t("preferences.sections.projects") }}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>

    <Separator />

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
        class="h-full [&_[data-slot=scroll-area-viewport]]:scroll-fade"
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
                          class="group-has-data-[sidebar=menu-action]/menu-item:pr-3"
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
                                v-for="session in folder.sessions"
                                :key="session.id"
                                :groups="group.groups"
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
                              <SidebarMenuSubItem
                                v-if="!folder.sessions.length"
                              >
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
                        v-for="session in group.visible"
                        :key="session.id"
                        :groups="group.groups"
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
