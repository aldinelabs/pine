<script setup lang="ts">
import { PanelRight } from "@lucide/vue";
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
import ProjectBackgroundTaskInspector from "@/components/project/ProjectBackgroundTaskInspector.vue";
import ProjectContentTabs from "@/components/project/ProjectContentTabs.vue";
import ProjectSidebar from "@/components/project/ProjectSidebar.vue";
import PineUpdateDialog from "@/components/updates/PineUpdateDialog.vue";
import ProjectWorkbench from "@/components/workbench/ProjectWorkbench.vue";
import WindowTitleBar from "@/components/window/WindowTitleBar.vue";
import { Button } from "@/components/ui/button";
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
import { useWorkbenchEvents } from "@/composables/useWorkbenchEvents";
import { useWorkbenchStore } from "@/stores/workbench";

const { t } = useI18n();
const isSessionSearchOpen = ref(false);
// Only one titlebar position renders the preferences dialog per platform.
const preferencesDialog =
  useTemplateRef<InstanceType<typeof PinePreferencesDialog>>(
    "preferencesDialog",
  );
const isUpdateOpen = ref(false);
const sidebar = useProjectSidebarVisibilityStore();
const workbench = useWorkbenchStore();
useWorkbenchEvents();
const projectStore = useProjectStore();
const backgroundTasks = useBackgroundTasksStore();
const sessionStore = useSessionStore();
const contentTabsStore = useContentTabsStore();
const isWindowsPlatform = computed(() => window.pine?.platform === "win32");
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

// The trailing window controls and the workbench column sit at the frozen
// layout's right edge. A transform with the window's own duration and easing
// keeps them on the moving window edge without reflowing anything.
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
/**
 * While the left sidebar resizes the window, the workbench column rides the
 * window edge with the trailing controls. When the workbench itself resizes
 * it, the edge reveals or clips the column instead.
 */
const isWorkbenchOnWindowEdge = ref(false);

async function setSidebarOpen(open: boolean): Promise<void> {
  if (frozenResize.isResizing.value || open === sidebar.open) return;
  const resized = await frozenResize.run(
    { kind: "toggle-sidebar", open },
    {
      beforeCommit: (delta) => {
        freezeInset();
        isWorkbenchOnWindowEdge.value = true;
        if (open) growingWindowHooks.beforeCommit(delta);
      },
      onCommitStart: (delta) => {
        sidebar.setOpen(open);
        if (open) growingWindowHooks.onCommitStart();
        else followShrinkingWindow(delta);
      },
      afterCommit: () => {
        frozenInsetWidth.value = null;
        isWorkbenchOnWindowEdge.value = false;
        resetTrailingControls();
      },
    },
  );
  frozenInsetWidth.value = null;
  isWorkbenchOnWindowEdge.value = false;
  resetTrailingControls();
  if (!resized) sidebar.setOpen(open);
  void syncWorkbench();
}

// While the window animates, the workbench switches state without its CSS
// transition: the moving window edge reveals or clips it instead.
const isWorkbenchInstant = ref(false);

async function resizeWorkbench(open: boolean): Promise<void> {
  const setInstantly = () => {
    isWorkbenchInstant.value = true;
    workbench.setDisplayedOpen(open);
  };
  const resized = await frozenResize.run(
    { kind: "set-workbench", open, width: workbench.width },
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
            workbench.setClosing(true);
            followShrinkingWindow(delta);
          },
          afterCommit: () => {
            setInstantly();
            workbench.setClosing(false);
            resetTrailingControls();
          },
        },
  );
  isWorkbenchInstant.value = false;
  workbench.setClosing(false);
  resetTrailingControls();
  if (!resized) workbench.setDisplayedOpen(open);
}

/**
 * Brings the column in line with the active session's workbench. The user,
 * the agent, and switching sessions all change that layout; the window
 * follows one resize at a time and catches up on whatever changed meanwhile.
 */
let isWorkbenchReady = false;
async function syncWorkbench(force = false): Promise<void> {
  if (!isWorkbenchReady || frozenResize.isResizing.value) return;
  const open = workbench.activeLayout.open;
  if (!force && open === workbench.displayedOpen) return;
  await resizeWorkbench(open);
  if (workbench.activeLayout.open !== workbench.displayedOpen)
    void syncWorkbench();
}
watch(
  () => workbench.activeLayout.open,
  () => void syncWorkbench(),
);

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
  // Main remembers whether the window already holds the workbench, so a
  // reload neither adds its width twice nor leaves a closed one's width.
  isWorkbenchReady = true;
  await syncWorkbench(true);
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

    <!-- A separate provider keeps useSidebar() inside the inset bound to the
         left sidebar. It is controlled without listening to update:open so
         the shared Cmd/Ctrl+B shortcut only toggles the left sidebar. -->
    <SidebarProvider
      data-testid="project-workbench-provider"
      :class="[
        'min-h-0 w-auto flex-none',
        isWorkbenchOnWindowEdge &&
          '[&_[data-slot=sidebar-container]]:translate-x-(--window-edge-shift)',
        isWorkbenchOnWindowEdge &&
          isTrailingControlsAnimated &&
          '[&_[data-slot=sidebar-container]]:transition-[left,right,width,translate]',
        (isWorkbenchInstant || workbench.isResizing) &&
          '[&_[data-slot=sidebar-container]]:transition-none! [&_[data-slot=sidebar-gap]]:transition-none!',
      ]"
      :style="{
        '--sidebar-width': `${workbench.width}px`,
        '--window-edge-shift': `${trailingControlsShift}px`,
      }"
      :open="workbench.displayedOpen"
    >
      <ProjectWorkbench />
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
          <Button
            data-testid="project-workbench-toggle"
            variant="ghost"
            size="icon-sm"
            :aria-label="t('project.workbench.toggle')"
            :aria-pressed="workbench.activeLayout.open"
            :title="t('project.workbench.toggle')"
            @click="workbench.toggle()"
          >
            <PanelRight aria-hidden="true" />
          </Button>
          <PinePreferencesDialog
            v-if="!isWindowsPlatform"
            ref="preferencesDialog"
          />
        </div>
      </template>
    </WindowTitleBar>

    <SessionSearchOverlay v-model:open="isSessionSearchOpen" />
    <PineUpdateDialog v-model:open="isUpdateOpen" />
    <ProjectBackgroundTaskInspector />
  </SidebarProvider>
</template>
