<script setup lang="ts">
import { PanelRight } from "@lucide/vue";
import { onKeyStroke } from "@vueuse/core";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { handleError } from "@/app/errors/errorHandler";
import { PineLogo } from "@/components/pine";
import PinePreferencesDialog from "@/components/preferences/PinePreferencesDialog.vue";
import SessionSearchOverlay from "@/components/sessions/SessionSearchOverlay.vue";
import ProjectBackgroundTaskPanel from "@/components/project/ProjectBackgroundTaskPanel.vue";
import ProjectContentTabs from "@/components/project/ProjectContentTabs.vue";
import ProjectDialog from "@/components/project/ProjectDialog.vue";
import ProjectRightSidebar from "@/components/project/ProjectRightSidebar.vue";
import ProjectRightSidebarTools from "@/components/project/ProjectRightSidebarTools.vue";
import ProjectSidebar from "@/components/project/ProjectSidebar.vue";
import ProjectTodoPanel from "@/components/project/ProjectTodoPanel.vue";
import PineUpdateDialog from "@/components/updates/PineUpdateDialog.vue";
import WindowTitleBar from "@/components/window/WindowTitleBar.vue";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { isTemporaryWorkspace } from "@/shared/projects";
import { useBackgroundTasksStore } from "@/stores/backgroundTasks";
import { useContentTabsStore } from "@/stores/contentTabs";
import { useProjectStore } from "@/stores/project";
import { useSessionStore } from "@/stores/session";
import { useProjectRightSidebarStore } from "@/stores/projectRightSidebar";
import { useFrozenWindowResize } from "@/composables/useFrozenWindowResize";

const { t } = useI18n();
const isSessionSearchOpen = ref(false);
const isProjectSettingsOpen = ref(false);
const isUpdateOpen = ref(false);
const rightSidebar = useProjectRightSidebarStore();
const projectStore = useProjectStore();
const backgroundTasks = useBackgroundTasksStore();
const sessionStore = useSessionStore();
const contentTabsStore = useContentTabsStore();
const isWindowsPlatform = computed(() => window.pine?.platform === "win32");
/** The settings dialog edits the active tab's project, never the built-in one. */
const editableProject = computed(() =>
  projectStore.activeProject &&
  !isTemporaryWorkspace(projectStore.activeProject.id)
    ? projectStore.activeProject
    : null,
);

async function loadProjects(): Promise<void> {
  try {
    await projectStore.loadProjects();
  } catch (error) {
    handleError(error, {
      id: "project.list",
      title: t("errors.projectOpen.title"),
      description: t("errors.projectOpen.description"),
    });
    return;
  }
  // Restored tabs of a project deleted meanwhile cannot open again.
  const known = new Set(projectStore.projects.map((project) => project.id));
  for (const projectId of new Set(
    contentTabsStore.tabs.map((tab) => tab.projectId),
  )) {
    if (!known.has(projectId)) contentTabsStore.removeProject(projectId);
  }
}

/**
 * A project stays open while a tab uses it, and for a grace period after,
 * so closing and reopening a tab is instant. Idle projects without running
 * or waiting sessions are then released; the temporary workspace never is,
 * because every new draft starts there.
 */
const PROJECT_RELEASE_DELAY_MS = 60_000;
const unusedSince = new Map<string, number>();
function releaseUnusedProjects(): void {
  const used = new Set([
    projectStore.currentProjectId,
    ...contentTabsStore.tabs.map((tab) => tab.projectId),
  ]);
  const now = Date.now();
  for (const projectId of projectStore.openProjectIds) {
    if (used.has(projectId) || isTemporaryWorkspace(projectId)) {
      unusedSince.delete(projectId);
      continue;
    }
    const since = unusedSince.get(projectId) ?? now;
    unusedSince.set(projectId, since);
    if (now - since < PROJECT_RELEASE_DELAY_MS) continue;
    if (sessionStore.hasActiveWork(projectId)) continue;
    unusedSince.delete(projectId);
    void projectStore.closeProject(projectId).catch(() => undefined);
  }
}
const releaseTimer = window.setInterval(
  releaseUnusedProjects,
  PROJECT_RELEASE_DELAY_MS / 4,
);
onBeforeUnmount(() => window.clearInterval(releaseTimer));

// While the window animates, the right sidebar switches state without its
// CSS transition: the moving window edge reveals or clips it instead.
const isRightSidebarInstant = ref(false);
const frozenResize = useFrozenWindowResize();
const frozenLayoutStyle = computed(() =>
  frozenResize.frozenWidth.value === null
    ? undefined
    : {
        width: `${frozenResize.frozenWidth.value}px`,
        flex: "none",
        // Fixed sidebar containers lay out against the frozen box too.
        contain: "layout",
        "--window-resize-delay": `${frozenResize.transitionDelay.value}ms`,
      },
);

// The trailing window controls sit at the frozen layout's right edge. A
// transform with the window's own duration and easing keeps them on the
// moving window edge without reflowing anything.
const trailingControlsShift = ref(0);
const isTrailingControlsAnimated = ref(false);
const trailingControlsStyle = computed(() =>
  trailingControlsShift.value === 0 && !isTrailingControlsAnimated.value
    ? undefined
    : { transform: `translateX(${trailingControlsShift.value}px)` },
);

