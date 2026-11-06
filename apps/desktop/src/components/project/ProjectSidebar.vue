<script setup lang="ts">
import { useTemplateRef, watch } from "vue";
import {
  Sidebar,
  SidebarContent,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { useSidebarGlassWidth } from "@/composables/useSidebarGlassWidth";
import { useContentTabNavigation } from "@/composables/useContentTabNavigation";
import AllProjectsSessionList from "./AllProjectsSessionList.vue";

const emit = defineEmits<{
  manageProjects: [];
  manageSkills: [];
  manageMcp: [];
  manageAutomations: [];
  searchSessions: [];
}>();

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
        @manage-automations="handOff(() => emit('manageAutomations'))"
        @manage-skills="handOff(() => emit('manageSkills'))"
        @manage-mcp="handOff(() => emit('manageMcp'))"
      />
    </SidebarContent>

    <SidebarRail />
  </Sidebar>
</template>
