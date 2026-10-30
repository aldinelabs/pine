<script setup lang="ts">
import { Blocks, Info, Library } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { useI18n } from "vue-i18n";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { useUpdaterStore } from "@/stores/updater";
import AllProjectsSessionList from "./AllProjectsSessionList.vue";

const { t } = useI18n();
const emit = defineEmits<{
  manageProjects: [];
  manageSkills: [];
  manageMcp: [];
  searchSessions: [];
  showUpdate: [];
}>();
const { isAvailable } = storeToRefs(useUpdaterStore());
</script>

<template>
  <Sidebar collapsible="offcanvas">
    <div
      aria-hidden="true"
      class="window-drag h-[var(--window-titlebar-height)] shrink-0"
    />
    <!-- Project history stays available across conversation tabs. -->
    <SidebarContent class="overflow-hidden">
      <AllProjectsSessionList
        @search="emit('searchSessions')"
        @manage-projects="emit('manageProjects')"
      />
    </SidebarContent>

    <SidebarFooter>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            data-testid="manage-skills"
            @click="emit('manageSkills')"
          >
            <Library aria-hidden="true" />
            <span>{{ t("project.skills") }}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton
            data-testid="manage-mcp"
            @click="emit('manageMcp')"
          >
            <Blocks aria-hidden="true" />
            <span>{{ t("mcp.title") }}</span>
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
      </SidebarMenu>
    </SidebarFooter>

    <SidebarRail />
  </Sidebar>
</template>
