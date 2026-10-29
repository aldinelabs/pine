<script setup lang="ts">
import { Plus, Search } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { handleError } from "@/app/errors/errorHandler";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
import SessionContextMenu from "@/components/sessions/SessionContextMenu.vue";
import SessionDeleteDialog from "@/components/sessions/SessionDeleteDialog.vue";
import SessionRenameDialog from "@/components/sessions/SessionRenameDialog.vue";
import { useContentTabNavigation } from "@/composables/useContentTabNavigation";
import { useDraftProjectOpener } from "@/composables/useDraftProjectOpener";
import { useProjectDisplayName } from "@/composables/useProjectDisplayName";
import { useSessionExport } from "@/composables/useSessionExport";
import { projectIconComponent } from "@/lib/projectIcons";
import { writeSessionDrag } from "@/lib/sessionDrag";
import { TEMPORARY_WORKSPACE_PROJECT_ID } from "@/shared/projects";
import type { ProjectSessionSearchResult } from "@/shared/sessions";
import { useProjectStore } from "@/stores/project";
import { useSessionHistoryStore } from "@/stores/sessionHistory";
import { useSessionStore } from "@/stores/session";

/**
 * Project history composed from the native collapsible sidebar menu.
 * Sessions open in their own project, regardless of the active tab.
 */
const emit = defineEmits<{ search: [] }>();
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
    const limit = historyStore.visibleCount(project.id);
    const visible = recent.filter(
      (session, index) => index < limit || session.id === activeSessionId.value,
    );
    return { project, visible, hasMore: visible.length < recent.length };
  });
});

// Returning to a conversation through another tab reveals its project.
watch(
  [() => activeSessionTab.value?.id, () => activeSessionTab.value?.projectId],
  () => {
    const projectId = activeSessionTab.value?.projectId;
    if (projectId) historyStore.setOpen(projectId, true);
  },
  { immediate: true },
);
const sessionPendingDelete = ref<ProjectSessionSearchResult | null>(null);
const isDeleteDialogOpen = ref(false);
const sessionPendingRename = ref<ProjectSessionSearchResult | null>(null);
const isRenameDialogOpen = ref(false);

watch(isDeleteDialogOpen, (open) => {
  if (!open) sessionPendingDelete.value = null;
});
watch(isRenameDialogOpen, (open) => {
  if (!open) sessionPendingRename.value = null;
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

function startDrag(event: DragEvent, session: ProjectSessionSearchResult) {
  if (event.dataTransfer) writeSessionDrag(event.dataTransfer, session);
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <SidebarGroup class="shrink-0">
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
                  <CollapsibleTrigger as-child>
                    <SidebarMenuButton
                      class="group-has-data-[sidebar=menu-action]/menu-item:pr-3"
                      :data-project-toggle="group.project.id"
                      :title="displayName(group.project)"
                    >
                      <component
                        :is="projectIconComponent(group.project)"
                        aria-hidden="true"
                      />
                      <span
                        class="min-w-0 flex-1 truncate group-focus-within/project:pr-5 group-hover/project:pr-5"
                        >{{ displayName(group.project) }}</span
                      >
                    </SidebarMenuButton>
                  </CollapsibleTrigger>
                  <SidebarMenuAction
                    show-on-hover
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
                  <CollapsibleContent>
                    <SidebarMenuSub class="mr-0 translate-x-0 border-l-0 pr-0">
                      <SidebarMenuSubItem
                        v-for="session in group.visible"
                        :key="session.id"
                        @dragstart="startDrag($event, session)"
                      >
                        <SessionContextMenu
                          :groups="[]"
                          :session="session"
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
                          @delete="
                            withProject(session, () => {
                              sessionPendingDelete = session;
                              isDeleteDialogOpen = true;
                            })
                          "
                        >
                          <SidebarMenuSubButton
                            as="button"
                            class="w-full translate-x-0"
                            :data-session-id="session.id"
                            :data-project-id="session.projectId"
                            :draggable="true"
                            :is-active="session.id === activeSessionId"
                            :title="sessionTitle(session)"
                            @click="openSession(session)"
                          >
                            <span>{{ sessionTitle(session) }}</span>
                          </SidebarMenuSubButton>
                        </SessionContextMenu>
                      </SidebarMenuSubItem>
                      <SidebarMenuSubItem v-if="group.hasMore">
                        <SidebarMenuSubButton
                          as="button"
                          class="w-full translate-x-0"
                          :data-project-show-more="group.project.id"
                          @click="historyStore.showMore(group.project.id)"
                        >
                          <span>{{ t("sessions.showMore") }}</span>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                      <SidebarMenuSubItem v-if="!group.visible.length">
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

    <SessionDeleteDialog
      v-model:open="isDeleteDialogOpen"
      :session="sessionPendingDelete"
    />
    <SessionRenameDialog
      v-model:open="isRenameDialogOpen"
      :session="sessionPendingRename"
    />
  </div>
</template>
