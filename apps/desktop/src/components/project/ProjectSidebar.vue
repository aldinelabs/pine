<script setup lang="ts">
import { useTemplateRef, watch } from "vue";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { useSidebarGlassWidth } from "@/composables/useSidebarGlassWidth";
import { useContentTabNavigation } from "@/composables/useContentTabNavigation";
import UserSwitcher from "@/components/users/UserSwitcher.vue";
import { useUsersStore } from "@/stores/users";
import AllProjectsSessionList from "./AllProjectsSessionList.vue";

const emit = defineEmits<{
  manageProjects: [];
  manageUsers: [];
  manageSkills: [];
  manageMcp: [];
  manageMemory: [];
  manageAutomations: [];
  searchSessions: [];
}>();

const usersStore = useUsersStore();
// Decides whether the footer exists; a web client has no users.
void usersStore.load().catch(() => undefined);

// On a phone the sidebar is a sheet over the content. It steps aside once
// a tab opens or one of its dialogs takes over the screen.
const { isMobile, setOpenMobile } = useSidebar();
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
// The sidebar's root element changes between the sheet and the column, so
// the glass looks it up again whenever a narrow window switches between them.
useSidebarGlassWidth(() => {
  void isMobile.value;
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
        @manage-memory="handOff(() => emit('manageMemory'))"
      />
    </SidebarContent>

    <!-- Only with several users; one user sees no footer at all. -->
    <SidebarFooter v-if="usersStore.hasSeveralUsers" class="pt-0">
      <UserSwitcher @manage-users="handOff(() => emit('manageUsers'))" />
    </SidebarFooter>

    <SidebarRail />
  </Sidebar>
</template>
