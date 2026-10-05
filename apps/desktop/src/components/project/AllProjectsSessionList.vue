<script setup lang="ts">
import { Plus, Search } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { handleError } from "@/app/errors/errorHandler";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
} from "@/components/ui/sidebar";
import SessionContextMenu from "@/components/sessions/SessionContextMenu.vue";
import SessionDeleteDialog from "@/components/sessions/SessionDeleteDialog.vue";
import SessionRenameDialog from "@/components/sessions/SessionRenameDialog.vue";
import { useContentTabNavigation } from "@/composables/useContentTabNavigation";
import { useDraftProjectOpener } from "@/composables/useDraftProjectOpener";
import { useProjectDisplayName } from "@/composables/useProjectDisplayName";
import { useSessionExport } from "@/composables/useSessionExport";
import { projectIconComponent } from "@/lib/projectIcons";
import { groupSessionsByDate } from "@/lib/sessionDateGroups";
import { writeSessionDrag } from "@/lib/sessionDrag";
import { TEMPORARY_WORKSPACE_PROJECT_ID } from "@/shared/projects";
import type { ProjectSessionSearchResult } from "@/shared/sessions";
import { useProjectStore } from "@/stores/project";
import { useSessionStore } from "@/stores/session";

/**
 * No Project's session list: the newest sessions of every project, each
 * labelled with the project it belongs to. Sessions open in their project.
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

const nowMs = ref(Date.now());
// A project that was deleted elsewhere drops out with its sessions.
const sessions = computed(() =>
  allRecentSessions.value.filter((session) =>
    projectStore.projectById(session.projectId),
  ),
);
const dateGroups = computed(() =>
  groupSessionsByDate(sessions.value, nowMs.value, t),
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

function projectOf(session: ProjectSessionSearchResult) {
  return projectStore.projectById(session.projectId);
}

async function load(): Promise<void> {
  try {
    await sessionStore.loadAllRecent();
    nowMs.value = Date.now();
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

    <SidebarGroup v-else-if="sessions.length === 0" class="flex-1">
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
        <SidebarGroup v-for="group in dateGroups" :key="group.key">
          <SidebarGroupLabel>{{ group.label }}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem
                v-for="session in group.sessions"
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
                    withProject(session, () => void exportSession(session.id))
                  "
                  @delete="
                    withProject(session, () => {
                      sessionPendingDelete = session;
                      isDeleteDialogOpen = true;
                    })
                  "
                >
                  <SidebarMenuButton
                    size="lg"
                    class="min-w-0"
                    :data-session-id="session.id"
                    :data-project-id="session.projectId"
                    :draggable="true"
                    :is-active="
                      activeSessionTab?.state === 'bound' &&
                      session.id === activeSessionTab.sessionId
                    "
                    @click="openSession(session)"
                  >
                    <span class="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span class="truncate">{{ sessionTitle(session) }}</span>
                      <span
                        data-slot="session-project"
                        class="flex min-w-0 items-center gap-1 text-xs text-muted-foreground"
                      >
                        <component
                          :is="projectIconComponent(projectOf(session))"
                          class="size-3 shrink-0"
                          aria-hidden="true"
                        />
                        <span class="truncate">
                          {{ displayName(projectOf(session)) }}
                        </span>
                      </span>
                    </span>
                  </SidebarMenuButton>
                </SessionContextMenu>
              </SidebarMenuItem>
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
