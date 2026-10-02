<script setup lang="ts">
import { Files, Info, MessagesSquare, Settings2 } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { computed, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
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
import { useProjectStore } from "@/stores/project";
import { useUpdaterStore } from "@/stores/updater";
import ProjectFileTree from "./ProjectFileTree.vue";
import ProjectSessionList from "./ProjectSessionList.vue";
import RetainedPanel from "./RetainedPanel.vue";

const { t } = useI18n();
const emit = defineEmits<{
  editProject: [];
  searchSessions: [];
  showUpdate: [];
}>();
const projectStore = useProjectStore();
const { activeProject } = storeToRefs(projectStore);
const { isAvailable } = storeToRefs(useUpdaterStore());
const sidebarStore = useProjectSidebarStore();
const route = useRoute();
const router = useRouter();
const activeTab = computed<ProjectSidebarTab>({
  get() {
    const requested = route.query.sidebar;
    if (
      route.params.projectId === activeProject.value?.id &&
      (requested === "files" || requested === "sessions")
    )
      return requested;
    return activeProject.value
      ? sidebarStore.stateFor(activeProject.value.id).tab
      : "sessions";
  },
  set(tab) {
    if (activeProject.value) sidebarStore.setTab(activeProject.value.id, tab);
    void router.replace({ query: { ...route.query, sidebar: tab } });
  },
});
watch(
  [() => activeProject.value?.id, activeTab],
  ([projectId, tab]) => {
    if (projectId) sidebarStore.setTab(projectId, tab);
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
          {{ activeProject?.name }}
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
          <RetainedPanel
            :key="activeProject?.id"
            :active="activeTab === 'files'"
          >
            <ProjectFileTree />
          </RetainedPanel>
        </TabsContent>
        <TabsContent value="sessions" force-mount as-child>
          <RetainedPanel
            :key="activeProject?.id"
            :active="activeTab === 'sessions'"
          >
            <ProjectSessionList @search="emit('searchSessions')" />
          </RetainedPanel>
        </TabsContent>
      </SidebarContent>
    </Tabs>

    <SidebarFooter>
      <SidebarMenu>
        <SidebarMenuItem v-if="isAvailable">
          <SidebarMenuButton
            class="text-info hover:text-info"
            @click="emit('showUpdate')"
          >
            <Info aria-hidden="true" />
            <span>{{ t("updater.sidebar") }}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton @click="emit('editProject')">
            <Settings2 aria-hidden="true" />
            <span>{{ t("project.preferences") }}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarFooter>

    <SidebarRail />
  </Sidebar>
</template>