/** Starts at the visible edge of a widening window and rides it outwards. */
const growingWindowHooks = {
  beforeCommit: (delta: number) => {
    trailingControlsShift.value = -delta;
  },
  onCommitStart: () => {
    isTrailingControlsAnimated.value = true;
    trailingControlsShift.value = 0;
  },
};

function resetTrailingControls(): void {
  isTrailingControlsAnimated.value = false;
  trailingControlsShift.value = 0;
}

async function toggleRightSidebar(): Promise<void> {
  if (frozenResize.isResizing.value) return;
  const open = !rightSidebar.open;
  const setInstantly = () => {
    isRightSidebarInstant.value = true;
    rightSidebar.setOpen(open);
  };
  const resized = await frozenResize.run(
    { kind: "toggle-right-sidebar", open },
    open
      ? {
          beforeCommit: (delta) => {
            setInstantly();
            growingWindowHooks.beforeCommit(delta);
          },
          onCommitStart: growingWindowHooks.onCommitStart,
          afterCommit: resetTrailingControls,
        }
      : {
          onCommitStart: (delta) => {
            rightSidebar.setClosing(true);
            isTrailingControlsAnimated.value = true;
            trailingControlsShift.value = delta;
          },
          afterCommit: () => {
            setInstantly();
            rightSidebar.setClosing(false);
            resetTrailingControls();
          },
        },
  );
  isRightSidebarInstant.value = false;
  rightSidebar.setClosing(false);
  resetTrailingControls();
  if (!resized) rightSidebar.setOpen(open);
}

onBeforeUnmount(() => backgroundTasks.disconnect());
watch(
  () => sessionStore.activeSession?.id,
  (sessionId) => {
    if (sessionId) void backgroundTasks.load(sessionId).catch(() => undefined);
  },
  { immediate: true },
);

onMounted(async () => {
  backgroundTasks.connect();
  sessionStore.connectAgentEvents();
  void loadProjects();
  await window.pine?.setWindowLayout?.("project");
  if (!rightSidebar.open) return;
  await frozenResize.run(
    { kind: "fit-right-sidebar" },
    { ...growingWindowHooks, afterCommit: resetTrailingControls },
  );
  resetTrailingControls();
});

onKeyStroke("k", (event) => {
  if (!(event.metaKey || event.ctrlKey)) return;
  event.preventDefault();
  isSessionSearchOpen.value = true;
});
</script>

<template>
  <SidebarProvider
    class="relative h-full min-h-0 [&_[data-slot=sidebar-container]]:duration-500 [&_[data-slot=sidebar-container]]:ease-out-expo [&_[data-slot=sidebar-gap]]:duration-500 [&_[data-slot=sidebar-gap]]:ease-out-expo"
    :style="frozenLayoutStyle"
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
    <SidebarProvider
      :class="[
        'min-h-0 w-auto flex-none',
        isRightSidebarInstant &&
          '[&_[data-slot=sidebar-container]]:transition-none! [&_[data-slot=sidebar-gap]]:transition-none!',
      ]"
      :open="rightSidebar.open"
    >
      <ProjectRightSidebar>
        <!-- Like the left session list, keep section spacing inside one
             container so SidebarContent's gap does not surround separators. -->
        <div class="flex min-h-0 flex-1 flex-col">
          <div
            class="scroll-fade-y no-scrollbar min-h-0 flex-1 overflow-y-auto"
          >
            <ProjectTodoPanel />
          </div>
          <Separator />
          <div
            class="scroll-fade-y no-scrollbar min-h-0 flex-1 overflow-y-auto"
          >
            <ProjectBackgroundTaskPanel />
          </div>
        </div>
        <template #footer>
          <ProjectRightSidebarTools />
        </template>
      </ProjectRightSidebar>
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
      </template>
      <template #trailing>
        <div
          data-testid="project-trailing-controls"
          :class="[
            'flex items-center gap-1',
            isTrailingControlsAnimated &&
              'transition-transform delay-(--window-resize-delay) duration-500 ease-out-expo',
          ]"
          :style="trailingControlsStyle"
        >
          <Button
            data-testid="project-right-sidebar-toggle"
            variant="ghost"
            size="icon-sm"
            :aria-label="t('project.toggleRightSidebar')"
            :aria-pressed="rightSidebar.open"
            :title="t('project.toggleRightSidebar')"
            @click="toggleRightSidebar"
          >
            <PanelRight aria-hidden="true" />
          </Button>
          <PinePreferencesDialog v-if="!isWindowsPlatform" />
        </div>
      </template>
    </WindowTitleBar>

    <SessionSearchOverlay v-model:open="isSessionSearchOpen" />
    <PineUpdateDialog v-model:open="isUpdateOpen" />
    <ProjectDialog
      v-if="editableProject"
      v-model:open="isProjectSettingsOpen"
      :project="editableProject"
    />
  </SidebarProvider>
</template>
