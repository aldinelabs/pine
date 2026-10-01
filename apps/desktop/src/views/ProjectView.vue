<script setup lang="ts">
import { House, PanelRight } from "@lucide/vue";
import { onKeyStroke } from "@vueuse/core";
import { computed, onMounted, ref } from "vue";
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
import { useFrozenWindowResize } from "@/composables/useFrozenWindowResize";

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

onMounted(async () => {
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
      v-if="projectStore.activeProject"
      v-model:open="isProjectSettingsOpen"
      :project="projectStore.activeProject"
    />
  </SidebarProvider>
</template>
