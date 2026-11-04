<script setup lang="ts">
import { Blocks, Library, Workflow } from "@lucide/vue";
import { useTemplateRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import ModifierShortcut from "@/components/window/ModifierShortcut.vue";
import { useSidebarGlassWidth } from "@/composables/useSidebarGlassWidth";
import { useContentTabNavigation } from "@/composables/useContentTabNavigation";
import { useAutomationsStore } from "@/stores/automations";
import AllProjectsSessionList from "./AllProjectsSessionList.vue";

const { t } = useI18n();
const emit = defineEmits<{
  manageProjects: [];
  manageSkills: [];
  manageMcp: [];
  manageAutomations: [];
  searchSessions: [];
}>();
const automations = useAutomationsStore();

// On a phone the sidebar is a sheet over the content. It steps aside once
// a tab opens or one of its dialogs takes over the screen.
const { setOpenMobile } = useSidebar();
const { activeTab } = useContentTabNavigation();
// Opening a session can reuse the empty draft tab, so the session counts too.
watch(
  () => {
    const tab = activeTab.value;
    return tab && "sessionId" in tab ? `${tab.id}:${tab.sessionId}` : tab?.id;
  },
  () => setOpenMobile(false),
);

/** Hands the screen to a dialog the sidebar opens. */
function handOff(open: () => void): void {
  setOpenMobile(false);
  open();
}

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
        @search="handOff(() => emit('searchSessions'))"
        @manage-projects="handOff(() => emit('manageProjects'))"
      />
    </SidebarContent>

    <SidebarFooter>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            data-testid="manage-automations"
            @click="handOff(() => emit('manageAutomations'))"
          >
            <Workflow aria-hidden="true" />
            <span>{{ t("automations.title") }}</span>
            <ModifierShortcut class="ml-auto" key-label="U" />
          </SidebarMenuButton>
          <SidebarMenuBadge
            v-if="automations.unread + automations.approvals.length > 0"
            data-testid="automation-unread"
            >{{
              automations.unread + automations.approvals.length
            }}</SidebarMenuBadge
          >
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton
            data-testid="manage-skills"
            @click="handOff(() => emit('manageSkills'))"
          >
            <Library aria-hidden="true" />
            <span>{{ t("project.skills") }}</span>
            <ModifierShortcut class="ml-auto" key-label="S" />
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton
            data-testid="manage-mcp"
            @click="handOff(() => emit('manageMcp'))"
          >
            <Blocks aria-hidden="true" />
            <span>{{ t("mcp.title") }}</span>
            <ModifierShortcut class="ml-auto" key-label="/" />
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarFooter>

    <SidebarRail />
  </Sidebar>
</template>
