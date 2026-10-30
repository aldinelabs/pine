<script setup lang="ts">
import { Blocks, Library } from "@lucide/vue";
import { useTemplateRef } from "vue";
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
import ModifierShortcut from "@/components/window/ModifierShortcut.vue";
import { useSidebarGlassWidth } from "@/composables/useSidebarGlassWidth";
import AllProjectsSessionList from "./AllProjectsSessionList.vue";

const { t } = useI18n();
const emit = defineEmits<{
  manageProjects: [];
  manageSkills: [];
  manageMcp: [];
  searchSessions: [];
}>();

const sidebar = useTemplateRef<InstanceType<typeof Sidebar>>("sidebar");
useSidebarGlassWidth(() => {
  const element: unknown = sidebar.value?.$el;
  return element instanceof HTMLElement ? element : undefined;
});
</script>

<template>
  <Sidebar ref="sidebar" collapsible="offcanvas">
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
            <ModifierShortcut class="ml-auto" key-label="S" />
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton
            data-testid="manage-mcp"
            @click="emit('manageMcp')"
          >
            <Blocks aria-hidden="true" />
            <span>{{ t("mcp.title") }}</span>
            <ModifierShortcut class="ml-auto" key-label="L" />
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarFooter>

    <SidebarRail />
  </Sidebar>
</template>
