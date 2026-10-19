<script setup lang="ts">
import { onKeyStroke } from "@vueuse/core";
import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  useTemplateRef,
  watch,
} from "vue";
import { useI18n } from "vue-i18n";
import { handleError } from "@/app/errors/errorHandler";
import { PineLogo } from "@/components/pine";
import PinePreferencesDialog from "@/components/preferences/PinePreferencesDialog.vue";
import SessionSearchOverlay from "@/components/sessions/SessionSearchOverlay.vue";
import ProjectContentTabs from "@/components/project/ProjectContentTabs.vue";
import ProjectDialog from "@/components/project/ProjectDialog.vue";
import ProjectSidebar from "@/components/project/ProjectSidebar.vue";
import PineUpdateDialog from "@/components/updates/PineUpdateDialog.vue";
import WindowTitleBar from "@/components/window/WindowTitleBar.vue";
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
import { useProjectSidebarVisibilityStore } from "@/stores/projectSidebarVisibility";
import { useFrozenWindowResize } from "@/composables/useFrozenWindowResize";

const { t } = useI18n();
const isSessionSearchOpen = ref(false);
const isProjectSettingsOpen = ref(false);
// Only one titlebar position renders the preferences dialog per platform.
const preferencesDialog =
  useTemplateRef<InstanceType<typeof PinePreferencesDialog>>(
    "preferencesDialog",
  );
const isUpdateOpen = ref(false);
const sidebar = useProjectSidebarVisibilityStore();
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
      title: t("errors.projectList.title"),
      description: t("errors.projectList.description"),
    });
    return;
  }
  // Restored tabs of a project deleted meanwhile cannot open again.
  const known = new Set(projectStore.projects.map((project) => project.id));
  for (const projectId of new Set([
    ...contentTabsStore.tabs.map((tab) => tab.projectId),
    contentTabsStore.lastDraftProjectId,
  ])) {
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

// While the sidebar slides with the window, the content keeps its width and
// is pushed along, so its right edge rides the moving window edge.
const inset = useTemplateRef<InstanceType<typeof SidebarInset>>("inset");
const frozenInsetWidth = ref<number | null>(null);
const frozenInsetStyle = computed(() =>
  frozenInsetWidth.value === null
    ? undefined
    : { width: `${frozenInsetWidth.value}px`, flex: "none" },
);

function freezeInset(): void {
  const element: unknown = inset.value?.$el;
  if (element instanceof HTMLElement)
    frozenInsetWidth.value = element.offsetWidth;
}

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

/** Rides the right edge of a narrowing window inwards. */
function followShrinkingWindow(delta: number): void {
  isTrailingControlsAnimated.value = true;
  trailingControlsShift.value = delta;
}

function resetTrailingControls(): void {
  isTrailingControlsAnimated.value = false;
  trailingControlsShift.value = 0;
}

/**
 * Every sidebar toggle (trigger, rail, Cmd/Ctrl+B) lands here: the window
 * gains or gives back the sidebar's width at its right edge while the
 * sidebar's own transition, on the window's timeline, pushes the content.
 */
async function setSidebarOpen(open: boolean): Promise<void> {
  if (frozenResize.isResizing.value || open === sidebar.open) return;
  const resized = await frozenResize.run(
    { kind: "toggle-sidebar", open },
    {
      beforeCommit: (delta) => {
        freezeInset();
        if (open) growingWindowHooks.beforeCommit(delta);
      },
      onCommitStart: (delta) => {
        sidebar.setOpen(open);
        if (open) growingWindowHooks.onCommitStart();
        else followShrinkingWindow(delta);
      },
      afterCommit: () => {
        frozenInsetWidth.value = null;
        resetTrailingControls();
      },
    },
  );
  frozenInsetWidth.value = null;
  resetTrailingControls();
  if (!resized) sidebar.setOpen(open);
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
  const open = sidebar.open;
  await frozenResize.run(
    { kind: "fit-sidebar", open },
    open
      ? { ...growingWindowHooks, afterCommit: resetTrailingControls }
      : {
          onCommitStart: followShrinkingWindow,
          afterCommit: resetTrailingControls,
        },
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
  <!-- Controlled without a v-model: setSidebarOpen decides when the open
       state changes, so the window can resize around it first. -->
  <SidebarProvider
    class="relative h-full min-h-0 [&_[data-slot=sidebar-container]]:delay-(--window-resize-delay) [&_[data-slot=sidebar-container]]:duration-500 [&_[data-slot=sidebar-container]]:ease-out-expo [&_[data-slot=sidebar-gap]]:delay-(--window-resize-delay) [&_[data-slot=sidebar-gap]]:duration-500 [&_[data-slot=sidebar-gap]]:ease-out-expo"
    :style="frozenLayoutStyle"
    :open="sidebar.open"
    @update:open="setSidebarOpen"
  >
    <ProjectSidebar
      @edit-project="isProjectSettingsOpen = true"
      @manage-projects="preferencesDialog?.open('projects')"
      @search-sessions="isSessionSearchOpen = true"
      @show-update="isUpdateOpen = true"
    />

    <SidebarInset
      ref="inset"
      class="min-h-0 overflow-hidden"
      :style="frozenInsetStyle"
    >
      <ProjectContentTabs />
    </SidebarInset>

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
        <PinePreferencesDialog
          v-if="isWindowsPlatform"
          ref="preferencesDialog"
        />
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
          <PinePreferencesDialog
            v-if="!isWindowsPlatform"
            ref="preferencesDialog"
          />
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
