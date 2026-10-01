<script setup lang="ts">
import { House, PanelRight } from "@lucide/vue";
import { onKeyStroke } from "@vueuse/core";
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { handleError } from "@/app/errors/errorHandler";
import { PineLogo } from "@/components/pine";
import PinePreferencesDialog from "@/components/preferences/PinePreferencesDialog.vue";
import SessionSearchOverlay from "@/components/sessions/SessionSearchOverlay.vue";
import ProjectContentTabs from "@/components/project/ProjectContentTabs.vue";
import ProjectDialog from "@/components/project/ProjectDialog.vue";
import ProjectRightSidebar from "@/components/project/ProjectRightSidebar.vue";
import ProjectSidebar from "@/components/project/ProjectSidebar.vue";
import PineUpdateDialog from "@/components/updates/PineUpdateDialog.vue";
import WindowTitleBar from "@/components/window/WindowTitleBar.vue";
import { Button } from "@/components/ui/button";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { ROUTE_NAMES } from "@/router/routes";
import { useProjectStore } from "@/stores/project";
import { useProjectRightSidebarStore } from "@/stores/projectRightSidebar";

const { t } = useI18n();
const router = useRouter();
const isSessionSearchOpen = ref(false);
const isProjectSettingsOpen = ref(false);
const isUpdateOpen = ref(false);
const rightSidebar = useProjectRightSidebarStore();
const projectStore = useProjectStore();
const isWindowsPlatform = computed(() => window.pine?.platform === "win32");

async function closeProject(): Promise<void> {
  try {
    await projectStore.closeProject();
  } catch (error) {
    handleError(error, {
      id: "project.close",
      title: t("errors.projectClose.title"),
      description: t("errors.projectClose.description"),
    });
    return;
  }

  await router.push({ name: ROUTE_NAMES.projects });
}

onKeyStroke("k", (event) => {
  if (!(event.metaKey || event.ctrlKey)) return;
  event.preventDefault();
  isSessionSearchOpen.value = true;
});
</script>

<template>
  <SidebarProvider
    class="relative h-full min-h-0 [&_[data-slot=sidebar-container]]:duration-500 [&_[data-slot=sidebar-container]]:ease-out-expo [&_[data-slot=sidebar-gap]]:duration-500 [&_[data-slot=sidebar-gap]]:ease-out-expo"
    :default-open="true"
  >
    <ProjectSidebar
      @edit-project="isProjectSettingsOpen = true"
      @search-sessions="isSessionSearchOpen = true"
      @show-update="isUpdateOpen = true"
    />

    <SidebarInset class="min-h-0 overflow-hidden">
      <ProjectContentTabs />
    </SidebarInset>

    <!-- A separate provider keeps useSidebar() inside the inset bound to the
         left sidebar. It is controlled without listening to update:open so
         the shared Cmd/Ctrl+B shortcut only toggles the left sidebar. -->
    <SidebarProvider class="min-h-0 w-auto flex-none" :open="rightSidebar.open">
      <ProjectRightSidebar />
    </SidebarProvider>

    <!-- Electron applies overlapping drag/no-drag regions in DOM order.
         Register window controls after the content titlebar's drag region. -->
    <WindowTitleBar controls-only>
      <template #leading>
        <span
          v-if="isWindowsPlatform"
          data-slot="window-titlebar-logo-slot"
          class="window-titlebar-icon-slot"
        >
          <PineLogo
            data-testid="windows-titlebar-logo"
            aria-hidden="true"
            class="pointer-events-none size-4 fill-current text-foreground select-none"
          />
        </span>
        <PinePreferencesDialog v-if="isWindowsPlatform" />
        <SidebarTrigger />
        <Button
          variant="ghost"
          size="icon-sm"
          :aria-label="t('project.closeProject')"
          :title="t('project.closeProject')"
          @click="closeProject"
        >
          <House aria-hidden="true" />
        </Button>
      </template>
      <template #trailing>
        <Button
          data-testid="project-right-sidebar-toggle"
          variant="ghost"
          size="icon-sm"
          :aria-label="t('project.toggleRightSidebar')"
          :aria-pressed="rightSidebar.open"
          :title="t('project.toggleRightSidebar')"
          @click="rightSidebar.toggle()"
        >
          <PanelRight aria-hidden="true" />
        </Button>
        <PinePreferencesDialog v-if="!isWindowsPlatform" />
      </template>
    </WindowTitleBar>

    <SessionSearchOverlay v-model:open="isSessionSearchOpen" />
    <PineUpdateDialog v-model:open="isUpdateOpen" />
    <ProjectDialog
      v-if="projectStore.activeProject"
      v-model:open="isProjectSettingsOpen"
      :project="projectStore.activeProject"
    />
  </SidebarProvider>
</template>
