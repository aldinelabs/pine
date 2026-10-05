<script setup lang="ts">
import {
  Files,
  GitCommitHorizontal,
  Info,
  MessagesSquare,
  Settings2,
} from "@lucide/vue";
import { storeToRefs } from "pinia";
import { computed, onMounted, ref, watch } from "vue";
import {
  useProjectSidebarStore,
  type ProjectSidebarTab,
} from "@/stores/projectSidebar";
import { useI18n } from "vue-i18n";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useProjectDisplayName } from "@/composables/useProjectDisplayName";
import { isTemporaryWorkspace } from "@/shared/projects";
import { useProjectStore } from "@/stores/project";
import { useUpdaterStore } from "@/stores/updater";
import { PINE_RELEASES_URL } from "@/shared/window";
import AllProjectsSessionList from "./AllProjectsSessionList.vue";
import ProjectFileTree from "./ProjectFileTree.vue";
import ProjectSessionList from "./ProjectSessionList.vue";
import ProjectScope from "./ProjectScope.vue";
import RetainedPanel from "./RetainedPanel.vue";

const { t } = useI18n();
const emit = defineEmits<{
  editProject: [];
  searchSessions: [];
  showUpdate: [];
}>();
const projectStore = useProjectStore();
const { activeProject, currentProjectId, openProjectIds } =
  storeToRefs(projectStore);
const displayName = useProjectDisplayName();
/**
 * Every project open in this window keeps its sidebar mounted, so switching
 * tabs between projects only swaps which one is visible.
 */
const sidebarProjectIds = computed(() =>
  [...openProjectIds.value].filter((id) => projectStore.projectById(id)),
);
const { isAvailable } = storeToRefs(useUpdaterStore());
// A failed version lookup simply hides the version item.
const pineVersion = ref<string | null>(null);
onMounted(() => {
  window.pine
    .getAppVersion()
    .then((version) => {
      pineVersion.value = version;
    })
    .catch(() => undefined);
});

function openReleases(): void {
  void window.pine.openExternalUrl(PINE_RELEASES_URL);
}
const sidebarStore = useProjectSidebarStore();
const activeTab = computed<ProjectSidebarTab>({
  get: () => sidebarStore.stateFor(currentProjectId.value).tab,
  set: (tab) => sidebarStore.setTab(currentProjectId.value, tab),
});
// No Project has no files of its own worth browsing first; its sidebar
// always lands on the sessions of every project.
watch(
  currentProjectId,
  (projectId) => {
    if (isTemporaryWorkspace(projectId))
      sidebarStore.setTab(projectId, "sessions");
  },
  { immediate: true },
);
</script>

<template>
  <Sidebar collapsible="offcanvas">
    <div
      aria-hidden="true"
      class="window-drag h-[var(--window-titlebar-height)] shrink-0"
    />
    <Tabs v-model="activeTab" class="flex min-h-0 flex-1 flex-col">
      <SidebarHeader>
        <div class="truncate px-2 text-sm font-medium">
          {{ displayName(activeProject) }}
        </div>
        <TabsList class="w-full">
          <TabsTrigger value="files">
            <Files data-icon="inline-start" aria-hidden="true" />
            {{ t("project.tabs.files") }}
          </TabsTrigger>
          <TabsTrigger value="sessions">
            <MessagesSquare data-icon="inline-start" aria-hidden="true" />
            {{ t("project.tabs.sessions") }}
          </TabsTrigger>
        </TabsList>
      </SidebarHeader>

      <SidebarContent class="relative overflow-hidden">
        <TabsContent value="files" force-mount as-child>
          <RetainedPanel :active="activeTab === 'files'">
            <RetainedPanel
              v-for="projectId in sidebarProjectIds"
              :key="projectId"
              :active="projectId === currentProjectId"
            >
              <ProjectScope :project-id="projectId">
                <ProjectFileTree />
              </ProjectScope>
            </RetainedPanel>
          </RetainedPanel>
        </TabsContent>
        <TabsContent value="sessions" force-mount as-child>
          <RetainedPanel :active="activeTab === 'sessions'">
            <RetainedPanel
              v-for="projectId in sidebarProjectIds"
              :key="projectId"
              :active="projectId === currentProjectId"
            >
              <AllProjectsSessionList
                v-if="isTemporaryWorkspace(projectId)"
                @search="emit('searchSessions')"
              />
              <ProjectScope v-else :project-id="projectId">
                <ProjectSessionList @search="emit('searchSessions')" />
              </ProjectScope>
            </RetainedPanel>
          </RetainedPanel>
        </TabsContent>
      </SidebarContent>
    </Tabs>

    <SidebarFooter>
      <SidebarMenu>
        <SidebarMenuItem v-if="!isTemporaryWorkspace(currentProjectId)">
          <SidebarMenuButton @click="emit('editProject')">
            <Settings2 aria-hidden="true" />
            <span>{{ t("project.preferences") }}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem v-if="isAvailable">
          <SidebarMenuButton
            class="text-info hover:text-info"
            @click="emit('showUpdate')"
          >
            <Info aria-hidden="true" />
            <span>{{ t("updater.sidebar") }}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem v-else-if="pineVersion">
          <SidebarMenuButton data-testid="pine-version" @click="openReleases">
            <GitCommitHorizontal aria-hidden="true" />
            <span>{{ t("project.version", { version: pineVersion }) }}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarFooter>

    <SidebarRail />
  </Sidebar>
</template>
